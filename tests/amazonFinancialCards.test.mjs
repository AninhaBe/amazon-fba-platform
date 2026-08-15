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
    assert.match(c.context, /Aguardando/, `${c.key} precisa dizer o que falta`);
  }
});

test("mostra os componentes conhecidos e marca os ausentes", () => {
  const cards = amazonFinancialCards({ finance: FINANCE, cogs: 13.64, estimatedProfit: 20.04, unitsWithoutCost: 0 });
  assert.equal(carta(cards, "revenue").value, brl(39.8));
  assert.equal(carta(cards, "ads").value, brl(6.12));
  assert.equal(carta(cards, "profit").value, brl(20.04));
  // Sem tarifa de logística no extrato, o card não inventa zero.
  assert.equal(carta(cards, "fbaShipping").value, "—");
  assert.match(carta(cards, "fbaShipping").context, /Aguardando/);
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
