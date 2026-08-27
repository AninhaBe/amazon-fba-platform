import test from "node:test";
import assert from "node:assert/strict";
import { applyTiktokLedgerAuthority, calculateTiktokFinancialV2 } from "../src/lib/integrations/tiktokFinancialV2.ts";

// Decisão dela em 27/08/2026: com o extrato liquidado na mão, o TikTok passa a
// mostrar lucro. Antes, `applyTiktokLedgerAuthority` zerava profit/margem/ROI
// INCONDICIONALMENTE — o TikTok era o único canal que nunca mostrava lucro, nem
// com a conciliação completa.
//
// A nuance é o teste: liquidado calcula, janela aberta continua em travessão.

const pedido = (extra = {}) => ({
  revenue: 1000, fees: 100, sellerShipping: 50, ads: 0, taxesWithheld: 0, refunds: 0,
  buyerShipping: 0, statementSettled: true,
  items: [{ quantity: 1, unitCost: 400, unitDiscount: 0 }],
  ...extra,
});

const base = (taxRate = null) => calculateTiktokFinancialV2({ periodCovered: true, taxRate, orders: [pedido()] });

/** Agregado do ledger com tudo discriminado — o caso do extrato fechado. */
const extratoLiquidado = (extra = {}) => ({
  covered: true,
  aggregate: {
    revenue: 1000, fees: 100, sellerShipping: 50, buyerShipping: 0,
    ads: 0, taxesWithheld: 0, refunds: 0, adjustments: 0,
    currency: "BRL", finalTransactions: 12, estimatedTransactions: 0, ...extra,
  },
});

test("extrato liquidado e cobertura fechada: lucro, margem e ROI CALCULAM", () => {
  const r = applyTiktokLedgerAuthority(base(), extratoLiquidado());
  // 1000 − 100 − 50 − 0 − 0 − 0 − 0(sem imposto) − 400 = 450
  assert.equal(r.overview.profit, 450);
  assert.equal(r.overview.marginPct, 45);
  assert.equal(r.overview.roiPct, 112.5);
  assert.equal(r.coverage.financials.status, "complete");
  assert.equal(r.coverage.requestedPeriod.financials.status, "complete");
});

test("com alíquota cadastrada o imposto entra na conta", () => {
  const r = applyTiktokLedgerAuthority(base(8), extratoLiquidado());
  // tax = 8% de 1000 = 80 → 450 − 80 = 370
  assert.equal(r.overview.profit, 370);
  assert.equal(r.overview.marginPct, 37);
});

test("janela ABERTA continua em travessão, mesmo com transações liquidadas", () => {
  const r = applyTiktokLedgerAuthority(base(), { ...extratoLiquidado(), covered: false });
  assert.equal(r.overview.profit, null, "sem cobertura fechada o número seria otimista sem aviso");
  assert.equal(r.overview.marginPct, null);
  assert.equal(r.overview.roiPct, null);
  assert.equal(r.coverage.financials.status, "partial");
});

test("só estimativa (nenhuma transação liquidada) continua em travessão", () => {
  const r = applyTiktokLedgerAuthority(base(), extratoLiquidado({ finalTransactions: 0, estimatedTransactions: 9 }));
  assert.equal(r.overview.profit, null);
  assert.equal(r.coverage.financials.status, "partial");
});

test("componente do extrato desconhecido continua bloqueando", () => {
  // `refunds: null` = o extrato não disse nada sobre estorno. Diferente de zero.
  const r = applyTiktokLedgerAuthority(base(), extratoLiquidado({ refunds: null }));
  assert.equal(r.overview.refunds, null, "null continua null, nunca vira zero");
  assert.equal(r.overview.profit, null);
  assert.equal(r.coverage.financials.status, "partial");
});

test("zero explicito do extrato é FATO e não bloqueia", () => {
  // É a regra da auditoria da Amazon: ausência de cobrança em período
  // conciliado vale zero, não "não sei".
  const r = applyTiktokLedgerAuthority(base(), extratoLiquidado({ ads: 0, taxesWithheld: 0, refunds: 0 }));
  assert.equal(r.overview.ads, 0);
  assert.notEqual(r.overview.profit, null);
});

test("unidade sem custo cadastrado continua bloqueando o lucro", () => {
  const semCusto = calculateTiktokFinancialV2({
    periodCovered: true, taxRate: null,
    orders: [pedido({ items: [{ quantity: 1, unitCost: null, unitDiscount: 0 }] })],
  });
  const r = applyTiktokLedgerAuthority(semCusto, extratoLiquidado());
  assert.equal(r.overview.cogs, null);
  assert.equal(r.overview.profit, null, "custo desconhecido nao pode virar lucro otimista");
});
