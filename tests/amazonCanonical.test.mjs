import test from "node:test";
import assert from "node:assert/strict";
import {
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
