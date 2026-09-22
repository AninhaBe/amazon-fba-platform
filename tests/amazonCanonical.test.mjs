import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeAmazonFinanceFees,
  normalizeAmazonOrderHeader,
  normalizeAmazonOrderItems,
} from "../src/lib/integrations/amazonCanonical.ts";

test("normaliza header de pedido Amazon com aproximação do OrderTotal", () => {
  const order = normalizeAmazonOrderHeader({
    amazonOrderId: "701-1234567-1234567",
    purchaseDate: "2026-07-15T12:00:00Z",
    orderStatus: "Unshipped",
    fulfillmentChannel: "AFN",
    orderTotal: { CurrencyCode: "BRL", Amount: "159.80" },
  });
  assert.equal(order.externalOrderId, "701-1234567-1234567");
  assert.equal(order.status, "paid"); // Unshipped = pago, não enviado
  assert.equal(order.providerStatus, "Unshipped");
  assert.equal(order.gross, 159.8);
  assert.equal(order.currency, "BRL");
  assert.equal(order.fulfillment, "platform");
  assert.equal(order.buyerShipping, null); // itens ainda não conciliados
  assert.equal(order.items.length, 0);
  assert.equal(order.fees.length, 0); // Finances é etapa futura
});

test("mapeia status da Amazon para o canônico", () => {
  const status = (orderStatus) => normalizeAmazonOrderHeader({
    amazonOrderId: "x", purchaseDate: "2026-07-15T12:00:00Z", orderStatus,
  }).status;
  assert.equal(status("Pending"), "pending");
  assert.equal(status("Unshipped"), "paid");
  assert.equal(status("PartiallyShipped"), "shipped");
  assert.equal(status("Shipped"), "shipped");
  assert.equal(status("Canceled"), "cancelled");
  assert.equal(status("StatusNovoDesconhecido"), "pending");
});

test("normaliza itens descontando promoção e separando frete do comprador", () => {
  const normalized = normalizeAmazonOrderItems([
    {
      OrderItemId: "1",
      ASIN: "B0TESTE123",
      SellerSKU: "SKU-A",
      Title: "Produto A",
      QuantityOrdered: 2,
      ItemPrice: { CurrencyCode: "BRL", Amount: "100.00" },
      PromotionDiscount: { CurrencyCode: "BRL", Amount: "10.00" },
      ShippingPrice: { CurrencyCode: "BRL", Amount: "15.90" },
    },
    {
      OrderItemId: "2",
      ASIN: "B0TESTE456",
      SellerSKU: null,
      Title: "Produto B",
      QuantityOrdered: 1,
      ItemPrice: { CurrencyCode: "BRL", Amount: "49.90" },
    },
    { OrderItemId: "3", QuantityOrdered: 0, ItemPrice: { Amount: "10.00" } },
  ]);
  assert.equal(normalized.items.length, 2); // qty 0 fica de fora
  assert.equal(normalized.gross, 139.9); // (100−10) + 49,90
  assert.equal(normalized.buyerShipping, 15.9);
  assert.equal(normalized.currency, "BRL");
  assert.deepEqual(normalized.items[0], {
    externalProductId: "B0TESTE123",
    sku: "SKU-A",
    title: "Produto A",
    qty: 2,
    unitPrice: 45, // 90 ÷ 2 — LÍQUIDO, é dele que sai a margem
    listPrice: 50, // 100 ÷ 2 — preço cheio, antes do cupom
    promotionDiscount: 5, // 10 ÷ 2 — quanto o cupom custou por unidade
    promotionIds: null, // este item não veio com campanha
  });
  assert.equal(normalized.items[1].sku, null);
});

// Guardar as parcelas é o que permite responder "usaram cupom?" sem abrir pedido
// a pedido no Seller Central. Sem isso só sobrava o líquido, e "vendeu barato por
// cupom" ficava indistinguível de "vendeu barato porque o preço era outro".
test("separa preço cheio, desconto e campanha — e distingue ausência de zero", () => {
  const { items } = normalizeAmazonOrderItems([
    {
      QuantityOrdered: 1,
      SellerSKU: "com-cupom",
      ItemPrice: { CurrencyCode: "BRL", Amount: "22.11" },
      PromotionDiscount: { CurrencyCode: "BRL", Amount: "2.21" },
      PromotionIds: ["PLM-2f6aebf5"],
    },
    {
      QuantityOrdered: 1,
      SellerSKU: "sem-cupom",
      ItemPrice: { CurrencyCode: "BRL", Amount: "19.90" },
      PromotionDiscount: { CurrencyCode: "BRL", Amount: "0.00" },
    },
    {
      QuantityOrdered: 1,
      SellerSKU: "campo-ausente",
      ItemPrice: { CurrencyCode: "BRL", Amount: "30.00" },
    },
  ]);
  assert.deepEqual(
    items.map((i) => [i.sku, i.listPrice, i.promotionDiscount, i.promotionIds]),
    [
      ["com-cupom", 22.11, 2.21, "PLM-2f6aebf5"],
      // 0 é FATO ("houve promoção e valeu zero"), não ausência.
      ["sem-cupom", 19.9, 0, null],
      // Campo ausente é DESCONHECIDO — nunca zero (AGENTS.md).
      ["campo-ausente", 30, null, null],
    ]
  );
});

