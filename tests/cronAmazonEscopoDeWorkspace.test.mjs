import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// O CRON NÃO TEM SESSÃO — ELE ABRE O ESCOPO POR LINHA.
//
// `getAccount` chama `currentWorkspaceId()`, que lança "Workspace autenticado
// ausente." fora de contexto. Buscar a conta ANTES de abrir o `runWithWorkspace`
// estoura na primeira conta e derruba o passo inteiro, que devolve zero —
// indistinguível de "não havia nada a fazer".
//
// Já aconteceu duas vezes: `bb4dcdf` (03/08/2026) consertou ranking e oferta e
// deixou `warm` e `insights` para trás. Medido em produção em 27/08/2026: os
// dois falhavam em TODA batida do cron desde 27/07, e `workspace_insights`
// estava parada havia dois dias. Estes testes travam a terceira vez.
//
// ⚠️ Sem import estático: `DATA_DIR` precisa estar definido ANTES de o
// `accountStore` carregar (ele resolve o caminho do arquivo no topo do módulo).
const DATA = mkdtempSync(path.join(tmpdir(), "nexo-cron-escopo-"));
process.env.DATA_DIR = DATA;
delete process.env.DATABASE_URL;
const WS = "ws-1";
const SELLER = "A0SELLER";
writeFileSync(
  path.join(DATA, "accounts.json"),
  JSON.stringify({ [`${WS}:${SELLER}`]: { workspaceId: WS, sellerId: SELLER, refreshToken: "Atzr|fake", connectedAt: new Date(0).toISOString() } })
);

const { comContaDoWorkspace } = await import("../src/lib/integrations/amazonCronScope.ts");
const { getAccount } = await import("../src/lib/accountStore.ts");

const fonte = (caminho) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");

function capturandoErros(fn) {
  const erros = [];
  const original = console.error;
  console.error = (...args) => erros.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "));
  return Promise.resolve(fn()).finally(() => { console.error = original; }).then((valor) => ({ valor, erros }));
}

test("negativa de controle: getAccount LANÇA com o storage de workspace vazio", async () => {
  await assert.rejects(() => getAccount(SELLER), /Workspace autenticado ausente/);
});

test("com o storage vazio o passo roda: o escopo é aberto DENTRO do helper", async () => {
  // Estado exato do cron: nenhum `runWithWorkspace` ambiente. Se `getAccount`
  // voltasse para fora do escopo, isto rejeitaria em vez de resolver.
  let recebida = null;
  const feito = await comContaDoWorkspace("teste", { workspace_id: WS, sellerId: SELLER }, 0, async (account) => {
    recebida = account;
    return 1;
  });
  assert.equal(feito, 1);
  assert.deepEqual(recebida, { sellerId: SELLER, refreshToken: "Atzr|fake" });
});

test("conta sem token é pulada sem lançar e sem contar", async () => {
  const feito = await comContaDoWorkspace("teste", { workspace_id: WS, sellerId: "NAO-EXISTE" }, 0, async () => 1);
  assert.equal(feito, 0);
});

test("falha de uma conta devolve o vazio e NÃO é engolida", async () => {
  const { valor, erros } = await capturandoErros(() =>
    comContaDoWorkspace("insights", { workspace_id: WS, sellerId: SELLER }, 0, async () => {
      throw new Error("detector quebrou");
    })
  );
  assert.equal(valor, 0, "uma conta que falha não derruba as outras");
  assert.equal(erros.length, 1, "o catch mudo era o que escondia o defeito");
  assert.match(erros[0], /\[insights\] falhou em ws-1\/A0SELLER/);
  assert.match(erros[0], /detector quebrou/);
});

for (const [passo, arquivo] of [["insights", "src/lib/integrations/amazonInsights.ts"], ["warm", "src/lib/integrations/amazonWarm.ts"]]) {
  test(`${passo}: busca a conta pelo helper, nunca solta no laço`, () => {
    const codigo = fonte(arquivo);
    assert.ok(codigo.includes(`comContaDoWorkspace("${passo}"`), `${passo} precisa passar pelo helper`);
    // A regressão tem uma forma só: `getAccount` chamado direto no laço.
    assert.doesNotMatch(codigo, /getAccount\(/, `${passo} não pode chamar getAccount fora do runWithWorkspace`);
    assert.doesNotMatch(codigo, /catch \{/, "catch mudo não volta");
  });
}

test("os dois passos continuam ligados no cron, com a falha visível na resposta", () => {
  const cron = fonte("src/app/api/cron/amazon-sync/route.ts");
  assert.match(cron, /passo\("warm", runScheduledAmazonWarm, 0\)/);
  assert.match(cron, /passo\("insights", runScheduledInsights, 0\)/);
  assert.match(cron, /ok: !temFalha/);
});
