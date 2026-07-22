import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalOrderStatus,
  normalizeMercadoLivreOrder,
  normalizeMercadoLivreProduct,
} from "../src/lib/integrations/mercadoLivreCanonical.ts";

const SELLER_ID = "123456";

function baseOrder(overrides = {}) {
  return {
    id: 2000001,
    status: "paid",
    date_created: "2026-07-10T14:32:00.000-04:00",
    date_closed: "2026-07-10T14:35:00.000-04:00",
    total_amount: 259.7,
    currency_id: "BRL",
    pack_id: 987654,
    shipping: { id: 555 },
    tags: ["pack_order"],
    order_items: [
      {
        item: { id: "MLB111", title: "Garrafa térmica 1L", seller_sku: "GAR-1L" },
        quantity: 2,
        unit_price: 89.9,
        sale_fee: 14.53,
      },
      {
        item: { id: "MLB222", title: "Copo dosador", seller_sku: null },
        quantity: 1,
        unit_price: 79.9,
        sale_fee: 12.9,
      },
    ],
    ...overrides,
  };
}

const shipment = {
  receiver: { cost: 19.9 },
  senders: [
    { user_id: 123456, cost: 32.45 },
    { user_id: 999999, cost: 5 },
  ],
};

test("normaliza pedido pago com itens, comissão e fretes", () => {
  const order = normalizeMercadoLivreOrder(baseOrder(), { shipment, sellerId: SELLER_ID });

  assert.equal(order.externalOrderId, "2000001");
  assert.equal(order.status, "paid");
  assert.equal(order.providerStatus, "paid");
  assert.equal(order.currency, "BRL");
  // gross vem dos itens (2×89,90 + 79,90), nunca de total_amount.
  assert.equal(order.gross, 259.7);
  assert.equal(order.packId, "987654");
  assert.equal(order.items.length, 2);
  assert.deepEqual(order.items[0], {
    externalProductId: "MLB111",
    sku: "GAR-1L",
    title: "Garrafa térmica 1L",
    qty: 2,
    unitPrice: 89.9,
  });
  assert.equal(order.items[1].sku, null);

  const commission = order.fees.find((fee) => fee.feeType === "commission");
  assert.deepEqual(commission, {
    feeType: "commission",
    providerFeeCode: "sale_fee",
    amount: 41.96, // 14,53×2 + 12,90
    currency: "BRL",
  });
  const sellerShipping = order.fees.find((fee) => fee.feeType === "shipping_seller");
  assert.equal(sellerShipping.amount, 32.45); // sender da conta, não a soma
  assert.equal(order.buyerShipping, 19.9);
});

test("sale_fee ausente em qualquer linha omite a comissão (pedido não processado)", () => {
  const withNullFee = baseOrder();
  withNullFee.order_items[1].sale_fee = null;
  const order = normalizeMercadoLivreOrder(withNullFee, { shipment, sellerId: SELLER_ID });
  assert.equal(order.fees.some((fee) => fee.feeType === "commission"), false);
});

test("sem custos do shipment, frete fica desconhecido em vez de zero", () => {
  const order = normalizeMercadoLivreOrder(baseOrder(), { shipment: null, sellerId: SELLER_ID });
  assert.equal(order.buyerShipping, null);
  assert.equal(order.fees.some((fee) => fee.feeType === "shipping_seller"), false);
});

test("sem sender da conta, usa a soma dos senders como frete do vendedor", () => {
  const order = normalizeMercadoLivreOrder(baseOrder(), {
    shipment: { receiver: { cost: null }, senders: [{ user_id: 1, cost: 10.1 }, { user_id: 2, cost: 5.55 }] },
    sellerId: SELLER_ID,
  });
  const sellerShipping = order.fees.find((fee) => fee.feeType === "shipping_seller");
  assert.equal(sellerShipping.amount, 15.65);
  assert.equal(order.buyerShipping, 0);
});

