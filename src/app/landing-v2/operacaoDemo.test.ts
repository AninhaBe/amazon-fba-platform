import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateChannel,
  aggregateProducts,
  buildDemoOperation,
  dailyChart,
  percentageChange,
  type DemoChannelId,
  type DemoPeriod,
} from "./operacaoDemo";

const operation = buildDemoOperation(new Date("2026-08-23T12:00:00.000Z"));
const channels: DemoChannelId[] = ["amazon", "mercado_livre", "shopee", "tiktok_shop"];
const periods: DemoPeriod[] = [7, 15, 30];

test("gera datas relativas ao dia atual informado", () => {
  assert.equal(operation.generatedFor, "2026-08-23");
  assert.equal(operation.series.at(-1)?.date, "2026-08-23");
});

test("preserva as evidências exatas usadas pelo briefing", () => {
  const mercadoLivre = aggregateChannel(operation, "mercado_livre", 7);
  const mercadoLivreAnterior = aggregateChannel(operation, "mercado_livre", 7, 7);
  const amazon = aggregateChannel(operation, "amazon", 7);
  const amazonAnterior = aggregateChannel(operation, "amazon", 7, 7);
  const shopee = aggregateChannel(operation, "shopee", 7);
  const shopeeAnterior = aggregateChannel(operation, "shopee", 7, 7);

  assert.equal(mercadoLivre.revenueCents, 516_100);
  assert.equal(mercadoLivreAnterior.revenueCents, 1_358_100);
  assert.equal(mercadoLivreAnterior.revenueCents - mercadoLivre.revenueCents, 842_000);
  assert.equal(Math.round(percentageChange(mercadoLivre.revenueCents, mercadoLivreAnterior.revenueCents)!), -62);
  assert.equal(Math.round(percentageChange(amazon.revenueCents, amazonAnterior.revenueCents)!), 9);
  assert.equal(Math.round(shopee.discountRatePct - shopeeAnterior.discountRatePct), 7);
});

test("cards, tabela e gráfico usam a mesma fonte de totais", () => {
  for (const channel of channels) {
    for (const period of periods) {
      const card = aggregateChannel(operation, channel, period);
      const table = aggregateProducts(operation, channel, period);
      const chart = dailyChart(operation, channel, period);

      assert.equal(table.reduce((sum, row) => sum + row.revenueCents, 0), card.revenueCents);
      assert.equal(table.reduce((sum, row) => sum + (row.productCostCents ?? 0), 0), card.productCostCents);
      assert.equal(table.reduce((sum, row) => sum + row.orders, 0), card.orders);
      assert.equal(Math.round(chart.reduce((sum, point) => sum + point.revenue * 100, 0)), card.revenueCents);
      assert.equal(chart.reduce((sum, point) => sum + point.orders, 0), card.orders);
    }
  }
});
