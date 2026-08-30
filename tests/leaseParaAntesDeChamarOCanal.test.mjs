import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// O DEFEITO (corrigido em 30/08/2026, achado pelo Delta em `amazonSync.ts`):
//
// `runAmazonSyncStep` reivindica o lease com um UPDATE condicional. Quando ele
// devolve ZERO linhas, o passo NAO parava — seguia para cinco operacoes com
// chamada a SP-API, nenhuma sob lease: `reverifyPendingById`,
// `reverifyUpdatedOrders`, `syncMissingOrderItems`, `syncMissingOrderFees` e
// `ingerirRelatorioDePedidos`.
//
// Com UMA maquina isso e inofensivo, porque nao existe concorrente. Com a
// SEGUNDA, as chamadas ao canal DOBRAM — e o sintoma nao e CPU desperdicada, e
// limite de API queimado. E um defeito que nasce pronto no dia do escalonamento,
// que e o pior momento para descobri-lo.
//
// ⚠️ E A CORRECAO NAO ERA "RETORNAR QUANDO ZERO LINHAS". O claim falha por duas
// razoes: (a) `status = 'complete'`, e ai ninguem esta rodando e a conciliacao e
// legitima; (b) outro worker e o dono. Retornar nos dois casos mataria o
// backfill de itens e tarifas no estado NORMAL da conta, em silencio — o mesmo
// defeito que a Shopee pagou em 29/08, quando o sucesso de uma etapa virou
// condicao de parada de outra. Por isso a conciliacao ganhou o SEU proprio lease.

const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");

/** As operacoes que falam com a SP-API no caminho de conciliacao. */
const CHAMAM_O_CANAL = [
  "reverifyPendingById",
  "reverifyUpdatedOrders",
  "syncMissingOrderItems",
  "syncMissingOrderFees",
  "ingerirRelatorioDePedidos",
];

test("perder o lease PARA o passo antes de qualquer chamada ao canal", async () => {
  const src = await fonte("src/lib/integrations/amazonSync.ts");

  // O ramo do claim vazio precisa tentar um lease PROPRIO e desistir sem chamar
  // nada. A ordem no arquivo e o que importa: a guarda vem antes das chamadas.
  const guarda = src.indexOf("if (!conciliacao[0]) return;");
  assert.ok(guarda > 0, "a conciliacao precisa desistir quando nao consegue o lease");

  const claim = src.indexOf("const conciliacao = await dbQuery");
  assert.ok(claim > 0 && claim < guarda, "a desistencia tem que vir DEPOIS da tentativa de lease");

  for (const chamada of CHAMAM_O_CANAL) {
    const primeiraOcorrencia = src.indexOf(chamada, claim);
    assert.ok(
      primeiraOcorrencia > guarda,
      `\`${chamada}\` aparece ANTES da guarda de lease: o perdedor voltaria a chamar a SP-API`,
    );
  }
});

test("o claim da conciliacao e um UPDATE condicional atomico, sem SELECT antes", async () => {
  const src = await fonte("src/lib/integrations/amazonSync.ts");
  const trecho = src.slice(
    src.indexOf("const conciliacao = await dbQuery"),
    src.indexOf("if (!conciliacao[0]) return;"),
  );
  // Exclusao mutua vem do proprio UPDATE: entre duas maquinas so uma muda a
  // linha, a outra recebe zero linhas. SELECT-e-depois-UPDATE teria janela entre
  // os dois comandos, e a atomicidade seria ilusao.
  assert.match(trecho, /UPDATE workspace_marketplace_syncs/);
  assert.match(trecho, /\(lease_until IS NULL OR lease_until < now\(\)\)/);
  assert.match(trecho, /RETURNING lease_until::text AS ownership_token/);
  assert.doesNotMatch(trecho, /SELECT/, "nada de SELECT antes do UPDATE: a janela entre os dois e o defeito");
});

test("a conciliacao NAO exige `status <> 'complete'` — senao ela some no estado normal", async () => {
  const src = await fonte("src/lib/integrations/amazonSync.ts");
  const trecho = src.slice(
    src.indexOf("const conciliacao = await dbQuery"),
    src.indexOf("if (!conciliacao[0]) return;"),
  );
  // A ingestao TERMINA; a conciliacao NAO — ela e continua por natureza. Copiar
  // o `status <> 'complete'` do claim de ingestao para ca faria o backfill de
  // itens e tarifas parar de existir assim que a janela alcancasse o presente.
  assert.doesNotMatch(trecho, /status\s*<>\s*'complete'/);
  // E ela tambem nao pode mexer no status: nao faz parte da maquina de estados.
  assert.doesNotMatch(trecho, /status\s*=\s*'syncing'/);
});

test("perder o lease NO MEIO aborta as etapas seguintes", async () => {
  const src = await fonte("src/lib/integrations/amazonSync.ts");
  // Renovacao que afeta ZERO LINHAS significa "perdi, aborta" — e o aborto e
  // ENTRE etapas, nunca no meio de uma escrita. Isso e seguro porque o sync e
  // idempotente por chave externa.
  assert.match(src, /const aindaSouDono = async \(\): Promise<boolean>/);
  assert.match(src, /if \(!\(await aindaSouDono\(\)\)\) \{/, "cada etapa precisa checar a posse antes de comecar");
  assert.match(src, /conciliação abortada: lease perdido/);
});

test("o lease da conciliacao e devolvido, e so se ainda for nosso", async () => {
  const src = await fonte("src/lib/integrations/amazonSync.ts");
  const finally_ = src.slice(src.indexOf("} finally {", src.indexOf("const aindaSouDono")));
  // Devolver sem checar o token apagaria o lease do dono NOVO — trocaria um
  // defeito de concorrencia por outro.
  assert.match(finally_.slice(0, 600), /SET lease_until = NULL/);
  assert.match(finally_.slice(0, 600), /lease_until::text = \$4/, "so devolve se o token ainda for o nosso");
});

// ⚠️ A METADE QUE FALTA, E POR QUE ELA NAO ESTA AQUI.
//
// O que estes testes provam e ESTRUTURA: a guarda existe, vem antes das
// chamadas, e o SQL e o certo. O que eles NAO provam e COMPORTAMENTO SOB
// CONCORRENCIA REAL — dois workers disputando a mesma linha, um ganhando, o
// perdedor fazendo zero chamadas, o vencedor renovando.
//
// Esse teste precisa de um Postgres de verdade, e o unico banco alcancavel deste
// ambiente e PRODUCAO — e o teste ESCREVE em `workspace_marketplace_syncs`.
// Rodar contra producao mexeria em lease de conta real de vendedor.
//
// A saida NAO e pular quando nao ha banco: teste que se omite fica verde sem ter
// testado nada, que e sensacao de cobertura sem cobertura. A saida e ter um
// Postgres descartavel no CI, e isso e decisao de infraestrutura — esta anotado
// em TODO.md → "Infra / performance". Ate la, esta ausencia esta ESCRITA aqui em
// vez de disfarcada de `t.skip()`.
