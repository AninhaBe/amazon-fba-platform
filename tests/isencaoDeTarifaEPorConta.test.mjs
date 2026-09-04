import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import "../scripts/ts-resolver.mjs";

// ⚠️ DUAS CONTAS, A MESMA VENDA, TARIFAS DIFERENTES — e só pelo atributo.
//
// É o critério de aceite da dona do produto: ela vai conferir na conta do colega
// (`amazon:A15NQMF7A6J1Y0`, Silveiras Import, 77 pendentes hoje), que **não tem
// isenção**, enquanto a dela (`amazon:AO62LVXJMX3AA`) está isenta da tarifa de
// indicação desde 01/08/2026.
//
// 🔴 O DEFEITO QUE ISTO IMPEDE é o mais silencioso desta família: um `if` global
// aplicando a isenção da conta dela zeraria a tarifa de TODO cliente futuro que
// paga cheio. E tarifa a menos vira **lucro a mais** — ninguém questiona um
// número que melhorou. É o parente do script de cura com `workspace_id` fixo,
// só que permanente em vez de pontual.

const { isentoEm } = await import("../src/lib/integrations/amazonIsencaoDeTarifa.ts");
const { comissaoPelaTabela, TABELA_DE_COMISSAO_AMAZON_BR } = await import("../src/lib/integrations/amazonTabelaDeComissao.ts");

/** A conta da dona: isenta da tarifa de indicação desde 01/08/2026. */
const DELA = [{ feeType: "commission", de: "2026-08-01", ate: null, motivo: "promocao-indicacao" }];
/** A conta do colega: nada. Paga cheio. */
const DO_COLEGA = [];

test("MESMA venda, contas diferentes: uma isenta, a outra paga a tabela", () => {
  const categoria = Object.values(TABELA_DE_COMISSAO_AMAZON_BR)[0];
  const preco = 38; // faixa de preço real dos produtos dela
  const daTabela = comissaoPelaTabela(categoria, preco);
  assert.ok(daTabela && daTabela.valor > 0, "a tabela tem de cobrar de quem paga");

  const hoje = "2026-09-03T15:00:00Z";
  assert.ok(isentoEm(DELA, "commission", hoje), "a conta dela esta isenta hoje");
  assert.equal(isentoEm(DO_COLEGA, "commission", hoje), null,
    "🔴 a conta do colega NAO pode herdar a isencao dela");
});

test("a VIGÊNCIA é pela data do PEDIDO, nunca por hoje", () => {
  // ⚠️ Um pedido de julho PAGOU tarifa. Aplicar a isenção de hoje ao histórico
  // faria a margem de julho subir sozinha — um número que nunca existiu.
  assert.equal(isentoEm(DELA, "commission", "2026-07-31T15:00:00Z"), null,
    "pedido anterior a vigencia paga");
  assert.ok(isentoEm(DELA, "commission", "2026-08-01T15:00:00Z"),
    "o primeiro dia da vigencia ja e isento");
});

test("a fronteira do dia respeita o fuso de São Paulo", () => {
  // 31/07 às 22h de Brasília é 01/08 em UTC. Comparar timestamps crus jogaria
  // esse pedido para dentro da vigência — e ele pagou.
  assert.equal(isentoEm(DELA, "commission", "2026-08-01T01:00:00Z"), null,
    "22h de 31/07 em Brasilia ainda e julho");
  assert.ok(isentoEm(DELA, "commission", "2026-08-01T04:00:00Z"),
    "01h de 01/08 em Brasilia ja e agosto");
});

test("a isenção é POR TARIFA — isento de indicação não é isento de FBA", () => {
  assert.ok(isentoEm(DELA, "commission", "2026-09-03T15:00:00Z"));
  assert.equal(isentoEm(DELA, "fulfillment", "2026-09-03T15:00:00Z"), null,
    "isencao de uma tarifa nao pode zerar a outra");
});

test("janela FECHADA para de valer no dia seguinte ao fim", () => {
  const encerrada = [{ feeType: "commission", de: "2026-08-01", ate: "2026-08-31", motivo: "x" }];
  assert.ok(isentoEm(encerrada, "commission", "2026-08-31T15:00:00Z"), "o ultimo dia ainda vale");
  assert.equal(isentoEm(encerrada, "commission", "2026-09-01T15:00:00Z"), null,
    "promocao que acabou tem de voltar a cobrar — senao a isencao vira permanente por esquecimento");
});

test("sem isenção cadastrada, ninguém é isento", () => {
  // O default seguro: ausência de configuração = paga. O contrário faria uma
  // conta nova nascer sem tarifa até alguém perceber.
  for (const vazio of [undefined, []]) {
    assert.equal(isentoEm(vazio, "commission", "2026-09-03T15:00:00Z"), null);
  }
});

test("o estimador LÊ a isenção do banco e a aplica pela data da linha", async () => {
  const fonte = await readFile(new URL("../src/lib/integrations/amazonTarifaEstimada.ts", import.meta.url), "utf8");
  // Ancorado na chamada inteira: casar o nome `isentoEm` continuaria verde se
  // alguem trocasse o argumento da data por `new Date()` — o nome nao muda, a
  // semantica sim (AGENTS.md, 02/09).
  assert.ok(fonte.includes('const isencaoDaComissao = isentoEm(isencoes, "commission", linha.occurred_at);'),
    "a isencao da comissao sai da DATA DO PEDIDO");
  assert.ok(fonte.includes('const isencaoDaLogistica = isentoEm(isencoes, "fulfillment", linha.occurred_at);'));
  assert.ok(fonte.includes("const isencoes = await lerIsencoes(connectionId);"),
    "e e lida POR CONEXAO, do banco");
  // ⚠️ E não pode existir constante global de isenção em lugar nenhum.
  const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(codigo, /AO62LVXJMX3AA|A15NQMF7A6J1Y0/,
    "conta especifica citada no calculo e a isencao virando regra do produto");
});

test("a isenção vira ZERO EXPLICADO, não linha ausente", async () => {
  // Zero aqui e FATO ("a Amazon nao cobra isto desta conta hoje"); ausencia
  // seria "nao sei". A tela precisa poder explicar o zero, senao a vendedora ve
  // tarifa sumida e nao sabe se foi promocao ou defeito nosso.
  const fonte = await readFile(new URL("../src/lib/integrations/amazonTarifaEstimada.ts", import.meta.url), "utf8");
  assert.ok(fonte.includes("if (isencaoDaComissao) await gravarIsencao(\"commission\", isencaoDaComissao.motivo);"));
  assert.ok(fonte.includes("`isencao:${motivo}`"), "o motivo vai junto, para a tela explicar");
});
