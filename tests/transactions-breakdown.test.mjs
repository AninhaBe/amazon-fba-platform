import test from "node:test";
import assert from "node:assert/strict";
import { parseTransactionFinancials } from "../src/lib/transactionsBreakdown.ts";
import { calculateContribution } from "../src/lib/profitability.ts";

const brl = (currencyAmount) => ({ currencyAmount, currencyCode: "BRL" });

// Payload real do pedido 702-2192919-5915420 (kit-clips-320, 08/08/2026), colhido
// da Transactions API em 14/08/2026. Frete grátis vira dois lançamentos que se
// anulam, e o `totalAmount` já vem líquido (19,90).
const freteGratis = {
  totalAmount: brl(19.9),
  breakdowns: [
    {
      breakdownType: "Sales",
      breakdownAmount: brl(28.8),
      breakdowns: [
        { breakdownType: "ProductCharges", breakdownAmount: brl(19.9) },
        { breakdownType: "Shipping", breakdownAmount: brl(8.9) },
      ],
    },
    {
      breakdownType: "Expenses",
      breakdownAmount: brl(-8.9),
      breakdowns: [{ breakdownType: "PromoRebates", breakdownAmount: brl(-8.9) }],
    },
  ],
};

test("frete grátis não vira despesa: receita ignora o frete, então o rebate também", () => {
  const parsed = parseTransactionFinancials(freteGratis);
  // Receita é o que a compradora pagou de produto — `Shipping` fica de fora.
  assert.equal(parsed.revenue, 19.9);
  // Contar o rebate aqui descontaria 8,90 de um frete que nunca entrou na receita.
  assert.equal(parsed.fees, 0);
  assert.equal(parsed.revenue - parsed.fees, freteGratis.totalAmount.currencyAmount);
});

test("despesa que vem como folha direta de Expenses é contada", () => {
  // O laço aninhado antigo descartava qualquer folha em silêncio. Só `PromoRebates`
  // é exceção declarada; uma despesa real nesse nível precisa entrar.
  const parsed = parseTransactionFinancials({
    totalAmount: brl(40),
    breakdowns: [
      {
        breakdownType: "Expenses",
        breakdownAmount: brl(-3.2),
        breakdowns: [{ breakdownType: "SubscriptionFee", breakdownAmount: brl(-3.2) }],
      },
    ],
  });
  assert.equal(parsed.fees, 3.2);
  assert.equal(parsed.feeMap.get("SubscriptionFee"), 3.2);
});

test("tarifa nomeada sob AmazonFees continua contada uma única vez", () => {
  const parsed = parseTransactionFinancials({
    totalAmount: brl(50),
    breakdowns: [
      {
        breakdownType: "Expenses",
        breakdownAmount: brl(-7.5),
        breakdowns: [
          {
            breakdownType: "AmazonFees",
            breakdownAmount: brl(-7.5),
            breakdowns: [
              { breakdownType: "Commission", breakdownAmount: brl(-5) },
              { breakdownType: "FBAPerUnitFulfillmentFee", breakdownAmount: brl(-2.5) },
            ],
          },
        ],
      },
    ],
  });
  // Se o nó-pai fosse somado junto dos filhos, daria 15 em vez de 7,5.
  assert.equal(parsed.fees, 7.5);
  assert.equal(parsed.feeMap.get("Commission"), 5);
  assert.equal(parsed.feeMap.get("AmazonFees"), undefined);
});

test("margem do pedido com frete grátis não supera a venda", () => {
  // ShippingPrice 8,90 e ShippingDiscount 8,90 → frete líquido zero.
  const freteLiquido = 8.9 - 8.9;
  const resultado = calculateContribution({
    revenue: 19.9,
    buyerShipping: freteLiquido || null,
    productCost: 6.82,
    marketplaceFees: 0,
  });
  assert.equal(resultado.contribution, 13.08);
  assert.equal(resultado.marginPct, 65.73);
  assert.ok(resultado.contribution < 19.9, "margem nunca pode superar a venda");
});

test("frete que a compradora realmente pagou continua sendo receita", () => {
  // Sem desconto de frete (envio próprio cobrado), o valor entra na margem.
  const resultado = calculateContribution({
    revenue: 19.9,
    buyerShipping: 8.9 - 0,
    productCost: 6.82,
    marketplaceFees: 0,
  });
  assert.equal(resultado.contribution, 21.98);
});