test("frete grátis para o vendedor vira linha de valor 0, não ausência", () => {
  const order = normalizeMercadoLivreOrder(baseOrder(), {
    shipment: { receiver: { cost: 0 }, senders: [{ user_id: 123456, cost: 0 }] },
    sellerId: SELLER_ID,
  });
  const sellerShipping = order.fees.find((fee) => fee.feeType === "shipping_seller");
  assert.equal(sellerShipping.amount, 0);
  assert.equal(order.buyerShipping, 0);
});

test("mapeia status do ML para o canônico", () => {
  assert.equal(canonicalOrderStatus(baseOrder({ status: "confirmed" })), "pending");
  assert.equal(canonicalOrderStatus(baseOrder({ status: "payment_required" })), "pending");
  assert.equal(canonicalOrderStatus(baseOrder({ status: "cancelled" })), "cancelled");
  assert.equal(canonicalOrderStatus(baseOrder({ status: "invalid" })), "cancelled");
  assert.equal(canonicalOrderStatus(baseOrder({ status: "algum_status_novo" })), "pending");
  assert.equal(
    canonicalOrderStatus(baseOrder({ status: "paid", tags: ["delivered"] })),
    "delivered"
  );
  // A tag delivered só promove pedidos pagos.
  assert.equal(
    canonicalOrderStatus(baseOrder({ status: "cancelled", tags: ["delivered"] })),
    "cancelled"
  );
});

test("tag fulfilled marca o pedido como logística da plataforma (Full)", () => {
  const full = normalizeMercadoLivreOrder(baseOrder({ tags: ["fulfilled"] }), {
    shipment: null,
    sellerId: SELLER_ID,
  });
  assert.equal(full.fulfillment, "platform");
  const own = normalizeMercadoLivreOrder(baseOrder({ tags: [] }), {
    shipment: null,
    sellerId: SELLER_ID,
  });
  assert.equal(own.fulfillment, null);
});

test("arredonda dinheiro a 2 casas sem acumular erro binário", () => {
  const order = normalizeMercadoLivreOrder(
    baseOrder({
      order_items: [
        { item: { id: "MLB333", title: "Item", seller_sku: "X" }, quantity: 3, unit_price: 0.1, sale_fee: 0.1 },
      ],
    }),
    { shipment: null, sellerId: SELLER_ID }
  );
  assert.equal(order.gross, 0.3);
  assert.equal(order.fees[0].amount, 0.3);
});

test("normaliza produto com status e logística canônicos", () => {
  const product = normalizeMercadoLivreProduct({
    id: "MLB111",
    costId: "mercado_livre:conn:sku:GAR-1L",
    sku: "GAR-1L",
    title: "Garrafa térmica 1L",
    price: 89.9,
    currency: "BRL",
    availableQuantity: 42,
    soldQuantity: 310,
    status: "active",
    activeSince: "2025-01-01T00:00:00Z",
    lastUpdated: null,
    thumbnail: "https://http2.mlstatic.com/x.jpg",
    permalink: "https://produto.mercadolivre.com.br/MLB111",
    userProductId: null,
    listingTypeId: "gold_special",
    logisticType: "fulfillment",
    shippingMode: "me2",
    freeShipping: true,
    catalogListing: false,
    catalogProductId: null,
    cost: 35,
  });

  assert.equal(product.externalProductId, "MLB111");
  assert.equal(product.status, "active");
  assert.equal(product.fulfillment, "platform");
  assert.equal(product.availableQty, 42);

  const paused = normalizeMercadoLivreProduct({ ...productFixtureBase(), status: "under_review", logisticType: "cross_docking" });
  assert.equal(paused.status, "paused");
  assert.equal(paused.providerStatus, "under_review");
  assert.equal(paused.fulfillment, "seller");
});

function productFixtureBase() {
  return {
    id: "MLB999",
    costId: "mercado_livre:conn:item:MLB999",
    sku: null,
    title: "Produto",
    price: 10,
    currency: "BRL",
    availableQuantity: 0,
    soldQuantity: 0,
    status: "active",
    activeSince: null,
    lastUpdated: null,
    thumbnail: null,
    permalink: null,
    userProductId: null,
    listingTypeId: null,
    logisticType: null,
    shippingMode: null,
    freeShipping: false,
    catalogListing: false,
    catalogProductId: null,
    cost: null,
  };
}
