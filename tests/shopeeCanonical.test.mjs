import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalShopeeFees,
  canonicalShopeeStatus,
  normalizeShopeeOrder,
  normalizeShopeeProduct,
} from "../src/lib/integrations/shopeeCanonical.ts";

// Payloads no formato documentado da API v2 (get_order_detail e
// get_escrow_detail), conferido na doc oficial em 05/08/2026.

function baseOrder(overrides = {}) {
  return {
    order_sn: "220805ABCDEF12",
    order_status: "READY_TO_SHIP",
    create_time: 1754400000,
    update_time: 1754486400,
    currency: "BRL",
    region: "BR",
    item_list: [
      {
        item_id: 1680783,
        model_id: 327890123,
        item_sku: "MOCHILA-USB",
        model_sku: "MOCHILA-USB-PRETA",
        item_name: "Mochila Antifurto",
        model_name: "Preta",
        model_quantity_purchased: 2,
        model_original_price: 149.9,
        model_discounted_price: 129.9,
      },
    ],
    ...overrides,
  };
}

function baseEscrow(overrides = {}) {
  return {
    order_sn: "220805ABCDEF12",
    order_income: {
      escrow_amount: 210.5,
      buyer_total_amount: 279.7,
      original_price: 299.8,
      seller_discount: 40,
      buyer_paid_shipping_fee: 19.9,
      actual_shipping_fee: 21.9,
      commission_fee: 25.98,
      service_fee: 5.2,
      seller_transaction_fee: 3.12,
      escrow_tax: 0,
      ...overrides,
    },
  };
}

test("status da Shopee mapeia para o canônico", () => {
  assert.equal(canonicalShopeeStatus("UNPAID"), "pending");
  assert.equal(canonicalShopeeStatus("READY_TO_SHIP"), "paid");
  assert.equal(canonicalShopeeStatus("PROCESSED"), "paid");
  assert.equal(canonicalShopeeStatus("SHIPPED"), "shipped");
  assert.equal(canonicalShopeeStatus("COMPLETED"), "delivered");
  assert.equal(canonicalShopeeStatus("CANCELLED"), "cancelled");
  assert.equal(canonicalShopeeStatus("TO_RETURN"), "refunded");
  // INVOICE_PENDING é do Brasil: pago, só falta a NF-e — conta como receita.
  assert.equal(canonicalShopeeStatus("INVOICE_PENDING"), "paid");
  // Status novo/desconhecido não pode virar receita por acidente.
  assert.equal(canonicalShopeeStatus("ALGO_NOVO"), "pending");
});

test("pedido sem escrow entra sem tarifa e com frete desconhecido", () => {
  const order = normalizeShopeeOrder(baseOrder());
  assert.equal(order.externalOrderId, "220805ABCDEF12");
  assert.equal(order.status, "paid");
  assert.equal(order.providerStatus, "READY_TO_SHIP");
  assert.equal(order.gross, 259.8); // 129.90 × 2
  assert.deepEqual(order.fees, []);
  // null = desconhecido. Zero seria afirmar que não houve frete.
  assert.equal(order.buyerShipping, null);
  assert.equal(order.items.length, 1);
  assert.equal(order.items[0].sku, "MOCHILA-USB-PRETA"); // SKU da variação vence
  assert.equal(order.items[0].qty, 2);
  assert.equal(order.items[0].unitPrice, 129.9); // preço com desconto, não o de lista
});

test("escrow traduz as taxas para a taxonomia canônica", () => {
  const order = normalizeShopeeOrder(baseOrder(), { escrow: baseEscrow() });
  const byCode = Object.fromEntries(order.fees.map((fee) => [fee.providerFeeCode, fee]));

  assert.equal(byCode.commission_fee.feeType, "commission");
  assert.equal(byCode.commission_fee.amount, 25.98);
  assert.equal(byCode.service_fee.feeType, "commission");
  assert.equal(byCode.seller_transaction_fee.feeType, "payment");
  assert.equal(byCode.actual_shipping_fee.feeType, "shipping_seller");
  assert.equal(byCode.actual_shipping_fee.amount, 21.9);
  assert.equal(order.buyerShipping, 19.9);
  // escrow_tax veio zero: não vira linha de taxa.
  assert.equal(byCode.escrow_tax, undefined);
});

test("frete zero é fato conhecido e gera linha; taxa ausente não gera", () => {
  const fees = canonicalShopeeFees({ actual_shipping_fee: 0, commission_fee: 0 }, "BRL");
  const codes = fees.map((fee) => fee.providerFeeCode);
  // Frete zero precisa existir: é o que marca o pedido como completo no lucro.
  assert.ok(codes.includes("actual_shipping_fee"));
  // Comissão zero não agrega informação.
  assert.ok(!codes.includes("commission_fee"));
});

test("campos de anúncio e imposto entram nas categorias certas", () => {
  const fees = canonicalShopeeFees(
    { campaign_fee: 10, order_ams_commission_fee: 4.5, escrow_tax: 7.25, seller_return_refund: 30 },
    "BRL"
  );
  const byCode = Object.fromEntries(fees.map((fee) => [fee.providerFeeCode, fee.feeType]));
  assert.equal(byCode.campaign_fee, "ads");
  assert.equal(byCode.order_ams_commission_fee, "ads");
  assert.equal(byCode.escrow_tax, "taxes_withheld");
  assert.equal(byCode.seller_return_refund, "refund");
});

test("pedido concluído registra a data de fechamento", () => {
  const order = normalizeShopeeOrder(baseOrder({ order_status: "COMPLETED" }));
  assert.equal(order.status, "delivered");
  assert.equal(order.closedAt, new Date(1754486400 * 1000).toISOString());
});

test("pedido sem itens não quebra a normalização", () => {
  const order = normalizeShopeeOrder(baseOrder({ item_list: undefined }));
  assert.equal(order.gross, 0);
  assert.deepEqual(order.items, []);
});

test("produto normaliza status, estoque e preço", () => {
  const product = normalizeShopeeProduct({
    item_id: 1680783,
    item_sku: "MOCHILA-USB",
    item_name: "Mochila Antifurto com Porta USB",
    item_status: "NORMAL",
    stock_info_v2: { summary_info: { total_available_stock: 140 } },
    price_info: [{ current_price: 129.9, original_price: 149.9, currency: "BRL" }],
    image: { image_url_list: ["https://cf.shopee.com.br/file/abc"] },
  });

  assert.equal(product.externalProductId, "1680783");
  assert.equal(product.status, "active");
  assert.equal(product.providerStatus, "NORMAL");
  assert.equal(product.availableQty, 140);
  assert.equal(product.price, 129.9);
  assert.equal(product.thumbnail, "https://cf.shopee.com.br/file/abc");

  // UNLIST é anúncio pausado, não encerrado.
  assert.equal(normalizeShopeeProduct({ item_id: 1, item_status: "UNLIST" }).status, "paused");
  assert.equal(normalizeShopeeProduct({ item_id: 1, item_status: "BANNED" }).status, "closed");
  // Status desconhecido não pode virar "ativo" e poluir o radar de estoque.
  assert.equal(normalizeShopeeProduct({ item_id: 1, item_status: "XPTO" }).status, "paused");
});
