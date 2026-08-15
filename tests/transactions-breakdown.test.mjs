import test from "node:test";
import assert from "node:assert/strict";
import { parseTransactionFinancials } from "../src/lib/transactionsBreakdown.ts";
import { calculateContribution } from "../src/lib/profitability.ts";

const brl = (currencyAmount) => ({ currencyAmount, currencyCode: "BRL" });
const tx = (breakdowns, total) => ({ totalAmount: brl(total), breakdowns });
const sales = (...filhos) => ({ breakdownType: "Sales", breakdowns: filhos });
const expenses = (...filhos) => ({ breakdownType: "Expenses", breakdowns: filhos });
const no = (breakdownType, v) => ({ breakdownType, breakdownAmount: brl(v) });

// Payloads reais da conta, colhidos da Transactions API em 15/08/2026.
// Nos dois o líquido é 19,90 — mas por caminhos diferentes.
const FRETE_GRATIS = tx([
  sales(no("ProductCharges", 19.9), no("Shipping", 8.9)),
  expenses(no("PromoRebates", -8.9)),
], 19.9);

const CUPOM = tx([
  sales(no("ProductCharges", 22.11)),
  expenses(no("PromoRebates", -2.21)),
], 19.9);

test("frete grátis: o rebate anula o frete e não vira desconto", () => {
  const p = parseTransactionFinancials(FRETE_GRATIS);
  assert.equal(p.revenue, 19.9);
  assert.equal(p.promotions, 0);
  assert.equal(p.fees, 0);
});

test("cupom resgatado: o rebate abate o faturamento", () => {
  const p = parseTransactionFinancials(CUPOM);
  // Antes devolvia 22,11 e o cupom sumia — a tela mostrava receita que nunca entrou.
  assert.equal(+p.revenue.toFixed(2), 19.9);
  assert.equal(+p.promotions.toFixed(2), 2.21);
  assert.equal(p.fees, 0);
});

test("os dois casos fecham no total da transação", () => {
  for (const t of [FRETE_GRATIS, CUPOM]) {
    const p = parseTransactionFinancials(t);
    assert.equal(+(p.revenue - p.fees).toFixed(2), t.totalAmount.currencyAmount);
  }
});

test("faturamento do período soma o líquido, não o bruto", () => {
  const total = [FRETE_GRATIS, CUPOM]
    .map(parseTransactionFinancials)
    .reduce((s, p) => s + p.revenue, 0);
  assert.equal(+total.toFixed(2), 39.8); // era 42,01 antes da correção
});

test("gasto com anúncio entra como tarifa nomeada", () => {
  const p = parseTransactionFinancials(tx([
    sales(),
    expenses(no("AdvertisingFee", -6.12)),
  ], -6.12));
  assert.equal(p.fees, 6.12);
  assert.equal(p.feeMap.get("AdvertisingFee"), 6.12);
  assert.equal(p.revenue, 0);
});

test("tarifa nomeada sob AmazonFees continua contada uma única vez", () => {
  const p = parseTransactionFinancials(tx([
    expenses({
      breakdownType: "AmazonFees",
      breakdownAmount: brl(-7.5),
      breakdowns: [no("Commission", -5), no("FBAPerUnitFulfillmentFee", -2.5)],
    }),
  ], 42.5));
  // Se o nó-pai fosse somado junto dos filhos, daria 15 em vez de 7,5.
  assert.equal(p.fees, 7.5);
  assert.equal(p.feeMap.get("Commission"), 5);
  assert.equal(p.feeMap.get("AmazonFees"), undefined);
});

test("despesa que vem como folha direta de Expenses é contada", () => {
  const p = parseTransactionFinancials(tx([expenses(no("SubscriptionFee", -3.2))], -3.2));
  assert.equal(p.fees, 3.2);
  assert.equal(p.feeMap.get("SubscriptionFee"), 3.2);
});

test("margem do pedido com frete grátis não supera a venda", () => {
  const resultado = calculateContribution({
    revenue: 19.9,
    buyerShipping: 8.9 - 8.9 || null, // ShippingPrice − ShippingDiscount
    productCost: 6.82,
    marketplaceFees: 0,
  });
  assert.equal(resultado.contribution, 13.08);
  assert.ok(resultado.contribution < 19.9, "margem nunca pode superar a venda");
});
