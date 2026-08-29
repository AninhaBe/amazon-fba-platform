import test from "node:test";
import assert from "node:assert/strict";
import "../scripts/ts-resolver.mjs";
const {
  getShopeeOverviewFromCanonical,
  shopeeTaxRate,
} = await import("../src/lib/integrations/shopeeOverviewCanonical.ts");

const period = {
  from: new Date("2026-07-01T03:00:00.000Z"),
  to: new Date("2026-07-31T23:59:59.000Z"),
  label: "Julho",
};

const connection = (taxRateMarker = Symbol.for("missing")) => ({
  id: "shopee:1", provider: "shopee", externalAccountId: "1", displayName: "Loja",
  mode: "local", region: "BR", scopes: [],
  metadata: taxRateMarker === Symbol.for("missing") ? {} : { taxRate: taxRateMarker },
  status: "connected", connectedAt: period.from.toISOString(), updatedAt: period.from.toISOString(),
});

const completeCosts = {
  "shopee:shopee:1:sku:SKU-1": {
    id: "shopee:shopee:1:sku:SKU-1", sku: "SKU-1", cost: 20,
    updatedAt: "2020-01-01T00:00:00.000Z",
    history: [{ cost: 20, from: "2020-01-01T00:00:00.000Z" }],
  },
};

function fakeQuery({ covered = true } = {}) {
  return async (sql) => {
    if (sql.includes("FROM workspace_marketplace_syncs")) return [{
      covered_from: covered ? "2026-07-01T03:00:00.000Z" : "2026-07-02T03:00:00.000Z",
      covered_to: "2026-08-01T00:00:00.000Z", products_synced_at: "2026-08-01T00:00:00.000Z",
      products_total: 1, active_products: 1, products_complete: true,
    }];
    if (sql.includes("COUNT(*)::int AS total_orders")) return [{
      total_orders: 1, paid_orders: 1, paid_revenue: "100", cancelled_revenue: "0",
      cancelled_orders: 0, currency: "BRL", last_sale_at: "2026-07-10T12:00:00.000Z",
    }];
    if (sql.includes("WITH scoped AS")) return [{
      orders_processed: 1, processed_revenue: "100", buyer_shipping: "0",
      fees: "10", seller_shipping: "5", ads: "3", taxes_withheld: "2", refunds: "4",
      orders_with_fees: 1, orders_with_shipping: 1, orders_with_ads: 1,
      orders_with_taxes_withheld: 1, orders_with_refunds: 1,
    }];
    if (sql.includes("WITH detailed AS")) return [{
      external_order_id: "ORDER-1", occurred_at: "2026-07-10T12:00:00.000Z",
      provider_status: "COMPLETED", currency: "BRL", gross: "100", buyer_shipping: "0",
      fulfillment: "platform", line_no: 1, external_product_id: "P-1", sku: "SKU-1",
      title: "Produto", qty: 1, unit_price: "100", commission: "10", seller_shipping: "5",
      ads: "3", taxes_withheld: "2", refunds: "4", fees_known: true, shipping_known: true,
      ads_known: true, taxes_withheld_known: true, refunds_known: true, financial_settled: true,
    }];
    if (sql.includes("MIN(o.occurred_at) AS occurred_at")) return [{
      external_product_id: "P-1", sku: "SKU-1", occurred_at: "2026-07-10T12:00:00.000Z", qty: 1,
    }];
    if (sql.includes("MIN(i.title) AS title")) return [{
      external_product_id: "P-1", sku: "SKU-1", title: "Produto", units: 1, revenue: "100",
    }];
    if (sql.includes("FROM workspace_channel_products")) return [{
      external_product_id: "P-1", sku: "SKU-1", title: "Produto", status: "active", price: "100",
      available_qty: 10, thumbnail: null, permalink: null, synced_at: "2026-08-01T00:00:00.000Z",
    }];
    if (sql.includes("GROUP BY 1")) return [{ date: "2026-07-10", revenue: "100", orders: 1, units: 1 }];
    if (sql.includes("LIMIT 10")) return [{
      external_order_id: "ORDER-1", provider_status: "COMPLETED",
      occurred_at: "2026-07-10T12:00:00.000Z", gross: "100", currency: "BRL", units: 1,
    }];
    throw new Error(`Consulta não coberta pelo fake: ${sql.slice(0, 80)}`);
  };
}

