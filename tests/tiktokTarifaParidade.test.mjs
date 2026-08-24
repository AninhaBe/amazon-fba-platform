import test from "node:test";
import assert from "node:assert/strict";
import { agruparItens, canonicalTiktokFees, classifyTiktokFeeField, tiktokFeeDecomposition } from "../src/lib/integrations/tiktokCanonical.ts";
import {
  applyTiktokLedgerAuthority,
  calculateTiktokFinancialV2,
  tiktokRevenueCascade,
} from "../src/lib/integrations/tiktokFinancialV2.ts";

// Paridade financeira com a Amazon (TODO.md → "Paridade financeira entre canais"),
// reimplementada com os campos do TikTok. Três garantias, uma por bloco:
//
//   1. cupom aparece sem descontar duas vezes;
//   2. tarifa com nome novo não vira R$ 0,00 — o total é a autoridade;
//   3. ausência em período conciliado é zero explicado; fora dele continua null.

// ---------------------------------------------------------------------------
// 1. Cupom/desconto não é contado como custo
// ---------------------------------------------------------------------------

const linha = (mudancas = {}) => ({
  product_id: "p1", sku_id: "s1", seller_sku: "SKU-1",
  sale_price: "8.00", original_price: "10.00", seller_discount: "1.50", platform_discount: "0.50",
  ...mudancas,
});

test("desconto só é aceito quando a própria linha reconcilia ao centavo", () => {
  const [reconciliado] = agruparItens([linha()]);
  assert.equal(reconciliado.unitPrice, 8, "receita continua sendo o valor pago");
  assert.equal(reconciliado.promotionDiscount, 2);
  assert.equal(reconciliado.listPrice, 10, "preço de tabela = pago + cupom");

  // A documentação diz que `sale_price` já é líquido; nenhum payload real com
  // cupom foi observado. Quando os números não fecham, a premissa não vale —
  // e afirmar o desconto arriscaria descontá-lo duas vezes.
  const [semReconciliar] = agruparItens([linha({ seller_discount: "5.00" })]);
  assert.equal(semReconciliar.promotionDiscount, null);
  assert.equal(semReconciliar.listPrice, null);
  assert.equal(semReconciliar.unitPrice, 8, "a receita não muda por causa do desconto");

  const [semCampo] = agruparItens([linha({ platform_discount: undefined })]);
  assert.equal(semCampo.promotionDiscount, null, "campo ausente é desconhecido, não zero");
});

test("uma unidade sem desconto provado contamina o grupo inteiro", () => {
  const [item] = agruparItens([linha(), linha({ seller_discount: "9.99" })]);
  assert.equal(item.qty, 2);
  assert.equal(item.promotionDiscount, null, "somar só a unidade provada afirmaria um cupom menor");
});

test("cupom não vira tarifa: nenhum campo de desconto entra nas taxas", () => {
  assert.equal(classifyTiktokFeeField("seller_discount"), null);
  assert.equal(classifyTiktokFeeField("platform_discount"), null);
  const taxas = canonicalTiktokFees({ currency: "BRL", fee_and_tax_amount: "-9.13", seller_discount: "1.50" }, "BRL");
  assert.deepEqual(taxas.map((taxa) => taxa.providerFeeCode), ["fee_and_tax_amount"]);
});

