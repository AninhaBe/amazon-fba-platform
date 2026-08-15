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
  assert.equal(cards.length, 12);
  for (const c of cards) {
    assert.equal(c.value, "—", `${c.key} deveria estar vazio`);
    // Todo card vazio diz o que falta. "Impostos" é o único cuja pendência não
    // é da Amazon — é alíquota que a vendedora configura —, então ele não pode
    // dizer "Aguardando" e fingir que espera o marketplace.
    assert.match(
      c.context,
      c.key === "tax" ? /configurar a alíquota/ : /Aguardando/,
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
  // Só o AdvertisingFee foi postado. Logística FBA e retenções não apareceram —
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
  assert.equal(por("taxesWithheld").raw, 0);
  assert.match(por("taxesWithheld").context, /não reteve imposto/);
  // O que existe continua sendo mostrado normalmente.
  assert.equal(por("ads").raw, 6.12);
});

test("sem extrato conciliado a tarifa segue desconhecida", () => {
  const cards = amazonFinancialCards({ finance: null, cogs: 0, estimatedProfit: 0, unitsWithoutCost: 0 });
  const por = (k) => cards.find((c) => c.key === k);
  assert.equal(por("fbaShipping").value, "—", "sem extrato, zero seria invencao");
  assert.equal(por("fbaShipping").raw, null);
  assert.equal(por("taxesWithheld").value, "—");
});

test("o card de imposto nao culpa a Amazon por uma configuracao nossa", () => {
  const cards = amazonFinancialCards({ finance: null, cogs: 0, estimatedProfit: 0, unitsWithoutCost: 0 });
  const imposto = cards.find((c) => c.key === "tax");
  assert.equal(imposto.value, "—");
  assert.doesNotMatch(imposto.context, /Aguardando/, "nao estamos esperando a Amazon: falta a tela de aliquota");
});