const overview = (changes = {}) => getShopeeOverviewFromCanonical(
  connection(changes.taxRate), period,
  { query: fakeQuery({ covered: changes.covered }), costs: changes.costs ?? completeCosts,
    taxRate: changes.taxRate, taxRateKnown: changes.taxRateKnown, workspaceId: "workspace-test" },
);

test("alíquota aceita somente números finitos entre 0 e 100", () => {
  const validCases = [
    [0, 0], [100, 100], ["0", 0], ["100", 100], [" 12.5 ", 12.5],
  ];
  for (const [raw, expected] of validCases) {
    assert.equal(shopeeTaxRate(connection(raw)), expected, `valor válido: ${String(raw)}`);
  }

  const invalidCases = [
    null, "", "   ", "\t\t", "abc", Number.NaN, Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY, -0.01, "-1", 100.01, "101", "Infinity", "0x10",
    true, [],
  ];
  for (const raw of invalidCases) {
    assert.equal(shopeeTaxRate(connection(raw)), null, `valor inválido: ${String(raw)}`);
  }
});

test("override true não torna alíquota ausente ou inválida conhecida", async () => {
  for (const taxRate of [undefined, "   ", -1, 101, Number.POSITIVE_INFINITY]) {
    const result = await overview({ taxRate, taxRateKnown: true });
    assert.equal(result.profit.taxRate, null, `taxRate: ${String(taxRate)}`);
    assert.equal(result.profit.taxRateKnown, false, `taxRateKnown: ${String(taxRate)}`);
    assert.equal(result.profit.taxes, null, `taxes: ${String(taxRate)}`);
  }
});

test("alíquota ausente NAO bloqueia mais: lucro e margem saem sem o imposto", async () => {
  // Regra nova, decidida por ela em 26/08/2026. A alíquota é configuração da
  // vendedora, não dado da Shopee: o lucro sai calculado sem o imposto e a tela
  // rotula "(sem imposto)", mantendo o CTA "Cadastrar alíquota →".
  assert.equal(shopeeTaxRate(connection()), null);
  const result = await overview();
  assert.equal(result.profit.taxRate, null);
  assert.equal(result.profit.taxRateKnown, false);
  // O imposto EM SI continua desconhecido — `null`, nunca zero. É o valor
  // derivado que passa a existir, não o imposto.
  assert.equal(result.profit.taxes, null);
  assert.equal(result.profit.coverage.complete, true);
  assert.equal(result.profit.estimatedProfit, 56);
  assert.ok(Math.abs(result.profit.marginPct - 56) < 1e-9);
  assert.equal(result.profitabilityLines[0].complete, true);
});

test("alíquota explicitamente zero é conhecida e permite completude", async () => {
  assert.equal(shopeeTaxRate(connection(0)), 0);
  const result = await overview({ taxRate: 0 });
  assert.equal(result.profit.taxRateKnown, true);
  assert.equal(result.profit.taxes, 0);
  assert.equal(result.profit.coverage.complete, true);
  assert.equal(result.profit.estimatedProfit, 56);
  assert.ok(Math.abs(result.profit.marginPct - 56) < 1e-9);
});

test("override explícito false mantém o imposto desconhecido, mas o lucro sai mesmo assim", async () => {
  const result = await overview({ taxRate: 10, taxRateKnown: false });
  assert.equal(result.profit.taxRate, 10);
  assert.equal(result.profit.taxRateKnown, false);
  assert.equal(result.profit.taxes, null, "imposto desconhecido continua null, nunca zero");
  assert.equal(result.profit.estimatedProfit, 56, "o lucro sai sem imposto, como quando não há alíquota");
});