test("a cascata fecha no card de faturamento e não muda o lucro", () => {
  const pedido = (itens) => ({
    revenue: 16, buyerShipping: 0, statementSettled: true,
    fees: 2, sellerShipping: 1, ads: 0, taxesWithheld: 0, refunds: 0, items: itens,
  });
  const comCupom = calculateTiktokFinancialV2({
    periodCovered: true, taxRate: 10,
    orders: [pedido([{ quantity: 2, unitCost: 3, unitDiscount: 2 }])],
  });
  const semCupom = calculateTiktokFinancialV2({
    periodCovered: true, taxRate: 10,
    orders: [pedido([{ quantity: 2, unitCost: 3 }])],
  });

  const cascata = comCupom.coverage.revenueCascade;
  assert.equal(cascata.revenue, comCupom.overview.revenue, "o pé da cascata É o card de faturamento");
  assert.equal(cascata.discounts, 4);
  assert.equal(cascata.listRevenue, 20);
  assert.equal(+(cascata.listRevenue - cascata.discounts).toFixed(2), cascata.revenue, "preço de tabela − cupons = faturamento");

  assert.equal(comCupom.overview.revenue, 16, "o cupom não reduz a receita de novo");
  assert.equal(comCupom.overview.profit, semCupom.overview.profit, "cupom é exibição, nunca dedução");
  assert.equal(comCupom.overview.fees, semCupom.overview.fees);
  assert.equal(semCupom.coverage.revenueCascade.discounts, null, "sem desconto provado a cascata some");
  assert.equal(semCupom.coverage.revenueCascade.revenue, 16, "o faturamento continua exibido");
});

test("cascata montada sobre base diferente do faturamento exibido é suprimida", () => {
  // O ledger de extratos só soma transação liquidada; o cupom vem dos pedidos.
  // Somar faturamento de um conjunto com cupom de outro inventaria um preço de
  // tabela que nunca existiu.
  assert.deepEqual(tiktokRevenueCascade(90, { revenue: 100, discounts: 10 }),
    { listRevenue: null, discounts: null, revenue: 90 });
  assert.deepEqual(tiktokRevenueCascade(100, { revenue: 100, discounts: 10 }),
    { listRevenue: 110, discounts: 10, revenue: 100 });
});

// ---------------------------------------------------------------------------
// 2. Tarifa categorizada por padrão, não por lista de nomes exatos
// ---------------------------------------------------------------------------

const soma = (taxas, tipos) => +taxas.filter((taxa) => tipos.includes(taxa.feeType))
  .reduce((total, taxa) => total + taxa.amount, 0).toFixed(2);
// "Taxas" no dashboard = commission + payment + other; "Frete do vendedor" =
// shipping_seller + fulfillment (ver o fee_type IN (...) de tiktokOverviewCanonical.ts).
const totalTaxas = (taxas) => soma(taxas, ["commission", "payment", "other"]);

test("nome novo que casa com padrão conhecido cai na categoria certa, não em R$ 0,00", () => {
  assert.equal(classifyTiktokFeeField("platform_service_fee_amount"), "commission");
  assert.equal(classifyTiktokFeeField("logistics_service_amount"), "shipping_seller");
  assert.equal(classifyTiktokFeeField("warehouse_handling_amount"), "fulfillment");
  assert.equal(classifyTiktokFeeField("seller_penalty_amount"), "other", "sem padrão continua sendo custo, não sumiço");

  // Decomposição que FECHA com o settlement: 100 − 10 − 5 − 3 − 2 = 80.
  const { fees, pending, reconciled } = tiktokFeeDecomposition({
    currency: "BRL", revenue_amount: "100.00",
    fee_and_tax_amount: "-10.00", shipping_cost_amount: "-5.00",
    platform_service_fee_amount: "-3.00", logistics_service_amount: "-2.00",
    settlement_amount: "80.00",
  }, "BRL");

  assert.equal(reconciled, true, "a aritmética do pedido prova a decomposição");
  assert.deepEqual(pending, []);
  assert.equal(totalTaxas(fees), 13, "a tarifa nova soma no total, não vira zero");
  assert.equal(soma(fees, ["shipping_seller", "fulfillment"]), 7);
  assert.equal(fees.some((taxa) => taxa.amount === 0), false);
  assert.deepEqual(
    fees.map((taxa) => taxa.providerFeeCode),
    ["fee_and_tax_amount", "platform_service_fee_amount", "logistics_service_amount", "shipping_cost_amount"],
    "ordem estável, independente da ordem das chaves do JSON"
  );
});

