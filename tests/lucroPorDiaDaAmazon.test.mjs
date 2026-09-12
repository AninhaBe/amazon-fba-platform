import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lucroPorDiaDaAmazon, gastoDeAnuncioDoDia } from "../src/lib/integrations/lucroPorDiaDaAmazon.ts";

// LUCRO POR DIA DA AMAZON — contrato fechado com a Vitrine em 12/09/2026.
//
// Todos os cenários usam valores FABRICADOS dos dois lados de cada fronteira
// (regra da casa: dado real que fica de um lado só nunca exercita a regra).
// Cada teste diz qual defeito reprova. Os 10 foram vistos VERMELHOS um a um
// em 12/09/2026, quebrando o código de propósito e restaurando entre eles.

const ponto = (date, revenue = 0, orders = 0, units = 0) => ({ date, revenue, orders, units });
const pedidoCompleto = (dia, extra = {}) => ({
  dia, valor: 100, tabela: 0, tarifa: 20, custo: 30, temCusto: true, tarifaEstimada: false, ...extra,
});
const SEM_ADS = { jaNoExtrato: false, primeiroDia: null, ateDia: null, gastoPorDia: {} };
const semEstorno = new Map();

test("dia completo apura: receita - tarifa - custo - imposto - ads - estorno", () => {
  // Reprova a conta errada de qualquer parcela (a família das cinco bases).
  const [dia] = lucroPorDiaDaAmazon({
    pontos: [ponto("2026-09-10", 100, 1, 1)],
    pedidos: [pedidoCompleto("2026-09-10")],
    estornoPorDia: new Map([["2026-09-10", 5]]),
    anuncio: { jaNoExtrato: false, primeiroDia: "2026-09-01", ateDia: "2026-09-12", gastoPorDia: { "2026-09-10": 7 } },
    taxRate: 10,
  });
  // 100 - 20 - 30 - 10 (imposto) - 7 (ads) - 5 (estorno) = 28
  assert.equal(dia.profit, 28);
  assert.equal(dia.refunds, 5);
});

test("UM pedido do dia fora da coerencia anula o dia inteiro — nunca a soma dos completos", () => {
  // Reprova a soma que engole a parcela desconhecida (pedido da Vitrine,
  // item b: null e o certo; somar so o que tem custo e o vies para cima).
  const [dia] = lucroPorDiaDaAmazon({
    pontos: [ponto("2026-09-10", 100, 2, 2)],
    pedidos: [
      pedidoCompleto("2026-09-10"),
      pedidoCompleto("2026-09-10", { valor: null, tabela: 0 }), // pendente sem preco nenhum
    ],
    estornoPorDia: semEstorno,
    anuncio: SEM_ADS,
    taxRate: null,
  });
  assert.equal(dia.profit, null);
});

test("pedido sem tarifa efetiva anula o dia (null != 0)", () => {
  // Reprova tratar tarifa ausente como zero — corrompe lucro (AGENTS.md).
  const [dia] = lucroPorDiaDaAmazon({
    pontos: [ponto("2026-09-10", 100, 1, 1)],
    pedidos: [pedidoCompleto("2026-09-10", { tarifa: null })],
    estornoPorDia: semEstorno,
    anuncio: SEM_ADS,
    taxRate: null,
  });
  assert.equal(dia.profit, null);
});

test("pendente SEM valor publicado mas COM preco de tabela apura (ADR-027)", () => {
  // Reprova exigir valor oficial quando a estimativa ja da a receita — e o
  // 'lucro cobre o faturamento inteiro' da ADR-027.
  const [dia] = lucroPorDiaDaAmazon({
    pontos: [ponto("2026-09-10", 0, 1, 1)],
    pedidos: [pedidoCompleto("2026-09-10", { valor: null, tabela: 80, tarifa: 12, custo: 20, tarifaEstimada: true })],
    estornoPorDia: semEstorno,
    anuncio: SEM_ADS,
    taxRate: null,
  });
  assert.equal(dia.profit, 48); // 80 - 12 - 20
  assert.equal(dia.profitEstimated, true);
});

test("dia sem estimativa NAO carrega a marca profitEstimated", () => {
  // Reprova marcar tudo como estimado (a marca perde o significado).
  const [dia] = lucroPorDiaDaAmazon({
    pontos: [ponto("2026-09-10", 100, 1, 1)],
    pedidos: [pedidoCompleto("2026-09-10")],
    estornoPorDia: semEstorno,
    anuncio: SEM_ADS,
    taxRate: null,
  });
  assert.equal(dia.profit, 50);
  assert.equal("profitEstimated" in dia, false);
});

test("dia DEPOIS do ateDia de ads e nao apuravel, mesmo com pedidos completos", () => {
  // Reprova o zero otimista de anuncio: dia sem gasto coletado saindo como
  // lucro cheio — a mesma mentira que descontarAnuncio anula no periodo.
  const [antes, depois] = lucroPorDiaDaAmazon({
    pontos: [ponto("2026-09-10", 100, 1, 1), ponto("2026-09-11", 100, 1, 1)],
    pedidos: [pedidoCompleto("2026-09-10"), pedidoCompleto("2026-09-11")],
    estornoPorDia: semEstorno,
    anuncio: { jaNoExtrato: false, primeiroDia: "2026-09-01", ateDia: "2026-09-10", gastoPorDia: { "2026-09-10": 3 } },
    taxRate: null,
  });
  assert.equal(antes.profit, 47); // 100 - 20 - 30 - 3
  assert.equal(depois.profit, null);
});

