import test from "node:test";
import assert from "node:assert/strict";
import { calculateTiktokFinancialV2 } from "../src/lib/integrations/tiktokFinancialV2.ts";

const item = (unitCost = 10) => ({ quantity: 1, unitCost });
const order = (changes = {}) => ({
  revenue: 100, buyerShipping: 0, statementSettled: true,
  fees: 10, sellerShipping: 5, ads: 0, taxesWithheld: 0, refunds: 0, items: [item()], ...changes,
});
const calculate = (changes = {}) => calculateTiktokFinancialV2({
  periodCovered: true, taxRate: 10, orders: [order()], ...changes,
});

test("contrato completo calcula lucro, margem e ROI", () => {
  const result = calculate();
  assert.deepEqual(result.overview, {
    currency: "BRL", revenue: 100, fees: 10, sellerShipping: 5, buyerShipping: 0,
    ads: 0, taxesWithheld: 0, refunds: 0,
    tax: 10, taxRate: 10, taxRateKnown: true, cogs: 10, profit: 65, marginPct: 65, roiPct: 650,
    unitsWithoutCost: 0,
  });
  assert.equal(result.coverage.financials.status, "complete");
});

test("zero explícito permanece conhecido; vazio coberto prova receita zero", () => {
  const zero = calculate({ taxRate: 0, orders: [order({ revenue: 0, fees: 0, sellerShipping: 0, buyerShipping: 0 })] });
  assert.equal(zero.overview.fees, 0);
  assert.equal(zero.overview.tax, 0);
  assert.equal(zero.overview.profit, -10);
  assert.equal(zero.overview.marginPct, null);
  const empty = calculate({ taxRate: 0, orders: [] });
  assert.equal(empty.overview.revenue, 0);
  assert.equal(empty.overview.profit, 0);
  assert.equal(empty.overview.roiPct, null);
});

test("fee ausente, negativa e extrato pendente têm estados distintos", () => {
  const missing = calculate({ orders: [order({ fees: null })] });
  assert.equal(missing.overview.fees, null);
  assert.deepEqual(missing.coverage.fees, { status: "partial", unit: "orders", applicable: 1, known: 0, missing: 1, pending: 0, ratio: 0, capturedValue: 0 });
  const negative = calculate({ orders: [order({ fees: -2 })] });
  assert.equal(negative.overview.fees, -2);
  const pending = calculate({ orders: [order({ statementSettled: false, fees: null, sellerShipping: null })] });
  assert.equal(pending.overview.fees, null);
  assert.deepEqual(pending.coverage.fees, { status: "pending", unit: "orders", applicable: 1, known: 0, missing: 0, pending: 1, ratio: 0, capturedValue: 0 });
});

test("cobertura separa janela solicitada do backlog historico e declara unidades", () => {
  const result = calculate({ historicalBacklog: { applicable: 20, known: 5, missing: 0, pending: 15 } });
  assert.equal(result.coverage.requestedPeriod.fees.unit, "orders");
  assert.equal(result.coverage.requestedPeriod.shipping.unit, "shipping_components");
  assert.equal(result.coverage.requestedPeriod.cogs.unit, "units");
  assert.equal(result.coverage.requestedPeriod.revenue.unit, "period");
  assert.equal(result.coverage.historicalBacklog.pending, 15);
  assert.equal(result.overview.profit, 65, "backlog historico nao altera cards da janela");
});

test("buyer e seller shipping possuem coberturas independentes sem total fabricado", () => {
  const result = calculate();
  assert.equal(result.coverage.buyerShipping.capturedValue, 0);
  assert.equal(result.coverage.sellerShipping.capturedValue, 5);
  assert.equal(result.coverage.shipping.capturedValue, null);
});