test("campo desconhecido não desaparece nem entra calado no total", () => {
  const extrato = {
    currency: "BRL", revenue_amount: "23.90", fee_and_tax_amount: "-9.13",
    shipping_cost_amount: "0", settlement_amount: "14.77",
    // Componente do próprio `fee_and_tax_amount` que subiu ao nível de cima.
    // Somá-lo duplicaria o custo — e é a soma que denuncia: 23,90 − 9,13 − 2,00
    // dá 12,77, não os 14,77 que a TikTok pagou.
    fee_per_item_sold_amount: "-2.00",
  };
  const { fees, pending, reconciled } = tiktokFeeDecomposition(extrato, "BRL");

  assert.equal(reconciled, false);
  assert.equal(totalTaxas(fees), 9.13, "vale o agregado conhecido; o campo novo não soma em cima do pai");
  assert.deepEqual(fees.map((taxa) => taxa.providerFeeCode), ["fee_and_tax_amount", "shipping_cost_amount"]);
  assert.deepEqual(pending, [{ field: "fee_per_item_sold_amount", amount: -2, reason: "nao_reconcilia" }],
    "o campo fica nomeado, com o valor cru, para virar decisão de alguém");
  assert.equal(canonicalTiktokFees(extrato, "BRL").length, 2, "nenhuma tarifa sintética chega ao consumidor genérico");
});

test("sem settlement não há como provar decomposição alguma", () => {
  const { fees, pending, reconciled } = tiktokFeeDecomposition({
    currency: "BRL", fee_and_tax_amount: "-9.13", platform_service_fee_amount: "-1.50",
  }, "BRL");
  assert.equal(reconciled, false);
  assert.equal(totalTaxas(fees), 9.13);
  assert.deepEqual(pending, [{ field: "platform_service_fee_amount", amount: -1.5, reason: "sem_settlement" }]);
});

test("crédito comprovado continua crédito em vez de virar custo", () => {
  // Subsídio de frete: 100 − 10 + 4 = 94. A identidade fecha, então o sinal
  // sai dela — `Math.abs` transformaria o subsídio num custo de R$ 4,00.
  const { fees, reconciled } = tiktokFeeDecomposition({
    currency: "BRL", revenue_amount: "100.00", fee_and_tax_amount: "-10.00",
    shipping_subsidy_amount: "4.00", settlement_amount: "94.00",
  }, "BRL");
  assert.equal(reconciled, true);
  assert.equal(fees.find((taxa) => taxa.providerFeeCode === "shipping_subsidy_amount").amount, -4);
  assert.equal(soma(fees, ["shipping_seller", "fulfillment"]), -4, "crédito reduz o custo do frete");
  assert.equal(totalTaxas(fees), 10);
});

test("receita, resultado e blocos aninhados nunca viram tarifa", () => {
  for (const campo of ["revenue_amount", "settlement_amount", "currency", "total_count", "order_create_time"]) {
    assert.equal(classifyTiktokFeeField(campo), null, `${campo} não é tarifa`);
  }
  const { fees, pending } = tiktokFeeDecomposition({
    currency: "BRL", revenue_amount: "23.90", fee_and_tax_amount: "-9.13", settlement_amount: "14.77",
    total_count: 1, order_create_time: 1_754_000_000,
    // Detalhamento do total já contado; somá-lo ao lado do pai duplicaria o custo.
    sku_transactions: [{ fee_tax_amount: "-9.13" }],
    fee_tax_breakdown: [{ amount: "-9.13" }],
  }, "BRL");
  assert.equal(fees.length, 1);
  assert.equal(fees[0].amount, 9.13);
  assert.deepEqual(pending, [], "bloco aninhado não é campo monetário e nem chega a ser candidato");
});

