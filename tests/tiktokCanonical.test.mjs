import test from "node:test";
import assert from "node:assert/strict";
import {
  agruparItens,
  canonicalTiktokFees,
  canonicalTiktokProductStatus,
  canonicalTiktokStatus,
  normalizeTiktokOrder,
  normalizeTiktokProduct,
  normalizeTiktokProducts,
  sanitizeTiktokProduct,
  sanitizeTiktokOrder,
  tiktokStatementSettled,
  validateTiktokOrderForSync,
} from "../src/lib/integrations/tiktokCanonical.ts";
import { deriveTiktokSyncPhase, TiktokConnectionError } from "../src/lib/integrations/tiktokContract.ts";

test("raw usa allowlist e descarta PII e chaves desconhecidas inclusive aninhadas", () => {
  const raw = sanitizeTiktokOrder({
    id: "o1", status: "COMPLETED", create_time: 1,
    buyer_email: "pessoa@example.com", phone: "+55 11 99999-9999", cpf: "123.456.789-00",
    cpf_name: "Pessoa da Silva", recipient_address: { full_address: "Rua Privada" },
    unknown_nested: { email: "vaza@example.com", address: { line: "Segredo" } },
    payment: { currency: "BRL", total_amount: "10", unknown: { phone: "11999999999" } },
    line_items: [{ product_id: "p1", seller_sku: "sku", sale_price: "10", buyer_name: "Nome Privado" }],
    packages: [{ id: "pkg", recipient: { cpf: "123" } }],
  });
  assert.deepEqual(raw, {
    id: "o1", status: "COMPLETED", create_time: 1,
    payment: { currency: "BRL", total_amount: "10" },
    line_items: [{ product_id: "p1", seller_sku: "sku", sale_price: "10" }],
    packages: [{ id: "pkg" }],
  });
  const serialized = JSON.stringify(raw);
  for (const pii of ["example.com", "99999", "Rua Privada", "123.456", "Pessoa da Silva", "Segredo", "Nome Privado"])
    assert.equal(serialized.includes(pii), false, `raw não contém ${pii}`);
});

test("contrato de sync distingue primeira carga, parcial, pronto e erro retryable", () => {
  assert.equal(deriveTiktokSyncPhase({ available: true, status: "pending" }), "first_sync");
  assert.equal(deriveTiktokSyncPhase({ available: true, status: "syncing", hasCoverage: true }), "partial");
  assert.equal(deriveTiktokSyncPhase({ available: true, status: "complete" }), "ready");
  assert.equal(deriveTiktokSyncPhase({ available: true, status: "complete", hasFinancialBacklog: true }), "partial");
  assert.equal(deriveTiktokSyncPhase({ available: true, status: "error" }), "retryable_error");
  assert.equal(deriveTiktokSyncPhase({ available: false }), "unavailable");
  const reauth = new TiktokConnectionError("REAUTH_REQUIRED", "Reconecte a loja.");
  assert.equal(reauth.code, "REAUTH_REQUIRED");
});

// Todos os formatos abaixo vieram da loja real (Crystal Fancy) em 10/08/2026 —
// não da documentação, que já nos enganou uma vez sobre o sinal das taxas.

test("uma linha por unidade vira um item com quantidade", () => {
  // Pedido 583994051069248965: 10 linhas do MESMO sku_id.
  const linhas = Array.from({ length: 10 }, (_, i) => ({
    id: `58399405106931450${i}`,
    product_id: "1733525994757522443",
    sku_id: "1733525994757522443",
    seller_sku: "24CANETAS-TIKTOK",
    sale_price: "8.99",
    sku_name: "24 Unidades",
    product_name: "Canetas",
  }));
  const itens = agruparItens(linhas);
  assert.equal(itens.length, 1, "10 linhas do mesmo SKU são um item só");
  assert.equal(itens[0].qty, 10);
  assert.equal(itens[0].sku, "24CANETAS-TIKTOK");
  assert.equal(itens[0].unitPrice, 8.99, "preço é unitário, não somado");
});

test("SKUs diferentes continuam itens separados", () => {
  const itens = agruparItens([
    { product_id: "p1", sku_id: "s1", seller_sku: "A", sale_price: "10" },
    { product_id: "p1", sku_id: "s2", seller_sku: "B", sale_price: "20" },
    { product_id: "p1", sku_id: "s1", seller_sku: "A", sale_price: "10" },
  ]);
  assert.equal(itens.length, 2);
  assert.equal(itens.find((i) => i.sku === "A").qty, 2);
  assert.equal(itens.find((i) => i.sku === "B").qty, 1);
});