test("imposto ausente NAO difere mais no VALOR de aliquota 0% — so no SINAL", () => {
  // ⚠️ ESTE TESTE INVERTEU EM 07/09/2026, e a inversao E a fronteira da ADR-038.
  // Ele existia para provar que "nao cadastrou" e "cadastrou 0%" eram numeros
  // DIFERENTES (null vs 0). Depois da decisao da dona, os dois produzem a MESMA
  // conta de proposito — e o que os separa passa a ser `taxRateKnown`.
  //
  // 📌 Por isso a assercao do VALOR agora prova a igualdade, e a do SINAL prova
  // a diferenca. Testar so o valor aqui deixaria de cobrir o unico rastro que
  // sobrou; testar so o sinal esconderia que a conta ficou igual.
  const semCadastro = calculate({ taxRate: null }).overview;
  const isentoDeclarado = calculate({ taxRate: 0 }).overview;
  assert.equal(semCadastro.tax, 0);
  assert.equal(isentoDeclarado.tax, 0);
  assert.equal(semCadastro.tax, isentoDeclarado.tax, "as duas contas sao identicas — e e assim mesmo");
  assert.equal(semCadastro.taxRateKnown, false, "nao cadastrou: o sinal denuncia");
  assert.equal(isentoDeclarado.taxRateKnown, true, "declarou 0%: nao ha pendencia a apontar");
});

test("custo ausente permanece desconhecido, mas NAO apaga mais o lucro", () => {
  // ⚠️ INVERTEU EM 30/08/2026 (decisao da vendedora). `cogs` continua `null` —
  // "nao sei" segue sendo "nao sei" — mas o LUCRO passa a sair com o custo
  // conhecido, e `unitsWithoutCost` vai junto para a tela sinalizar ao lado.
  const missing = calculate({ orders: [order({ items: [item(null)] })] });
  assert.equal(missing.overview.cogs, null);
  assert.notEqual(missing.overview.profit, null);
  assert.equal(missing.overview.unitsWithoutCost, 1);
  assert.equal(missing.coverage.cogs.missing, 1);

  const zero = calculate({ orders: [order({ items: [item(0)] })] });
  assert.equal(zero.overview.cogs, 0);
  assert.equal(zero.overview.profit, 75);
  assert.equal(zero.coverage.cogs.known, 1);
  assert.equal(zero.coverage.cogs.missing, 0);
});

test("fretes ausentes separadamente não são convertidos em zero", () => {
  const buyer = calculate({ orders: [order({ buyerShipping: null })] });
  assert.equal(buyer.overview.buyerShipping, null);
  assert.equal(buyer.overview.profit, 65, "frete do comprador não compõe lucro");
  const seller = calculate({ orders: [order({ sellerShipping: null })] });
  assert.equal(seller.overview.sellerShipping, null);
  assert.equal(seller.overview.profit, null);
});

test("período parcial preserva receita capturada, mas anula resultado final", () => {
  const result = calculate({ periodCovered: false });
  assert.equal(result.overview.revenue, 100);
  assert.equal(result.overview.tax, 10);
  assert.equal(result.overview.profit, null);
  assert.equal(result.coverage.revenue.status, "partial");
});

test("JSON preserva null no payload da API", () => {
  const result = calculate({ periodCovered: false, taxRate: null, orders: [order({ statementSettled: false, fees: null, sellerShipping: null, buyerShipping: null, items: [item(null)] })] });
  const payload = JSON.parse(JSON.stringify({ connection: {}, sync: {}, coverage: result.coverage, overview: result.overview }));
  assert.equal(payload.overview.revenue, 100);
  assert.equal(payload.overview.fees, null);
  assert.equal(payload.overview.buyerShipping, null);
  assert.equal(payload.overview.profit, null);
});

test("ads, imposto retido e refund compõem o lucro quando explicitamente conhecidos", () => {
  const result = calculate({ orders: [order({ ads: 3, taxesWithheld: 2, refunds: 4 })] });
  assert.equal(result.overview.profit, 56);
  assert.equal(result.overview.ads, 3);
  assert.equal(result.overview.taxesWithheld, 2);
  assert.equal(result.overview.refunds, 4);
});

test("extrato liquidado não prova categoria financeira ausente", () => {
  const result = calculate({ orders: [order({ ads: null })] });
  assert.equal(result.overview.ads, null);
  assert.equal(result.overview.profit, null);
  assert.equal(result.coverage.ads.status, "partial");
});
