import test from "node:test";
import assert from "node:assert/strict";
const brl = (v) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
import { amazonFinancialCards } from "../src/app/amazon/amazonFinancialCards.ts";

const carta = (cards, key) => cards.find((c) => c.key === key);

const FINANCE = {
  currency: "BRL",
  revenue: 39.8,
  fees: 6.12,
  refunds: 0,
  promotions: 2.21,
  buyerShipping: 0,
  feeBreakdown: [{ type: "AdvertisingFee", amount: 6.12 }],
};

test("componente sem dado mostra o que falta, nunca zero", () => {
  const cards = amazonFinancialCards({ finance: null, cogs: 0, estimatedProfit: 0, unitsWithoutCost: 0 });
  assert.equal(cards.length, 14);
  for (const c of cards) {
    assert.equal(c.value, "—", `${c.key} deveria estar vazio`);
    // Todo card vazio diz o que falta. "Impostos" é o único cuja pendência não
    // é da Amazon — é alíquota que a vendedora declara —, então ele não pode
    // dizer "Aguardando" e fingir que espera o marketplace: diz onde resolver.
    assert.match(
      c.context,
      c.key === "tax" ? /Configure a alíquota na calculadora/ : /Aguardando/,
      `${c.key} precisa dizer o que falta`
    );
  }
});

test("mostra os componentes conhecidos e marca os ausentes", () => {
  const cards = amazonFinancialCards({ finance: FINANCE, cogs: 13.64, estimatedProfit: 20.04, unitsWithoutCost: 0 });
  assert.equal(carta(cards, "revenue").value, brl(39.8));
  assert.equal(carta(cards, "ads").value, brl(6.12));
  assert.equal(carta(cards, "profit").value, brl(20.04));
  // Com extrato conciliado, a AUSÊNCIA da tarifa é um fato: a Amazon não cobrou.
  // Exibir "—" aqui sugeria falha de leitura e deixava o card mudo para sempre.
  assert.equal(carta(cards, "fbaShipping").value, brl(0));
  assert.match(carta(cards, "fbaShipping").context, /não cobrou logística/);
  // Imposto não existe como configuração na Amazon hoje.
  assert.equal(carta(cards, "tax").value, "—");
});

test("margem e ROI saem do lucro e do custo", () => {
  const cards = amazonFinancialCards({ finance: FINANCE, cogs: 13.64, estimatedProfit: 20.04, unitsWithoutCost: 0 });
  assert.equal(carta(cards, "marginPct").value, "50,4%"); // 20,04 / 39,80
  assert.equal(carta(cards, "roiPct").value, "146,9%");   // 20,04 / 13,64
});

test("SKU sem custo invalida custo, lucro, margem e ROI — e diz quantos faltam", () => {
  const cards = amazonFinancialCards({ finance: FINANCE, cogs: 13.64, estimatedProfit: 20.04, unitsWithoutCost: 3 });
  for (const k of ["cogs", "profit", "marginPct", "roiPct"]) {
    assert.equal(carta(cards, k).value, "—", `${k} não pode afirmar resultado com custo faltando`);
    assert.match(carta(cards, k).context, /3 unidade/);
  }
  // O que não depende de custo continua visível.
  assert.equal(carta(cards, "revenue").value, brl(39.8));
  assert.equal(carta(cards, "fees").value, brl(6.12));
});

test("tarifa ausente em periodo conciliado vale zero, nao desconhecido", () => {
  // Só o AdvertisingFee foi postado. Logística FBA e comissão não apareceram —
  // e não apareceram porque NÃO foram cobradas (hoje o FBA está isento pela
  // promoção de vendedor novo), não porque falhamos em ler.
  const cards = amazonFinancialCards({
    finance: { currency: "BRL", revenue: 39.8, fees: 6.12, refunds: 0, feeBreakdown: [{ type: "AdvertisingFee", amount: 6.12 }] },
    cogs: 13.64,
    estimatedProfit: 20.04,
    unitsWithoutCost: 0,
  });
  const por = (k) => cards.find((c) => c.key === k);

  assert.notEqual(por("fbaShipping").value, "—", "period conciliado: a ausencia da tarifa e um fato");
  assert.equal(por("fbaShipping").raw, 0);
  assert.match(por("fbaShipping").context, /não cobrou logística/);
  assert.equal(por("commission").raw, 0);
  assert.match(por("commission").context, /não cobrou comissão/);
  // O que existe continua sendo mostrado normalmente.
  assert.equal(por("ads").raw, 6.12);
});

test("sem extrato conciliado a tarifa segue desconhecida", () => {
  const cards = amazonFinancialCards({ finance: null, cogs: 0, estimatedProfit: 0, unitsWithoutCost: 0 });
  const por = (k) => cards.find((c) => c.key === k);
  assert.equal(por("fbaShipping").value, "—", "sem extrato, zero seria invencao");
  assert.equal(por("fbaShipping").raw, null);
  assert.equal(por("commission").value, "—");
});

