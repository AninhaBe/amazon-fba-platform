import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalShopeeFees,
  canonicalShopeeStatus,
  normalizeShopeeOrder,
  normalizeShopeeProduct,
  sanitizeShopeeOrder,
  sanitizeShopeeProduct,
} from "../src/lib/integrations/shopeeCanonical.ts";
import { SHOPEE_CATALOG_CAPABILITIES } from "../src/lib/integrations/shopeeCapabilities.ts";

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
  // Status novo/desconhecido interrompe o lote; não é reclassificado.
  assert.throws(() => canonicalShopeeStatus("ALGO_NOVO"), /desconhecido/);
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

test("raw do pedido usa allowlist e descarta PII e campos desconhecidos", () => {
  const source = baseOrder({
    buyer_username: "pessoa",
    recipient_address: { name: "Nome Privado", phone: "11999999999", full_address: "Rua Privada" },
    invoice_data: { tax_id: "documento-privado" },
    item_list: [{ ...baseOrder().item_list[0], buyer_note: "privado" }],
  });
  const raw = sanitizeShopeeOrder(source);
  assert.equal(JSON.stringify(raw).includes("Nome Privado"), false);
  assert.equal(JSON.stringify(raw).includes("documento-privado"), false);
  assert.equal(JSON.stringify(raw).includes("buyer_username"), false);
  assert.deepEqual(normalizeShopeeOrder(source).raw, raw);
});

test("raw do produto usa allowlist e descarta campos desconhecidos", () => {
  const source = {
    item_id: 1, item_sku: "SKU", item_name: "Produto", item_status: "NORMAL",
    stock_info_v2: { summary_info: { total_available_stock: 2, warehouse_address: "privado" } },
    price_info: [{ current_price: 10, internal_cost: 3 }], private_supplier: { email: "x@y.test" },
  };
  const raw = sanitizeShopeeProduct(source);
  assert.equal(JSON.stringify(raw).includes("x@y.test"), false);
  assert.equal(JSON.stringify(raw).includes("warehouse_address"), false);
  assert.equal(JSON.stringify(raw).includes("internal_cost"), false);
  assert.deepEqual(normalizeShopeeProduct(source).raw, raw);
});

test("escrow traduz as taxas para a taxonomia canônica", () => {
  const order = normalizeShopeeOrder(baseOrder(), { escrow: baseEscrow() });
  const byCode = Object.fromEntries(order.fees.map((fee) => [fee.providerFeeCode, fee]));

  assert.equal(byCode.commission_fee.feeType, "commission");
  assert.equal(byCode.commission_fee.amount, 25.98);
  assert.equal(byCode.service_fee.feeType, "commission");
  assert.equal(byCode.seller_transaction_fee.feeType, "payment");
  // ⚠️ INVERTEU EM 30/08/2026: `actual_shipping_fee` NAO vira mais linha de
  // custo. Medido em 160 pedidos da loja real — o escrow nunca desconta esse
  // frete do repasse (o comprador paga e a Shopee estorna). Mapea-lo como
  // `shipping_seller` fazia a tela mostrar prejuizo onde havia lucro.
  assert.equal(byCode.actual_shipping_fee, undefined);
  // O frete do COMPRADOR continua sendo informado — ele explica o faturamento,
  // nao deduz dele.
  assert.equal(order.buyerShipping, 19.9);
  // escrow_tax veio zero: não vira linha de taxa.
  assert.equal(byCode.escrow_tax, undefined);
});

test("taxa zerada nao gera linha — nem o frete, que deixou de ser custo", () => {
  // ⚠️ INVERTEU EM 30/08/2026. A excecao que gravava `actual_shipping_fee` zerado
  // "porque marca o pedido como completo" morreu junto com o mapeamento: o campo
  // nao e mais custo da vendedora, e uma linha orfa apontaria para um tipo que
  // este mapa nao produz mais.
  const fees = canonicalShopeeFees({ actual_shipping_fee: 0, commission_fee: 0 }, "BRL");
  const codes = fees.map((fee) => fee.providerFeeCode);
  assert.ok(!codes.includes("actual_shipping_fee"));
  assert.ok(!codes.includes("commission_fee"));
  assert.equal(fees.length, 0);
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

test("pedido pago sem itens falha em vez de fabricar receita zero", () => {
  assert.throws(
    () => normalizeShopeeOrder(baseOrder({ item_list: undefined })),
    /receita não pode ser inferida/
  );
});

test("pedido rejeita item sem identidade e quantidade não positiva", () => {
  assert.throws(
    () => normalizeShopeeOrder(baseOrder({ item_list: [{ ...baseOrder().item_list[0], item_id: undefined }] })),
    /item_id válido/
  );
  assert.throws(
    () => normalizeShopeeOrder(baseOrder({ item_list: [{ ...baseOrder().item_list[0], model_quantity_purchased: 0 }] })),
    /positivo/
  );
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
  const facts = { stock_info_v2: { summary_info: { total_available_stock: 0 } }, price_info: [{ current_price: 0 }] };
  assert.equal(normalizeShopeeProduct({ item_id: 1, item_status: "UNLIST", ...facts }).status, "paused");
  assert.equal(normalizeShopeeProduct({ item_id: 1, item_status: "BANNED", ...facts }).status, "closed");
  // Status desconhecido interrompe o snapshot; não vira pausado silenciosamente.
  assert.throws(() => normalizeShopeeProduct({ item_id: 1, item_status: "XPTO", ...facts }), /desconhecido/);
});

test("pedido com status desconhecido falha fechado antes de persistir", () => {
  assert.throws(() => normalizeShopeeOrder(baseOrder({ order_status: "FUTURE_STATUS" })), /desconhecido/);
  assert.throws(() => normalizeShopeeOrder(baseOrder({ order_status: "" })), /desconhecido/);
});

test("pedido sem create_time real falha e nunca usa o relógio local", () => {
  for (const create_time of [undefined, null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => normalizeShopeeOrder(baseOrder({ create_time })),
      /create_time válido.*data atual não será fabricada/,
    );
  }
});

test("produto sem preço ou estoque falha em vez de fabricar zero", () => {
  assert.throws(() => normalizeShopeeProduct({ item_id: null, item_status: "NORMAL" }), /item_id válido/);
  assert.throws(() => normalizeShopeeProduct({ item_id: 1, item_status: "NORMAL" }), /price_info/);
  assert.throws(
    () => normalizeShopeeProduct({ item_id: 1, item_status: "NORMAL", price_info: [{ current_price: 10 }] }),
    /stock_info_v2/
  );
});

test("capacidade de catálogo não promete modelos sem contrato oficial local", () => {
  assert.equal(SHOPEE_CATALOG_CAPABILITIES.itemBaseInfo, true);
  assert.equal(SHOPEE_CATALOG_CAPABILITIES.aggregateStock, true);
  assert.equal(SHOPEE_CATALOG_CAPABILITIES.models, false);
});
