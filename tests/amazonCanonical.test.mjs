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
    unitPrice: 45, // 90 ÷ 2
  });
  assert.equal(normalized.items[1].sku, null);
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
