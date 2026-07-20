import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAmazonOrder } from "../src/lib/amazonOrder.ts";

test("normaliza os campos oficiais de pedidos da Amazon", () => {
  assert.deepEqual(
    normalizeAmazonOrder({
      AmazonOrderId: "701-1234567-1234567",
      PurchaseDate: "2026-07-20T12:34:56Z",
      OrderStatus: "Shipped",
      FulfillmentChannel: "AFN",
      SalesChannel: "Amazon.com.br",
      NumberOfItemsShipped: 2,
      NumberOfItemsUnshipped: 0,
      OrderTotal: { CurrencyCode: "BRL", Amount: "67.98" },
    }),
    {
      amazonOrderId: "701-1234567-1234567",
      purchaseDate: "2026-07-20T12:34:56Z",
      orderStatus: "Shipped",
      fulfillmentChannel: "AFN",
      salesChannel: "Amazon.com.br",
      numberOfItemsShipped: 2,
      numberOfItemsUnshipped: 0,
      orderTotal: { CurrencyCode: "BRL", Amount: "67.98" },
    }
  );
});

test("mantém compatibilidade com pedidos já normalizados", () => {
  const order = {
    amazonOrderId: "701-7654321-7654321",
    purchaseDate: "2026-07-19T10:00:00Z",
    orderStatus: "Unshipped",
    orderTotal: { CurrencyCode: "BRL", Amount: "42.99" },
  };
  assert.deepEqual(normalizeAmazonOrder(order), {
    ...order,
    fulfillmentChannel: undefined,
    salesChannel: undefined,
    numberOfItemsShipped: undefined,
    numberOfItemsUnshipped: undefined,
  });
});

test("descarta pedidos sem identificador ou data em vez de renderizar dados inválidos", () => {
  assert.equal(normalizeAmazonOrder({ PurchaseDate: "2026-07-20T12:34:56Z" }), null);
  assert.equal(normalizeAmazonOrder({ AmazonOrderId: "701-1234567-1234567" }), null);
});