test("item de pedido usa o mesmo identificador composto da oferta variante", () => {
  const [item] = agruparItens([
    { product_id: "p1", sku_id: "s1", seller_sku: "SKU-1", sale_price: "10" },
  ]);
  assert.equal(item.externalProductId, "p1::sku:s1");
  const [legacy] = agruparItens([{ product_id: "p2", seller_sku: "SKU-2", sale_price: "20" }]);
  assert.equal(legacy.externalProductId, "p2");
});

test("item sem preço não fabrica zero", () => {
  assert.throws(
    () => agruparItens([{ product_id: "p1", sku_id: "s1", seller_sku: "SKU-1" }]),
    /sem preço comprovável/
  );
});

test("taxa negativa do TikTok vira taxa POSITIVA no canônico", () => {
  // Extrato real do pedido 583985901599294689.
  const taxas = canonicalTiktokFees(
    {
      currency: "BRL",
      revenue_amount: "23.9",
      fee_and_tax_amount: "-9.13",
      shipping_cost_amount: "0",
      settlement_amount: "14.77",
    },
    "BRL"
  );
  const comissao = taxas.find((t) => t.feeType === "commission");
  assert.equal(comissao.amount, 9.13, "positivo = debitado do vendedor; o sinal do TikTok é invertido");
  assert.ok(comissao.amount > 0, "taxa negativa somaria ao lucro em vez de subtrair");
});

test("tarifas zero são fatos conhecidos e entram", () => {
  const taxas = canonicalTiktokFees(
    { currency: "BRL", fee_and_tax_amount: "0", shipping_cost_amount: "0" },
    "BRL"
  );
  assert.equal(taxas.filter((t) => t.feeType === "commission").length, 1);
  assert.equal(taxas.filter((t) => t.feeType === "shipping_seller").length, 1);
  assert.equal(taxas.find((t) => t.feeType === "commission").amount, 0);
});

test("taxa ausente não vira zero", () => {
  const taxas = canonicalTiktokFees({ currency: "BRL" }, "BRL");
  assert.equal(taxas.length, 0, "sem dado é desconhecido, não custo zero");
});

test("extrato zerado sem transações continua pendente", () => {
  assert.equal(tiktokStatementSettled({
    revenue_amount: "0",
    fee_and_tax_amount: "0",
    shipping_cost_amount: "0",
    settlement_amount: "0",
    order_create_time: 0,
    total_count: 0,
    sku_transactions: [],
  }), false);
});

test("extrato financeiro real é considerado fechado", () => {
  assert.equal(tiktokStatementSettled({
    revenue_amount: "23.9",
    fee_and_tax_amount: "-9.13",
    settlement_amount: "14.77",
  }), true);
});

test("status observados na loja real mapeiam certo", () => {
  assert.equal(canonicalTiktokStatus("COMPLETED"), "delivered");
  assert.equal(canonicalTiktokStatus("CANCELLED"), "cancelled");
  assert.equal(canonicalTiktokStatus("AWAITING_SHIPMENT"), "paid");
  assert.equal(canonicalTiktokStatus("IN_TRANSIT"), "shipped");
});

test("status desconhecido interrompe a ingestão em vez de virar pending silenciosamente", () => {
  assert.throws(
    () => canonicalTiktokStatus("STATUS_NOVO_DA_API"),
    /ainda não mapeado/
  );
});

test("status desconhecido de produto interrompe o snapshot em vez de virar paused", () => {
  assert.equal(canonicalTiktokProductStatus("ACTIVATE"), "active");
  assert.equal(canonicalTiktokProductStatus("SELLER_DEACTIVATED"), "paused");
  assert.throws(
    () => normalizeTiktokProducts({
      id: "p-status-novo", status: "STATUS_NOVO_DA_API",
      skus: [{ id: "s", price: { sale_price: "10" }, inventory: [{ quantity: 1 }] }],
    }),
    /Status de produto TikTok ainda não mapeado/
  );
});

test("pedido sem data real não aparece como venda no momento da sincronização", () => {
  const order = { id: "pedido-sem-data", status: "COMPLETED", line_items: [] };
  assert.throws(() => validateTiktokOrderForSync(order), /data de criação válida/);
  assert.throws(() => normalizeTiktokOrder(order), /data de criação válida/);
});