test("período parcial bloqueia lucro e completude", async () => {
  const result = await overview({ taxRate: 10, covered: false });
  assert.equal(result.metrics.revenueCoverage.complete, false);
  assert.equal(result.profit.coverage.complete, false);
  assert.equal(result.profit.estimatedProfit, null);
  assert.equal(result.profit.marginPct, null);
});

test("COGS incompleto mostra a soma do que se sabe e AINDA ASSIM bloqueia lucro", async () => {
  // ⚠️ ESTE TESTE MUDOU DE INTENCAO em 29/08/2026, por decisao do cerebro depois
  // de a Ana relatar a tela sem calcular nada. Antes ele exigia `cogs === null`
  // quando faltava custo de uma unidade — o tudo-ou-nada. Agora exige as DUAS
  // metades, que sao decisoes separadas de proposito:
  //   1. o custo mostra a soma das unidades conhecidas (fato, nao extrapolacao);
  //   2. o lucro CONTINUA null, porque lucro com custo incompleto e otimista.
  // Aqui nenhuma unidade tem custo, entao o custo e null mesmo — soma de zero
  // unidades conhecidas nao e "R$ 0,00", e desconhecido.
  const result = await overview({ taxRate: 10, costs: {} });
  assert.equal(result.profit.cogs, null);
  assert.equal(result.profit.unitsWithoutCost, 1);
  assert.equal(result.profit.coverage.complete, false);
  assert.equal(result.profit.estimatedProfit, null);
});

test("custo explicitamente zero é COGS conhecido, mas custo ausente continua null", async () => {
  const zeroCosts = {
    "shopee:shopee:1:sku:SKU-1": {
      id: "shopee:shopee:1:sku:SKU-1", sku: "SKU-1", cost: 0,
      updatedAt: "2020-01-01T00:00:00.000Z",
      history: [{ cost: 0, from: "2020-01-01T00:00:00.000Z" }],
    },
  };
  const known = await overview({ taxRate: 0, costs: zeroCosts });
  assert.equal(known.profit.cogs, 0);
  assert.equal(known.profit.unitsWithoutCost, 0);
  assert.equal(known.metrics.productsWithoutCost, 0);
  assert.equal(known.profitabilityLines[0].productCost, 0);
  assert.equal(known.profitabilityLines[0].complete, true);

  const missing = await overview({ taxRate: 0, costs: {} });
  // Nenhuma unidade conhecida: continua null (ver o teste acima).
  assert.equal(missing.profit.cogs, null);
  assert.equal(missing.profitabilityLines[0].productCost, null);
  assert.equal(missing.metrics.productsWithoutCost, 1);
});

test("detalhe financeiro declara paginação e completude", async () => {
  const first = await overview({ taxRate: 0 });
  assert.deepEqual(first.profitabilityPage, {
    limit: 100, offset: 0, totalOrders: 1, returnedOrders: 1, hasMore: false, complete: true,
  });
  const paged = await getShopeeOverviewFromCanonical(connection(0), period, {
    query: fakeQuery(), costs: completeCosts, workspaceId: "workspace-test",
    detailPage: { limit: 1, offset: 1 }, taxRate: 0,
  });
  assert.equal(paged.profitabilityPage.offset, 1);
  assert.equal(paged.profitabilityPage.complete, false);
});

test("composição completa inclui ads, imposto retido e refund", async () => {
  const result = await overview({ taxRate: 10 });
  assert.equal(result.profit.ads, 3);
  assert.equal(result.profit.taxesWithheld, 2);
  assert.equal(result.profit.refunds, 4);
  assert.equal(result.profit.taxes, 10);
  assert.equal(result.profit.cogs, 20);
  assert.equal(result.profit.estimatedProfit, 46);
  assert.equal(result.profit.marginPct, 46);
  assert.equal(result.profit.coverage.complete, true);
});