test("dia ANTES da primeira coleta de ads apura com gasto 0 — nao havia o que saber", () => {
  // Reprova nulificar o historico anterior a integracao de Ads (a regressao
  // que se disfarca de rigor, documentada em anuncioDoCanal).
  assert.equal(gastoDeAnuncioDoDia({ jaNoExtrato: false, primeiroDia: "2026-09-05", ateDia: "2026-09-10", gastoPorDia: {} }, "2026-09-01"), 0);
  // e canal que nunca anunciou: 0 em qualquer dia (fato sobre a operacao).
  assert.equal(gastoDeAnuncioDoDia(SEM_ADS, "2026-09-10"), 0);
  // dentro da janela coletada, dia sem linha e 0 (o SUM do periodo ja afirma).
  assert.equal(gastoDeAnuncioDoDia({ jaNoExtrato: false, primeiroDia: "2026-09-05", ateDia: "2026-09-10", gastoPorDia: {} }, "2026-09-07"), 0);
  // depois do ultimo dia coletado: desconhecido.
  assert.equal(gastoDeAnuncioDoDia({ jaNoExtrato: false, primeiroDia: "2026-09-05", ateDia: "2026-09-10", gastoPorDia: {} }, "2026-09-11"), null);
});

test("dia sem venda e lucro 0 (fato); com estorno postado, o estorno derruba E aparece em refunds", () => {
  // Reprova esconder o estorno de venda antiga que cai num dia sem venda —
  // a barra mentiria por omissao (pedido da Vitrine, item a).
  const [quieto, comEstorno] = lucroPorDiaDaAmazon({
    pontos: [ponto("2026-09-09"), ponto("2026-09-10")],
    pedidos: [],
    estornoPorDia: new Map([["2026-09-10", 40]]),
    anuncio: SEM_ADS,
    taxRate: null,
  });
  assert.equal(quieto.profit, 0);
  assert.equal("refunds" in quieto, false);
  assert.equal(comEstorno.profit, -40);
  assert.equal(comEstorno.refunds, 40);
});

test("refunds sai MESMO quando o dia nao e apuravel — a dica precisa dele", () => {
  // Reprova amarrar o estorno ao lucro: o dia null com estorno perderia a
  // explicacao exatamente onde ela mais falta.
  const [dia] = lucroPorDiaDaAmazon({
    pontos: [ponto("2026-09-10", 100, 1, 1)],
    pedidos: [pedidoCompleto("2026-09-10", { temCusto: false })],
    estornoPorDia: new Map([["2026-09-10", 9]]),
    anuncio: SEM_ADS,
    taxRate: null,
  });
  assert.equal(dia.profit, null);
  assert.equal(dia.refunds, 9);
});

test("aliquota ausente = imposto 0 com a conta seguindo (ADR-038), NAO o null do ML", () => {
  // Reprova portar o mecanismo do ML (aliquota ausente anula o dia) para a
  // Amazon, cuja faixa do periodo ja segue a excecao ADR-038 — replicar a
  // garantia, nunca o mecanismo (regra da dona, 02/09).
  const [dia] = lucroPorDiaDaAmazon({
    pontos: [ponto("2026-09-10", 100, 1, 1)],
    pedidos: [pedidoCompleto("2026-09-10")],
    estornoPorDia: semEstorno,
    anuncio: SEM_ADS,
    taxRate: null,
  });
  assert.equal(dia.profit, 50); // 100 - 20 - 30, imposto 0 pela excecao
});

// ── O PRODUTOR REALMENTE LIGA O MODULO E EMITE O TACOS ───────────────────────
// Asserção de fonte porque o produtor exige banco; ancorada DENTRO da chamada
// (nunca em frase solta), como manda a regra da casa.
test("o overview canonico da Amazon usa lucroPorDiaDaAmazon e emite tacos do periodo", () => {
  const fonte = readFileSync(new URL("../src/lib/integrations/amazonOverviewCanonical.ts", import.meta.url), "utf8");
  // Reprova apagar a decoracao e voltar a emitir a serie crua (profit sumiria
  // do payload e o bloco do ritmo da Amazon morreria em silencio).
  assert.match(fonte, /const dailySalesComLucro = lucroPorDiaDaAmazon\(\{\s*pontos: dailySales,\s*pedidos: porPedido\.values\(\),/);
  assert.match(fonte, /dailySales: dailySalesComLucro,/);
  // Reprova remover o TACOS ou trocar o denominador para paid_revenue (que
  // mente o TACOS para baixo — a garantia de tacosDoCanal).
  assert.match(fonte, /tacos: tacosDoPeriodo\(\{\s*gasto: lucro\.ads,\s*faturamento: receitaDoLucro,\s*pedidosSemValor,\s*\}\)/);
});
