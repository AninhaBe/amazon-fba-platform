import test from "node:test";
import assert from "node:assert/strict";
import { collectMercadoLivreOrders } from "../src/lib/integrations/mercadoLivreOrders.ts";

test("coleta mais de 1.000 pedidos sem truncar o faturamento", async () => {
  const orders = Array.from({ length: 6_000 }, (_, index) => ({ id: index + 1, total: 10.25 }));
  const result = await collectMercadoLivreOrders({
    from: new Date("2026-07-01T00:00:00Z"),
    to: new Date("2026-07-31T23:59:59Z"),
    fetchPage: async (_from, _to, offset, limit) => ({
      paging: { total: orders.length },
      results: orders.slice(offset, offset + limit),
    }),
  });

  assert.equal(result.orders.length, 6_000);
  assert.equal(result.complete, true);
  assert.equal(result.orders.reduce((sum, order) => sum + order.total, 0), 61_500);
});

test("divide períodos densos e remove pedidos repetidos na fronteira", async () => {
  const from = new Date("2026-07-01T00:00:00Z");
  const to = new Date("2026-07-03T00:00:00Z");
  const midpoint = (from.getTime() + to.getTime()) / 2;
  const orders = Array.from({ length: 120 }, (_, index) => ({
    id: index + 1,
    createdAt: index < 60 ? midpoint - index : midpoint + index - 60,
  }));

  const result = await collectMercadoLivreOrders({
    from,
    to,
    pageSize: 20,
    maxResultsPerRange: 100,
    fetchPage: async (rangeFrom, rangeTo, offset, limit) => {
      const matches = orders.filter((order) => order.createdAt >= rangeFrom.getTime() && order.createdAt <= rangeTo.getTime());
      return { paging: { total: matches.length }, results: matches.slice(offset, offset + limit) };
    },
  });

  assert.equal(result.total, 120);
  assert.equal(result.orders.length, 120);
  assert.equal(result.complete, true);
});

test("falha explicitamente em vez de exibir faturamento parcial", async () => {
  await assert.rejects(
    collectMercadoLivreOrders({
      from: new Date("2026-07-01T00:00:00Z"),
      to: new Date("2026-07-02T00:00:00Z"),
      fetchPage: async (_from, _to, offset) => ({
        paging: { total: 1_500 },
        results: offset === 0 ? Array.from({ length: 1_000 }, (_, index) => ({ id: index })) : [],
      }),
    }),
    /Não foi possível carregar todos os pedidos/
  );
});
