import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeShopeeProduct, precoDoProdutoShopee } from "../src/lib/integrations/shopeeCanonical.ts";

// A PRIMEIRA SINCRONIZAÇÃO DA LOJA REAL MORREU NUM ITEM (27/08/2026).
//
// `shopee:275804987` (UTILEIRA) parou com "Shopee não informou
// price_info.current_price válido para 44862300302". Medido na origem, de
// dentro da Fly: o item tem `has_model: true`, e aí `get_item_base_info`
// devolve `price_info` e `stock_info_v2` AUSENTES — preço, estoque e moeda
// moram em `get_model_list`, por variação. O parser esperava tudo no item.
//
// Dois defeitos num só: o mapeamento estava no lugar errado, e a exceção
// derrubava a varredura inteira (0 pedidos, 0 produtos, covered_to nulo).

/** Item 44862300302 como a API respondeu de verdade (campos que importam). */
const ITEM_REAL = { item_id: 44862300302, item_name: "Capa para sofá", item_sku: "CAPA", item_status: "NORMAL", has_model: true };

/** `get_model_list` do MESMO item, valores reais das três variações. */
const MODELS_REAIS = [
  { model_id: 259261768807, model_name: "P (240x105x125cm)", model_sku: "CAPA-P",
    price_info: [{ current_price: 39.9, currency: "BRL" }],
    stock_info_v2: { summary_info: { total_available_stock: 500 } } },
  { model_id: 259261768808, model_name: "M (265x105x126cm)", model_sku: "CAPA-M",
    price_info: [{ current_price: 42.9, currency: "BRL" }],
    stock_info_v2: { summary_info: { total_available_stock: 913 } } },
  { model_id: 259261768809, model_name: "G (295x110x140cm)", model_sku: "CAPA-G",
    price_info: [{ current_price: 49.9, currency: "BRL" }],
    stock_info_v2: { summary_info: { total_available_stock: 200 } } },
];

test("item com variações pega o MENOR preço das variações e soma o estoque", () => {
  const produto = normalizeShopeeProduct(ITEM_REAL, MODELS_REAIS);
  // "A partir de": é o preço que o vendedor vê na vitrine.
  assert.equal(produto.price, 39.9);
  assert.equal(produto.availableQty, 500 + 913 + 200);
  assert.equal(produto.currency, "BRL", "a moeda vem da variação, não de um padrão");
  assert.equal(produto.status, "active");
});

test("o caso real 44862300302 deixa de lançar", () => {
  // Era exatamente esta chamada que derrubava a sincronização da loja do sócio.
  assert.doesNotThrow(() => normalizeShopeeProduct(ITEM_REAL, MODELS_REAIS));
});

test("item SEM variação continua lendo do próprio item", () => {
  const simples = { item_id: 1, item_name: "Caneca", item_status: "NORMAL", has_model: false,
    price_info: [{ current_price: 19.9, currency: "BRL" }],
    stock_info_v2: { summary_info: { total_available_stock: 7 } } };
  const produto = normalizeShopeeProduct(simples);
  assert.equal(produto.price, 19.9);
  assert.equal(produto.availableQty, 7);
});

test("preço ausente em TODA parte devolve null — e zero nunca é fabricado", () => {
  assert.equal(precoDoProdutoShopee(ITEM_REAL, []).price, null, "sem variação com preço, nao ha preco a afirmar");
  assert.equal(precoDoProdutoShopee(ITEM_REAL, undefined).price, null);
  // Variação sem preço não vira 0,00 — e o estoque dela continua sendo lido.
  const so = precoDoProdutoShopee(ITEM_REAL, [{ model_id: 1, stock_info_v2: { summary_info: { total_available_stock: 5 } } }]);
  assert.equal(so.price, null);
  assert.equal(so.availableQty, 5);
});

test("variação sem preço é ignorada, mas as com preço continuam valendo", () => {
  const misto = [{ model_id: 1 }, ...MODELS_REAIS];
  assert.equal(precoDoProdutoShopee(ITEM_REAL, misto).price, 39.9);
});

test("preço negativo é recusado como ausente", () => {
  assert.equal(precoDoProdutoShopee(ITEM_REAL, [{ model_id: 1, price_info: [{ current_price: -1 }] }]).price, null);
});

test("a varredura NÃO para em item sem preço: vira pendência e segue", () => {
  const sync = readFileSync(new URL("../src/lib/integrations/shopeeSync.ts", import.meta.url), "utf8");
  // O catch é restrito ao defeito de preço: qualquer outro erro continua subindo.
  assert.match(sync, /price_info\\.current_price\|stock_info_v2\/\.test\(motivo\)\) throw error;/);
  assert.match(sync, /semPreco\.push\(String\(product\.item_id\)\)/);
  assert.match(sync, /item\(ns\) sem preço ou estoque informado pela Shopee/);
  // E o item com variação ganha a segunda chamada, só ele.
  assert.match(sync, /if \(!product\.has_model\) continue;/);
  assert.match(sync, /getShopeeModelList\(connection, Number\(product\.item_id\)\)/);
});

test("o endpoint novo é o v2 correto e pede um item por vez", () => {
  const api = readFileSync(new URL("../src/lib/integrations/shopee.ts", import.meta.url), "utf8");
  assert.match(api, /"\/api\/v2\/product\/get_model_list"/);
  assert.match(api, /item_id: String\(itemId\)/);
});

test("estoque ausente NAO vira zero: item com preco mas sem estoque ainda recusa", () => {
  // Era o que o teste antigo protegia, e eu quase quebrei: somar 0 aqui
  // afirmaria "esgotado" para um item que pode ter estoque.
  const semEstoque = { item_id: 9, item_status: "NORMAL", price_info: [{ current_price: 10, currency: "BRL" }] };
  assert.equal(precoDoProdutoShopee(semEstoque).availableQty, null);
  assert.throws(() => normalizeShopeeProduct(semEstoque), /stock_info_v2/);
});
