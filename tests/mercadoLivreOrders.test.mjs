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
    // Teto explícito: este `fetchPage` devolve 6.000 para QUALQUER intervalo, então
    // dividir a janela não reduz o total e o coletor dividiria até o limite. Na API
    // real janela menor devolve menos. O que este teste garante é a ausência de
    // truncamento, não o valor do teto — que é coberto pelo teste seguinte.
    maxResultsPerRange: 10_000,
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

test("o teto padrao segura o pico de memoria do processo web", async () => {
  // O coletor devolve TODOS os pedidos num array só. A 10.000 o pico passava de
  // 30 MB dentro do processo que serve todas as telas; o container de 512 MB caiu
  // duas vezes em 14-15/08/2026. Acima do teto ele divide o intervalo em vez de
  // carregar tudo — e é isso que este teste prova.
  let janelas = 0;
  const result = await collectMercadoLivreOrders({
    from: new Date("2026-07-01T00:00:00Z"),
    to: new Date("2026-07-31T00:00:00Z"),
    fetchPage: async (from, to, offset, limit) => {
      if (offset === 0) janelas += 1;
      // Densidade constante: quanto menor a janela, menos pedidos — como na API real.
      const dias = (to.getTime() - from.getTime()) / 86_400_000;
      const total = Math.round(dias * 100);
      const inicio = Math.round((from.getTime() - Date.UTC(2026, 6, 1)) / 86_400_000) * 100;
      return {
        paging: { total },
        results: Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) => ({ id: inicio + offset + i + 1 })),
      };
    },
  });
  assert.ok(janelas > 1, "3.000 pedidos precisam ser buscados em janelas menores, nao de uma vez");
  assert.equal(result.complete, true, "dividir a janela nao pode perder pedido");
  assert.equal(result.orders.length, 3_000);
});
