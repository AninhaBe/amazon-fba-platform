import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  normalizeShopeeProduct,
  ShopeeItemForaDoSnapshot,
} from "../src/lib/integrations/shopeeCanonical.ts";

/** `assert.throws` nao devolve o erro, e aqui o que interessa e o conteudo dele. */
const capturar = (fn) => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("esperava um erro e nada foi lancado");
};

// A loja real (275804987) parou a varredura em 27/08/2026 com
// "Status de produto Shopee desconhecido: SHOPEE_DELETE." — valor que a Shopee
// devolve pedindo a lista de DELETED e que a documentação dela não registra.
const ITEM = {
  item_id: 44862300302,
  item_name: "Capa de Cobrir Moto",
  price_info: [{ current_price: 42.9, currency: "BRL" }],
  stock_info_v2: { summary_info: { total_available_stock: 2688 } },
};

test("os dois DELETE não documentados entram como item morto", () => {
  // Pedindo `item_status=DELETED`, a loja real devolveu SÓ estes dois valores —
  // o `DELETED` da documentação não apareceu uma vez sequer. Os três são item
  // morto; o que muda é quem removeu, e isso mora em `providerStatus`.
  for (const cru of ["SHOPEE_DELETE", "SELLER_DELETE", "DELETED"]) {
    const produto = normalizeShopeeProduct({ ...ITEM, item_status: cru });
    assert.equal(produto.status, "closed", `${cru} tem de fechar o item`);
    assert.equal(produto.providerStatus, cru, "o valor cru precisa sobreviver ao canônico");
  }
});

test("status novo da Shopee é pendência DO ITEM, não morte do canal", () => {
  // O erro continua existindo — o que muda é o tipo, que carrega o escopo.
  const erro = capturar(() => normalizeShopeeProduct({ ...ITEM, item_status: "VALOR_QUE_ELES_AINDA_VAO_INVENTAR" }));
  assert.ok(erro instanceof ShopeeItemForaDoSnapshot);
  assert.equal(erro.itemId, "44862300302");
  assert.equal(erro.valorCru, "VALOR_QUE_ELES_AINDA_VAO_INVENTAR", "o valor cru precisa chegar no aviso");
  assert.match(erro.message, /desconhecido/);

  // Item sem status nenhum cai no mesmo lugar, e não vira "active" por omissão.
  const semStatus = capturar(() => normalizeShopeeProduct(ITEM));
  assert.ok(semStatus instanceof ShopeeItemForaDoSnapshot);
  assert.equal(semStatus.valorCru, "(ausente)");
});

test("preço e estoque ausentes usam o MESMO escopo de item", () => {
  // Antes eram dois caminhos: um regex de mensagem para preço e um throw solto
  // para status. Um item derrubava o canal dependendo de qual defeito tinha.
  const semPreco = capturar(() => normalizeShopeeProduct({ item_id: 7, item_status: "NORMAL" }));
  assert.ok(semPreco instanceof ShopeeItemForaDoSnapshot);
  assert.equal(semPreco.itemId, "7");
  assert.match(semPreco.message, /price_info\.current_price/);
  assert.match(semPreco.message, /zero não será fabricado/, "a recusa a fabricar zero continua inteira");

  const semEstoque = capturar(() => normalizeShopeeProduct({ item_id: 7, item_status: "NORMAL", price_info: [{ current_price: 10 }] }));
  assert.ok(semEstoque instanceof ShopeeItemForaDoSnapshot);
  assert.match(semEstoque.message, /stock_info_v2/);
});

test("erro que NÃO é de um item continua derrubando a página", () => {
  // Produto sem item_id não é pendência: não há o que contar nem o que apontar,
  // e a lista já foi validada contra o snapshot antes de chegar aqui.
  const semId = capturar(() => normalizeShopeeProduct({ item_id: null, item_status: "NORMAL" }));
  assert.ok(!(semId instanceof ShopeeItemForaDoSnapshot), "sem identidade, o erro tem de subir");
  assert.match(semId.message, /item_id válido/);
});

test("a varredura filtra pelo TIPO do erro, não pelo texto da mensagem", () => {
  const sync = readFileSync(new URL("../src/lib/integrations/shopeeSync.ts", import.meta.url), "utf8");
  assert.match(sync, /if \(!\(error instanceof ShopeeItemForaDoSnapshot\)\) throw error;/);
  // O valor cru vai para o aviso junto do item, senão a próxima surpresa da
  // Shopee vira um número sem causa.
  assert.match(sync, /foraDoSnapshot\.push\(`\$\{error\.itemId\} \(\$\{error\.valorCru\}\)`\)/);
  assert.match(sync, /item\(ns\) fora do snapshot, com o valor cru da Shopee/);
  // E o texto da mensagem não pode voltar a ser o critério.
  assert.doesNotMatch(sync, /test\(motivo\)/);
});
