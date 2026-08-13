import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";

const source = fs.readFileSync(new URL("../src/app/OverviewShopeeModel.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
}).outputText;
const model = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

function overview({
  revenue = 0,
  orders = 0,
  cancelled = 0,
  profit = 0,
  currency = "BRL",
  revenueComplete = true,
  profitComplete = true,
  unitsWithoutCost = 0,
  dailySales = [],
} = {}) {
  return {
    metrics: {
      revenue30d: revenue,
      orders30d: orders,
      cancelledRevenue: cancelled,
      currency,
      revenueCoverage: { complete: revenueComplete, capturedOrders: orders, totalOrders: orders },
    },
    profit: {
      estimatedProfit: profit,
      unitsWithoutCost,
      coverage: { processedOrders: orders, paidOrders: orders, complete: profitComplete },
    },
    dailySales,
  };
}

const fulfilled = (connectionId, value) => ({
  connectionId,
  result: { status: "fulfilled", value },
});
const rejected = (connectionId, reason = new Error("Falha da loja")) => ({
  connectionId,
  result: { status: "rejected", reason },
});

test("seleciona somente conexões Shopee conectadas e não repete IDs", () => {
  assert.deepEqual(model.connectedShopeeConnectionIds([
    { id: "loja-a", status: "connected" },
    { id: "loja-a", status: "connected" },
    { id: "loja-b", status: "attention" },
    { id: "loja-c", status: "connected" },
  ]), ["loja-a", "loja-c"]);
});

test("central distingue provider issue de canal realmente desconectado", () => {
  assert.deepEqual(model.centralProviderReadState({ connections: [] }), {
    connected: false,
    attention: false,
    message: null,
  });
  assert.deepEqual(model.centralProviderReadState({
    connections: [],
    issue: {
      status: "attention",
      code: "PROVIDER_READ_FAILED",
      message: "Não foi possível carregar este canal agora.",
    },
  }), {
    connected: false,
    attention: true,
    message: "Não foi possível carregar este canal agora.",
  });
});

test("consolidado soma duas lojas compatíveis e não duplica a mesma conexão", () => {
  const aggregate = model.aggregateShopeeStores([
    fulfilled("loja-a", { overview: overview({
      revenue: 100,
      orders: 2,
      cancelled: 10,
      profit: 30,
      dailySales: [{ date: "2026-08-10", revenue: 100, orders: 2, units: 3 }],
    }) }),
    fulfilled("loja-b", { overview: overview({
      revenue: 50,
      orders: 1,
      cancelled: 5,
      profit: 12,
      dailySales: [{ date: "2026-08-10", revenue: 50, orders: 1, units: 1 }],
    }) }),
    fulfilled("loja-a", { overview: overview({ revenue: 9_999, orders: 99, profit: 9_999 }) }),
  ]);

  assert.equal(aggregate.totalStores, 2);
  assert.equal(aggregate.availableStores, 2);
  assert.equal(aggregate.revenue, 150);
  assert.equal(aggregate.orders, 3);
  assert.equal(aggregate.cancelled, 15);
  assert.equal(aggregate.profit, 42);
  assert.equal(aggregate.profitPartial, false);
  assert.deepEqual(aggregate.dailySales, [
    { date: "2026-08-10", revenue: 150, orders: 3, units: 4 },
  ]);
});

test("falha de uma loja mantém subtotal conhecido e o identifica como parcial", () => {
  const aggregate = model.aggregateShopeeStores([
    fulfilled("loja-a", { overview: overview({ revenue: 100, orders: 2, profit: 30 }) }),
    rejected("loja-b"),
  ]);

  assert.equal(aggregate.availableStores, 1);
  assert.equal(aggregate.totalStores, 2);
  assert.equal(aggregate.revenue, 100);
  assert.equal(aggregate.orders, 2);
  assert.equal(aggregate.profit, 30);
  assert.equal(aggregate.profitPartial, true);
  assert.equal(aggregate.error, undefined);
  assert.match(aggregate.note, /1 de 2/);
});

test("falha de todas as lojas não fabrica métricas consolidadas", () => {
  const aggregate = model.aggregateShopeeStores([
    rejected("loja-a", new Error("Temporariamente indisponível")),
    rejected("loja-b"),
  ]);

  assert.equal(aggregate.availableStores, 0);
  assert.equal(aggregate.totalStores, 2);
  assert.equal(aggregate.revenue, null);
  assert.equal(aggregate.orders, null);
  assert.equal(aggregate.profit, null);
  assert.equal(aggregate.error, "Temporariamente indisponível");
});

test("zero explícito não vira ausência quando outra loja está pendente", () => {
  const aggregate = model.aggregateShopeeStores([
    fulfilled("loja-a", { overview: overview() }),
    fulfilled("loja-b", { pending: true }),
  ]);

  assert.equal(aggregate.revenue, 0);
  assert.equal(aggregate.orders, 0);
  assert.equal(aggregate.cancelled, 0);
  assert.equal(aggregate.profit, 0);
  assert.equal(aggregate.profitPartial, true);
  assert.match(aggregate.note, /parciais/i);
});

test("lucro nulo permanece desconhecido sem fabricar zero", () => {
  const aggregate = model.aggregateShopeeStores([
    fulfilled("loja-a", { overview: overview({ revenue: 80, orders: 1, profit: null }) }),
  ]);

  assert.equal(aggregate.revenue, 80);
  assert.equal(aggregate.orders, 1);
  assert.equal(aggregate.profit, null);
  assert.equal(aggregate.profitPartial, true);
});

test("moedas diferentes nunca têm valores monetários somados", () => {
  const aggregate = model.aggregateShopeeStores([
    fulfilled("loja-br", { overview: overview({ revenue: 100, orders: 2, profit: 30, currency: "BRL" }) }),
    fulfilled("loja-us", { overview: overview({ revenue: 50, orders: 1, profit: 12, currency: "USD" }) }),
  ]);

  assert.equal(aggregate.revenue, null);
  assert.equal(aggregate.cancelled, null);
  assert.equal(aggregate.profit, null);
  assert.equal(aggregate.orders, 3);
  assert.deepEqual(aggregate.dailySales, []);
  assert.match(aggregate.note, /moedas diferentes/i);
});

test("central consulta cada loja Shopee pelo connection_id explícito", () => {
  const page = fs.readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /shopee\/overview\?days=30&connection_id=\$\{encodeURIComponent\(connectionId\)\}/);
  assert.doesNotMatch(page, /shopee\/overview\?days=30["`]/);
  assert.match(page, /const shopeeReadState = centralProviderReadState\(shopeeProvider\)/);
  assert.match(page, /const tiktokReadState = centralProviderReadState\(tiktokProvider\)/);
  assert.match(page, /channel\.attention \? "Atenção"/);
  assert.match(page, /channel\.attention \? "Revisar integração"/);
});