test("pedido sem identificador é recusado antes do upsert", () => {
  assert.throws(
    () => validateTiktokOrderForSync({ id: "", status: "COMPLETED", create_time: 1 }),
    /sem identificador/
  );
});

test("pedido sem itens usa subtotal comprovado e nunca fabrica gross zero", () => {
  const base = { id: "o-subtotal", status: "COMPLETED", create_time: 1, line_items: [] };
  assert.equal(normalizeTiktokOrder({ ...base, payment: { currency: "BRL", sub_total: "19.90" } }).gross, 19.9);
  assert.throws(() => normalizeTiktokOrder(base), /sem itens ou subtotal confiável/);
});

test("raw de produto usa allowlist e descarta campos desconhecidos", () => {
  const product = {
    id: "p1", title: "Produto", status: "ACTIVATE", secret_note: "não persistir",
    skus: [{ id: "s1", seller_sku: "SKU", private: { email: "x@y.test" }, price: { sale_price: "10", currency: "BRL", hidden: "x" }, inventory: [{ quantity: 2, warehouse_address: "privado" }] }],
  };
  const raw = sanitizeTiktokProduct(product);
  assert.equal(JSON.stringify(raw).includes("não persistir"), false);
  assert.equal(JSON.stringify(raw).includes("x@y.test"), false);
  assert.equal(JSON.stringify(raw).includes("privado"), false);
  assert.deepEqual(normalizeTiktokProduct(product).raw, raw);
});

test("produto multi-SKU vira uma oferta canônica por variação sem estoque agregado", () => {
  const offers = normalizeTiktokProducts({
    id: "produto", title: "Camiseta", status: "ACTIVATE",
    skus: [
      { id: "var-p", seller_sku: "CAM-P", price: { sale_price: "29.90", currency: "BRL" }, inventory: [{ quantity: 2 }, { quantity: 3 }] },
      { id: "var-g", seller_sku: "CAM-G", price: { sale_price: "39.90", currency: "BRL" }, inventory: [{ quantity: 7 }] },
    ],
  });
  assert.equal(offers.length, 2);
  assert.deepEqual(offers.map(({ externalProductId, sku, price, availableQty }) => ({ externalProductId, sku, price, availableQty })), [
    { externalProductId: "produto::sku:var-p", sku: "CAM-P", price: 29.9, availableQty: 5 },
    { externalProductId: "produto::sku:var-g", sku: "CAM-G", price: 39.9, availableQty: 7 },
  ]);
  assert.throws(() => normalizeTiktokProduct({ id: "produto", status: "ACTIVATE", skus: [
    { id: "a", price: { sale_price: "1" }, inventory: [{ quantity: 1 }] },
    { id: "b", price: { sale_price: "2" }, inventory: [{ quantity: 1 }] },
  ] }), /múltiplas variações/);
});

test("catálogo não inventa preço ou estoque zero quando o payload está incompleto", () => {
  assert.throws(() => normalizeTiktokProducts({ id: "p", skus: [] }), /não podem ser inferidos/);
  assert.throws(() => normalizeTiktokProducts({ id: "p", skus: [{ id: "s", inventory: [{ quantity: 1 }] }] }), /sem preço conhecido/);
  assert.throws(() => normalizeTiktokProducts({ id: "p", skus: [{ id: "s", price: { sale_price: "10" } }] }), /sem estoque conhecido/);
});

test("produto real 202502 aceita tax_exclusive_price", () => {
  const [offer] = normalizeTiktokProducts({
    id: "p-real", title: "Produto", status: "ACTIVATE",
    skus: [{ id: "s-real", seller_sku: "SKU", price: { tax_exclusive_price: "23.90", currency: "BRL" }, inventory: [{ quantity: 4 }] }],
  });
  assert.equal(offer.price, 23.9);
  assert.equal(offer.availableQty, 4);
});

test("extrato fechado sem componentes não cria fatos financeiros sintéticos", () => {
  const statement = { revenue_amount: "10", settlement_amount: "10" };
  const fees = canonicalTiktokFees(statement, "BRL");
  const order = normalizeTiktokOrder({
    id: "o-settled", status: "COMPLETED", create_time: 1,
    line_items: [{ product_id: "p", seller_sku: "s", sale_price: "10" }],
  }, { statement });
  assert.deepEqual(fees, [], "consumidores financeiros genéricos não recebem fee sintética");
  assert.equal(order.raw._sellercore, undefined, "metadata operacional não viaja no payload externo");
  assert.equal(JSON.stringify(order.fees).includes("statement_settled"), false);
});