test("o mapeamento já observado continua igual", () => {
  // Extrato real do pedido 583985901599294689.
  const taxas = canonicalTiktokFees({
    currency: "BRL", revenue_amount: "23.9", fee_and_tax_amount: "-9.13",
    shipping_cost_amount: "0", settlement_amount: "14.77",
  }, "BRL");
  assert.equal(taxas.find((taxa) => taxa.feeType === "commission").amount, 9.13);
  assert.equal(taxas.find((taxa) => taxa.feeType === "shipping_seller").amount, 0, "zero é fato conhecido e entra");
  assert.equal(canonicalTiktokFees({ currency: "BRL" }, "BRL").length, 0, "ausência não vira zero");
  // Extrato sem receita nem settlement: o agregado conhecido vale mesmo assim.
  const semIdentidade = canonicalTiktokFees({ currency: "BRL", fee_and_tax_amount: "0", shipping_cost_amount: "0" }, "BRL");
  assert.deepEqual(semIdentidade.map((taxa) => taxa.amount), [0, 0]);
});

// ---------------------------------------------------------------------------
// 3. Ausência em período conciliado = zero explicado
// ---------------------------------------------------------------------------

const base = () => calculateTiktokFinancialV2({
  periodCovered: true, taxRate: 10,
  orders: [{
    revenue: 100, buyerShipping: 0, statementSettled: true,
    fees: 10, sellerShipping: 5, ads: 0, taxesWithheld: 0, refunds: 0,
    items: [{ quantity: 1, unitCost: 10 }],
  }],
});

const aggregate = (mudancas = {}) => ({
  revenue: 100, fees: null, sellerShipping: null, buyerShipping: 0,
  ads: null, taxesWithheld: null, refunds: null, finalTransactions: 3, ...mudancas,
});

test("ausência FORA de período conciliado continua desconhecida", () => {
  const { overview, coverage } = applyTiktokLedgerAuthority(base(), { covered: false, aggregate: aggregate() });
  assert.equal(overview.fees, null);
  assert.equal(overview.sellerShipping, null);
  assert.deepEqual(coverage.settledZeros, []);
  assert.equal(coverage.requestedPeriod.fees.status, "partial");
});

test("ausência DENTRO de período conciliado vira zero explicado", () => {
  const { overview, coverage } = applyTiktokLedgerAuthority(base(), { covered: true, aggregate: aggregate() });
  assert.equal(overview.fees, 0, "extrato fechado sem a tarifa prova que a TikTok não cobrou");
  assert.equal(overview.sellerShipping, 0);
  assert.deepEqual(coverage.settledZeros, ["fees", "sellerShipping"], "a tela precisa saber que este zero é notícia");
  assert.equal(coverage.requestedPeriod.fees.status, "complete");
  assert.equal(coverage.requestedPeriod.fees.capturedValue, 0);
});

test("período conciliado sem nenhuma transação liquidada não fabrica zero", () => {
  const { overview, coverage } = applyTiktokLedgerAuthority(base(), {
    covered: true, aggregate: aggregate({ revenue: null, buyerShipping: null, finalTransactions: 0 }),
  });
  assert.equal(overview.fees, null, "sem extrato afirmando nada, zero seria invenção");
  assert.deepEqual(coverage.settledZeros, []);
});

test("categorias que o extrato não discrimina seguem desconhecidas mesmo conciliado", () => {
  const { overview, coverage } = applyTiktokLedgerAuthority(base(), { covered: true, aggregate: aggregate() });
  for (const chave of ["ads", "taxesWithheld", "refunds"]) {
    assert.equal(overview[chave], null, `${chave} não tem campo no extrato do TikTok; ausência não prova nada`);
    assert.equal(coverage.requestedPeriod[chave].status, "partial");
  }
  assert.equal(coverage.settledZeros.includes("ads"), false);
});

test("valor informado pelo ledger prevalece sobre o zero explicado", () => {
  const { overview, coverage } = applyTiktokLedgerAuthority(base(), {
    covered: true, aggregate: aggregate({ fees: 9.13, sellerShipping: 0 }),
  });
  assert.equal(overview.fees, 9.13);
  assert.equal(overview.sellerShipping, 0);
  assert.deepEqual(coverage.settledZeros, [], "zero vindo do extrato não é ausência");
});
