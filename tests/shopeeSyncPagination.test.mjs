import assert from "node:assert/strict";
import test from "node:test";

import {
  collectShopeeCatalogIds,
  collectShopeeOrderSns,
  collectShopeeProductIds,
  parseShopeeOrderListPage,
  parseShopeeProductListPage,
  SHOPEE_PRODUCT_STATUSES,
} from "../src/lib/integrations/shopeePagination.ts";

test("produtos percorrem páginas, removem duplicatas e terminam somente ao esgotar", async () => {
  const offsets = [];
  const ids = await collectShopeeProductIds(async (offset) => {
    offsets.push(offset);
    if (offset === 0) return { item: [{ item_id: 1 }, { item_id: 2 }], has_next_page: true, next_offset: 2 };
    return { item: [{ item_id: 2 }, { item_id: 3 }], has_next_page: false };
  });
  assert.deepEqual(offsets, [0, 2]);
  assert.deepEqual(ids, [1, 2, 3]);
});

test("produtos rejeitam cursor sem avanço e teto como cobertura completa", async () => {
  await assert.rejects(
    collectShopeeProductIds(async () => ({ item: [{ item_id: 1 }], has_next_page: true, next_offset: 0 })),
    /sem avanço/
  );
  await assert.rejects(
    collectShopeeProductIds(async (offset) => ({ item: [{ item_id: offset }], has_next_page: true, next_offset: offset + 1 }), 2),
    /não foi marcada como completa/
  );
});

test("snapshot de catálogo esgota todos os status antes de permitir reconciliação", async () => {
  const visited = [];
  const ids = await collectShopeeCatalogIds(async (status, offset) => {
    visited.push([status, offset]);
    return { item: [{ item_id: SHOPEE_PRODUCT_STATUSES.indexOf(status) + 1 }], has_next_page: false };
  });
  assert.deepEqual(visited, SHOPEE_PRODUCT_STATUSES.map((status) => [status, 0]));
  assert.deepEqual(ids, [1, 2, 3, 4]);
});

test("falha em qualquer status interrompe o snapshot multi-status", async () => {
  const visited = [];
  await assert.rejects(
    collectShopeeCatalogIds(async (status) => {
      visited.push(status);
      if (status === "BANNED") throw new Error("resposta inválida");
      return { item: [], has_next_page: false };
    }),
    /resposta inválida/
  );
  assert.deepEqual(visited, ["NORMAL", "UNLIST", "BANNED"]);
});

test("payload 2xx sem contrato não pode parecer página vazia completa", () => {
  assert.throws(() => parseShopeeOrderListPage({}), /Resposta inválida/);
  assert.throws(() => parseShopeeProductListPage({}), /Resposta inválida/);
  assert.throws(
    () => parseShopeeOrderListPage({ order_list: [], more: true }),
    /Resposta inválida/
  );
  assert.throws(
    () => parseShopeeProductListPage({ item: [], has_next_page: true }),
    /Resposta inválida/
  );
});

test("pedidos percorrem cursor opaco e deduplicam order_sn", async () => {
  const cursors = [];
  const ids = await collectShopeeOrderSns(async (cursor) => {
    cursors.push(cursor ?? null);
    if (!cursor) return { order_list: [{ order_sn: "A" }, { order_sn: "B" }], more: true, next_cursor: "c2" };
    return { order_list: [{ order_sn: "B" }, { order_sn: "C" }], more: false };
  });
  assert.deepEqual(cursors, [null, "c2"]);
  assert.deepEqual(ids, ["A", "B", "C"]);
});

test("pedidos não avançam cobertura com cursor inválido ou limite atingido", async () => {
  await assert.rejects(
    collectShopeeOrderSns(async () => ({ order_list: [], more: true })),
    /sem avanço/
  );
  await assert.rejects(
    collectShopeeOrderSns(async (cursor) => ({ order_list: [], more: true, next_cursor: `${cursor ?? "c"}x` }), 2),
    /cobertura da janela não foi avançada/
  );
});

test("uma execução interrompida pode retomar do início sem duplicar pedidos", async () => {
  let complete = false;
  const fetchPage = async (cursor) => {
    if (!cursor) return { order_list: [{ order_sn: "A" }], more: true, next_cursor: "c2" };
    return complete
      ? { order_list: [{ order_sn: "A" }, { order_sn: "B" }], more: false }
      : { order_list: [{ order_sn: "B" }], more: true, next_cursor: "c3" };
  };

  await assert.rejects(collectShopeeOrderSns(fetchPage, 2), /cobertura da janela não foi avançada/);
  complete = true;
  assert.deepEqual(await collectShopeeOrderSns(fetchPage, 2), ["A", "B"]);
});