test("o card de imposto nao culpa a Amazon por uma configuracao nossa", () => {
  const cards = amazonFinancialCards({ finance: null, cogs: 0, estimatedProfit: 0, unitsWithoutCost: 0 });
  const imposto = cards.find((c) => c.key === "tax");
  assert.equal(imposto.value, "—");
  assert.doesNotMatch(imposto.context, /Aguardando/, "nao estamos esperando a Amazon: falta a tela de aliquota");
});

// A categorização por lista de nomes exatos era um risco silencioso: a conta da
// Ana é nova e não paga tarifa FBA, então nenhum teste pegava um nome errado.
// Numa conta que PAGA, um tipo fora da lista sairia como R$ 0,00 — errado com
// cara de certeza. Estes nomes são tarifas reais da Amazon.
test("tarifas FBA sao reconhecidas pelo padrao, nao por lista fechada", () => {
  const tarifas = [
    "FBAPerUnitFulfillmentFee",
    "FBAPerOrderFulfillmentFee",
    "FBAWeightBasedFee",
    "FBAStorageFee",
    "FBALongTermStorageFee",
    "FBADisposalFee",
    "FBARemovalFee",
    "FBAInboundPlacementServiceFee",
  ];
  const cards = amazonFinancialCards({
    finance: {
      currency: "BRL", revenue: 1000, fees: tarifas.length, refunds: 0,
      feeBreakdown: tarifas.map((type) => ({ type, amount: 1 })),
    },
    cogs: 100, estimatedProfit: 200, unitsWithoutCost: 0,
  });
  assert.equal(carta(cards, "fbaShipping").raw, tarifas.length, "toda tarifa FBA precisa cair na Logistica");
});

test("comissao ganhou card e nao se mistura com logistica", () => {
  const cards = amazonFinancialCards({
    finance: {
      currency: "BRL", revenue: 100, fees: 25, refunds: 0,
      feeBreakdown: [
        { type: "Commission", amount: 15 },
        { type: "FBAPerUnitFulfillmentFee", amount: 8 },
        { type: "AdvertisingFee", amount: 2 },
      ],
    },
    cogs: 30, estimatedProfit: 45, unitsWithoutCost: 0,
  });
  assert.equal(carta(cards, "commission").raw, 15);
  assert.equal(carta(cards, "fbaShipping").raw, 8);
  assert.equal(carta(cards, "ads").raw, 2);
  // As categorias nunca podem passar do total — "Taxas" e a autoridade.
  const soma = carta(cards, "commission").raw + carta(cards, "fbaShipping").raw + carta(cards, "ads").raw;
  assert.ok(soma <= carta(cards, "fees").raw, "categorias nao podem exceder o total de Taxas");
});

test("tarifa de tipo desconhecido nao some do total", () => {
  const cards = amazonFinancialCards({
    finance: {
      currency: "BRL", revenue: 100, fees: 9, refunds: 0,
      feeBreakdown: [{ type: "UmaTarifaQueAindaNaoExiste", amount: 9 }],
    },
    cogs: 30, estimatedProfit: 61, unitsWithoutCost: 0,
  });
  assert.equal(carta(cards, "fees").raw, 9, "continua contando em Taxas");
  assert.equal(carta(cards, "commission").raw, 0);
  assert.equal(carta(cards, "fbaShipping").raw, 0);
});

test("o card de impostos retidos foi removido", () => {
  const cards = amazonFinancialCards({ finance: FINANCE, cogs: 13.64, estimatedProfit: 20.04, unitsWithoutCost: 0 });
  assert.equal(cards.length, 14, "doze + ACOS e TACOS, que entraram em 25/08/2026");
  assert.equal(cards.find((c) => c.key === "taxesWithheld"), undefined);
});

test("sem aliquota o card de lucro avisa que esta sem imposto", () => {
  const cards = amazonFinancialCards({ finance: FINANCE, cogs: 13.64, estimatedProfit: 20.04, unitsWithoutCost: 0 });
  assert.match(carta(cards, "profit").context, /sem imposto/, "R$ 20,04 nao e o que sobra no bolso");
  assert.equal(carta(cards, "tax").value, "—");
  assert.match(carta(cards, "tax").context, /Configure a alíquota/);
});

test("com aliquota o card mostra o valor do imposto e o lucro deixa de avisar", () => {
  const cards = amazonFinancialCards({
    finance: FINANCE, cogs: 13.64, estimatedProfit: 17.65, unitsWithoutCost: 0, taxRate: 6, taxes: 2.39,
  });
  assert.equal(carta(cards, "tax").value, brl(2.39), "o card mostra o VALOR, nao so o percentual");
  assert.match(carta(cards, "tax").context, /6,0% sobre o faturamento/);
  assert.doesNotMatch(carta(cards, "profit").context, /sem imposto/);
  assert.equal(carta(cards, "profit").value, brl(17.65));
});

test("isencao declarada e zero exibido, nao vazio", () => {
  const cards = amazonFinancialCards({
    finance: FINANCE, cogs: 13.64, estimatedProfit: 20.04, unitsWithoutCost: 0, taxRate: 0, taxes: 0,
  });
  assert.equal(carta(cards, "tax").value, brl(0), "0% configurado e um fato, nao uma ausencia");
  assert.notEqual(carta(cards, "tax").value, "—");
});