test("normaliza fees da Finances API para a taxonomia canônica", () => {
  const fees = normalizeAmazonFinanceFees({
    ShipmentEventList: [
      {
        AmazonOrderId: "701-1",
        ShipmentItemList: [
          {
            ItemFeeList: [
              { FeeType: "Commission", FeeAmount: { CurrencyCode: "BRL", Amount: "-12.50" } },
              { FeeType: "FBAPerUnitFulfillmentFee", FeeAmount: { Amount: "-8.20" } },
              { FeeType: "ShippingChargeback", FeeAmount: { Amount: "-5.00" } },
              { FeeType: "SalesTaxCollectionFee", FeeAmount: { Amount: "-0.75" } },
              { FeeType: "CodigoNovoDesconhecido", FeeAmount: { Amount: "-1.00" } },
              { FeeType: "GiftWrapZero", FeeAmount: { Amount: "0" } },
            ],
          },
        ],
      },
      // Segundo envio do mesmo pedido: agrega na mesma linha.
      {
        AmazonOrderId: "701-1",
        ShipmentItemList: [
          { ItemFeeList: [{ FeeType: "Commission", FeeAmount: { Amount: "-2.50" } }] },
        ],
      },
    ],
  }, "BRL");

  const byCode = Object.fromEntries(fees.map((fee) => [fee.providerFeeCode, fee]));
  assert.equal(byCode.Commission.feeType, "commission");
  assert.equal(byCode.Commission.amount, 15); // 12,50 + 2,50, sinal invertido
  assert.equal(byCode.FBAPerUnitFulfillmentFee.feeType, "fulfillment");
  assert.equal(byCode.FBAPerUnitFulfillmentFee.amount, 8.2);
  assert.equal(byCode.ShippingChargeback.feeType, "shipping_seller");
  assert.equal(byCode.SalesTaxCollectionFee.feeType, "taxes_withheld");
  assert.equal(byCode.CodigoNovoDesconhecido.feeType, "other");
  assert.equal(byCode.GiftWrapZero, undefined); // valor zero não vira linha
});

test("estorno vira fee refund e devolve a comissão como crédito", () => {
  const fees = normalizeAmazonFinanceFees({
    RefundEventList: [
      {
        AmazonOrderId: "701-2",
        ShipmentItemAdjustmentList: [
          {
            ItemChargeAdjustmentList: [
              { ChargeType: "Principal", ChargeAmount: { Amount: "-49.90" } },
            ],
            ItemFeeAdjustmentList: [
              { FeeType: "Commission", FeeAmount: { Amount: "6.00" } },
            ],
          },
        ],
      },
    ],
  }, "BRL");

  const byCode = Object.fromEntries(fees.map((fee) => [fee.providerFeeCode, fee]));
  assert.equal(byCode.RefundPrincipal.feeType, "refund");
  assert.equal(byCode.RefundPrincipal.amount, 49.9); // débito do vendedor
  assert.equal(byCode.Commission.amount, -6); // comissão devolvida = crédito
});

// Frete grátis: a Amazon cobra o envio e desconta o mesmo valor. O comprador
// pagou ZERO de frete, e somar só o `ShippingPrice` inventava receita.
// Caso real: pedido 702-2192919-5915420 (08/08/2026) — a Amazon mostrava
// "Total do envio 8,90 · Promoção −8,90 · Total do produto 19,90" e o painel
// exibia R$ 28,80. Frete que não entrou, contado como se tivesse, inflando margem.
test("frete integralmente descontado não vira receita", () => {
  const { gross, buyerShipping } = normalizeAmazonOrderItems([
    {
      QuantityOrdered: 1,
      SellerSKU: "kit-clips-320",
      ItemPrice: { CurrencyCode: "BRL", Amount: "19.90" },
      ShippingPrice: { CurrencyCode: "BRL", Amount: "8.90" },
      ShippingDiscount: { CurrencyCode: "BRL", Amount: "8.90" },
    },
  ]);
  assert.equal(gross, 19.9);
  assert.equal(buyerShipping, 0);
});

