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
      // ⚠️ COLUNAS DA BASE DO FATURAMENTO (01/09/2026). O fake precisa devolve-las
      // porque a base do lucro deixou de ser paid_revenue: sem elas o overview
      // calcula sobre zero e os testes falham por falta de dado do fake, nao por
      // defeito do produto — vermelho pelo motivo errado.
      faturamento: "100", pedidos_faturados: 1, sem_valor: 0,
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
  // ⚠️ INTENCAO INVERTIDA EM 07/09/2026 (ADR-038): era `null`, virou `0`. A
  // versao anterior estava CERTA no mundo anterior — `null != 0` valia tambem
  // para imposto. A dona do produto decidiu o contrario: *"nesse caso, ausencia
  // e zero mesmo"*, porque o dado e DELA, tem default honesto, e o travessao
  // apagava lucro e margem de quem so nao preencheu um campo.
    assert.equal(result.profit.taxes, 0, `taxes: ${String(taxRate)}`);
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
  // ⚠️ INTENCAO INVERTIDA EM 07/09/2026 (ADR-038): era `null`, virou `0`. A
  // versao anterior estava CERTA no mundo anterior — `null != 0` valia tambem
  // para imposto. A dona do produto decidiu o contrario: *"nesse caso, ausencia
  // e zero mesmo"*, porque o dado e DELA, tem default honesto, e o travessao
  // apagava lucro e margem de quem so nao preencheu um campo.
  assert.equal(result.profit.taxes, 0);
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
  // ⚠️ INTENCAO INVERTIDA EM 07/09/2026 (ADR-038): era `null`, virou `0`. A
  // versao anterior estava CERTA no mundo anterior — `null != 0` valia tambem
  // para imposto. A dona do produto decidiu o contrario: *"nesse caso, ausencia
  // e zero mesmo"*, porque o dado e DELA, tem default honesto, e o travessao
  // apagava lucro e margem de quem so nao preencheu um campo.
  assert.equal(result.profit.taxes, 0, "sem aliquota o imposto e zero (ADR-038)");
  // ⚠️ E O RASTRO E O QUE SOBRA: sem `taxRateKnown` o zero fica mudo e a
  // pendencia "cadastrar aliquota" some da tela.
  assert.equal(result.profit.taxRateKnown, false, "o sinal da pendencia tem de continuar falso");
  assert.equal(result.profit.estimatedProfit, 56, "o lucro sai sem imposto, como quando não há alíquota");
});

test("período parcial NAO bloqueia mais o lucro — declara a base e segue", async () => {
  // ⚠️ ESTE TESTE MUDOU DE INTENCAO, e a anterior fica registrada.
  //
  // ATE 31/08/2026 ele exigia `estimatedProfit === null` quando o periodo nao
  // estava totalmente coberto. Era o mesmo tudo-ou-nada que a vendedora ja
  // derrubou em outros dois lugares: no custo em 29/08 (*"nao precisa mostrar
  // que e parcial [...] se tem venda e nao tem custo, fica apontado la"*) e no
  // faturamento da Amazon em 31/08 (*"o lucro tem que ser em cima do
  // Faturamento"*). A Shopee era o quarto canal, o unico que ainda escondia.
  //
  // Na conta real isso dava travessao com 9.027 de 9.877 vendas apuradas — 91%
  // do periodo — e a tela nao mostrava nada.
  //
  // O QUE CONTINUA VALENDO, e e o outro teste abaixo: componente DESCONHECIDO
  // (`fees == null`) segue anulando. Ausencia de componente nao e ausencia de
  // cobertura.
  const result = await overview({ taxRate: 10, covered: false });
  assert.equal(result.metrics.revenueCoverage.complete, false);
  assert.equal(result.profit.coverage.complete, false, "a cobertura continua sendo relatada como incompleta");
  assert.notEqual(result.profit.estimatedProfit, null, "o lucro sai com o que se sabe");
  assert.notEqual(result.profit.marginPct, null, "e a margem tambem");
  // A base do numero fica declarada, para a tela poder dizer sobre o que ele e.
  assert.equal(result.profit.revenueDoLucro, 100);
});

test("COGS incompleto mostra a soma do que se sabe e NAO bloqueia mais o lucro", async () => {
  // ⚠️ ESTE TESTE MUDOU DE INTENCAO DUAS VEZES, e as duas estao registradas.
  //
  // 29/08: antes exigia `cogs === null` quando faltava custo de uma unidade — o
  // tudo-ou-nada. Passou a exigir que o CUSTO mostrasse a soma do que se sabe.
  //
  // 30/08 (decisao da vendedora, revertendo a nossa): o LUCRO tambem para de
  // esperar. *"Tem que mostrar a margem independente de se tem algo nao
  // cadastrado [...] basta sinalizar pra cadastrar."*
  //
  // O que NAO mudou: `cogs` continua `null` quando NENHUMA unidade tem custo —
  // soma de zero unidades conhecidas nao e "R$ 0,00", e desconhecido. E
  // `skusWithoutCost` viaja no payload para a tela sinalizar ao lado do numero.
  const result = await overview({ taxRate: 10, costs: {} });
  assert.equal(result.profit.cogs, null);
  assert.equal(result.profit.unitsWithoutCost, 1);
  assert.equal(result.profit.skusWithoutCost, 1);
  assert.notEqual(result.profit.estimatedProfit, null, "o lucro sai com o que se sabe");
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
