import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// ⚠️ FUNCAO EXPORTADA E NAO CHAMADA E FEATURE QUE NAO EXISTE.
//
// Defeito real que este teste reprova (04/09/2026, relatado pela vendedora
// como "esta tudo em branco!!"): `estimarPelaTabela` subiu na v264, com 12
// quebras vistas vermelhas e prova em producao nas duas contas — e NAO TINHA
// UM UNICO CHAMADOR no repo. `grep` pelo nome devolvia so a propria definicao.
//
// 📌 A prova de ontem era verdadeira e insuficiente: eu chamei a funcao A MAO
// e li o resultado no banco. Isso prova que a funcao calcula certo; nao prova
// que ALGUEM a chama. Pedido novo nascia sem estimativa nenhuma, e Taxas,
// Repasse liquido e Margem caiam para travessao na tela dela.
//
// ⚠️ NADA FICAVA VERMELHO: os testes da frente exercitam a funcao diretamente,
// entao passam com ela desligada do mundo. E a mesma familia de "casar o nome
// de uma variavel nao prova de onde ela vem" — aqui, exercitar a funcao nao
// prova que ela roda.
//
// A guarda e generica de proposito: vale para qualquer produtor de tarifa que
// alguem exporte no futuro e esqueca de ligar.

const raiz = new URL("../src/", import.meta.url);

/** Todo .ts sob src/, para procurar chamada em qualquer lugar. */
function todosOsFontes(dir = raiz) {
  const saida = [];
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const filho = new URL(item.name + (item.isDirectory() ? "/" : ""), dir);
    if (item.isDirectory()) saida.push(...todosOsFontes(filho));
    else if (item.name.endsWith(".ts") || item.name.endsWith(".tsx")) saida.push(filho);
  }
  return saida;
}

const FONTES = todosOsFontes().map((u) => ({ url: u, texto: readFileSync(u, "utf8") }));
const DEFINICAO = "amazonTarifaEstimada.ts";

// Produtores que precisam rodar sozinhos, e por que cada um esta na lista.
// ⚠️ A LISTA JA FALHOU POR SER CURTA (06/09/2026). Ela so tinha os PRODUTORES,
// e passou verde enquanto `carimbarEstimativasSubstituidas` — a funcao que
// APAGA — ficava sem chamador, com 252 estimativas vivas em pedidos que ja
// tinham tarifa real. Guarda com lista fechada so cobre o que alguem lembrou de
// listar; ao criar funcao deste modulo que precisa RODAR, acrescente aqui.
const PRODUTORES = [
  ["estimarPelaTabela", "a tarifa calculada do pendente — o que a vendedora ve"],
  ["estimarTarifaDosPedidosSemTarifa", "a estimativa pela tarifa observada"],
  ["carimbarEstimativasSubstituidas", "o carimbo do que a realidade ja substituiu"],
];

test("todo produtor de tarifa tem quem o chame", async (t) => {
  for (const [nome, papel] of PRODUTORES) {
    await t.test(`🔴 ${nome} e chamado por alguem (${papel})`, () => {
      const chamadores = FONTES.filter(({ url, texto }) =>
        !url.pathname.endsWith(DEFINICAO) && texto.includes(`${nome}(`));
      assert.ok(
        chamadores.length > 0,
        `${nome} nao tem chamador em src/: funcao exportada e nao chamada e feature que nao existe`,
      );
    });
  }
});

test("a tarifa pela tabela roda nos DOIS caminhos do sync da Amazon", async (t) => {
  const sync = readFileSync(new URL("lib/integrations/amazonSync.ts", raiz), "utf8");
  // ⚠️ Proibicao nao ha aqui; sao exigencias, entao o fonte cru serve.
  await t.test("🔴 no laco de conciliacao", () => {
    assert.ok(sync.includes('["tarifaPelaTabela", () => estimarPelaTabela(connectionId)'),
      "sem esta etapa o pedido novo nasce sem tarifa calculada");
  });
  await t.test("🔴 no caminho pontual", () => {
    assert.ok(sync.includes("await estimarPelaTabela(connectionId).catch("),
      "o caminho pontual alcanca os recentes; sem ele a tela demora um ciclo inteiro");
  });
});

test("o carimbo das substituidas roda nos DOIS caminhos", async (t) => {
  // ⚠️ ESTA GUARDA NASCEU DE UMA FALHA DELA MESMA (06/09/2026). A checagem
  // generica acima exige apenas que a funcao TENHA algum chamador — e ela ficou
  // VERDE quando removi a etapa do laco de conciliacao, porque o caminho
  // pontual ainda existia. "Tem chamador" nao e "roda onde precisa": o laco e
  // quem alcanca a conta inteira a cada ciclo; o pontual so os recentes.
  const sync = readFileSync(new URL("lib/integrations/amazonSync.ts", raiz), "utf8");
  await t.test("🔴 no laco de conciliacao", () => {
    assert.ok(sync.includes('["carimbarSubstituidas", () => carimbarEstimativasSubstituidas(connectionId)'),
      "sem esta etapa a estimativa substituida vive para sempre — eram 252 vivas com tarifa real ao lado");
  });
  await t.test("🔴 no caminho pontual", () => {
    assert.ok(sync.includes("await carimbarEstimativasSubstituidas(connectionId).catch("),
      "o pontual carimba o que acabou de chegar, sem esperar o ciclo");
  });
});