test("frete parcialmente descontado conta só o que o comprador pagou", () => {
  const { buyerShipping } = normalizeAmazonOrderItems([
    {
      QuantityOrdered: 1,
      ItemPrice: { CurrencyCode: "BRL", Amount: "50.00" },
      ShippingPrice: { CurrencyCode: "BRL", Amount: "10.00" },
      ShippingDiscount: { CurrencyCode: "BRL", Amount: "4.00" },
    },
  ]);
  assert.equal(buyerShipping, 6);
});

test("frete sem desconto continua contando inteiro", () => {
  const { buyerShipping } = normalizeAmazonOrderItems([
    {
      QuantityOrdered: 1,
      ItemPrice: { CurrencyCode: "BRL", Amount: "50.00" },
      ShippingPrice: { CurrencyCode: "BRL", Amount: "12.34" },
    },
  ]);
  assert.equal(buyerShipping, 12.34);
});

// ─────────────────────────────────────────────────────────────────────────────
// DEFEITO QUE ESTES TESTES REPROVAM (medido em 20/09/2026, conta A15NQMF7A6J1Y0):
// os itens são conciliados com o pedido ainda `Pending`, quando a Amazon devolve
// ASIN/SKU/quantidade e NENHUM dinheiro. A soma caía em 0 e `gross = 0,00` era
// gravado no pedido; como o pedido já tinha linhas, o `OrderTotal` do envio não
// sobrescrevia. Resultado: 46 de 49 pedidos ENVIADOS de 19/09 valendo R$ 0,00 no
// banco (na Amazon: R$ 10,00 a R$ 24,90), ~97% dos enviados desde 31/08, e a tela
// dizendo "85 de 88 pedidos ainda sem valor publicado pela Amazon".
// ─────────────────────────────────────────────────────────────────────────────
test("itens de pedido Pending (sem ItemPrice) deixam o total DESCONHECIDO, nunca zero", () => {
  const normalized = normalizeAmazonOrderItems([
    { ASIN: "B0HG852JHD", SellerSKU: "SILV-GEL-10000", Title: "Bolinhas de gel", QuantityOrdered: 2 },
    { ASIN: "B0HG8F2VJ5", SellerSKU: "SILV-ESC-CANUDO-3", Title: "Escovas", QuantityOrdered: 1 },
  ]);
  assert.equal(normalized.items.length, 2, "o item do pendente continua sendo gravado");
  assert.equal(normalized.gross, null);
  assert.equal(normalized.buyerShipping, null);
  assert.equal(normalized.items[0].unitPrice, null);
});

test("o mesmo pedido, depois de enviado, passa a ter total — é o que a segunda busca grava", () => {
  const normalized = normalizeAmazonOrderItems([
    {
      ASIN: "B0HG852JHD", SellerSKU: "SILV-GEL-10000", Title: "Bolinhas de gel", QuantityOrdered: 2,
      ItemPrice: { CurrencyCode: "BRL", Amount: "29.80" },
      PromotionDiscount: { CurrencyCode: "BRL", Amount: "0.00" },
    },
  ]);
  assert.equal(normalized.gross, 29.8);
  assert.equal(normalized.buyerShipping, 0);
  assert.equal(normalized.items[0].unitPrice, 14.9);
});

test("ItemPrice 0,00 que a Amazon MANDOU é fato (zero), não ausência", () => {
  // Fronteira do outro lado: reposição gratuita vem com ItemPrice presente e zerado.
  const normalized = normalizeAmazonOrderItems([
    { ASIN: "B0X", SellerSKU: "REPOSICAO", QuantityOrdered: 1, ItemPrice: { CurrencyCode: "BRL", Amount: "0.00" } },
  ]);
  assert.equal(normalized.gross, 0);
  assert.equal(normalized.items[0].unitPrice, 0);
});

test("pedido com uma linha precificada e outra não soma o que tem preço", () => {
  const normalized = normalizeAmazonOrderItems([
    { ASIN: "B0A", SellerSKU: "A", QuantityOrdered: 1, ItemPrice: { CurrencyCode: "BRL", Amount: "16.90" } },
    { ASIN: "B0B", SellerSKU: "B", QuantityOrdered: 1 },
  ]);
  assert.equal(normalized.gross, 16.9);
  assert.equal(normalized.items[1].unitPrice, null);
});
