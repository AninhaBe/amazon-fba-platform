import test from "node:test";
import assert from "node:assert/strict";
import "../scripts/ts-resolver.mjs";

// ⚠️ TARIFA QUE EXISTE NO BANCO NÃO PODE SUMIR DO PAINEL.
//
// 🔴 O DEFEITO, medido em 02/09/2026 na conta real: o painel exibia
// **R$ 192.791,03** como "composição pendente" — e o número é exatamente
// `receita − custo` (363.396,19 − 170.605,16). As tarifas, **R$ 115.253,67
// gravadas com zero valores nulos**, não entravam em fatia nenhuma. O card ainda
// dizia "Tarifas da Shopee: ainda não conciliadas".
//
// E a causa não era o join, o filtro nem o `provider_fee_code`: `sellerShipping`
// ficava `null` porque `orders_with_shipping` (9.911) era menor que
// `orders_processed` (9.917). **SEIS pedidos sem bandeira de evidência — 0,06% —
// anulavam a composição inteira**, e o resto virava um balaio sem nome.
//
// 📌 É a família "cobertura incompleta anula o valor", já tirada da margem da
// Shopee em 31/08 e que sobreviveu aqui. A regra é a oposta: **mostre o que foi
// capturado e APONTE o que falta, com número.**

const { getShopeeOverviewFromCanonical } = await import("../src/lib/integrations/shopeeOverviewCanonical.ts");
// O produtor exige escopo de inquilino — `currentWorkspaceId()` LANCA sem ele,
// e e a garantia de isolamento funcionando. O teste roda dentro do escopo.
const { runWithWorkspace } = await import("../src/lib/workspaceScope.ts");

const period = { from: new Date("2026-08-03T03:00:00Z"), to: new Date("2026-09-02T23:59:59Z"), label: "30 dias" };
const connection = {
  id: "shopee:1", provider: "shopee", externalAccountId: "1", displayName: "Loja",
  mode: "local", region: "BR", scopes: [], metadata: { taxRate: 0 },
  status: "connected", connectedAt: period.from.toISOString(), updatedAt: period.from.toISOString(),
};

/**
 * O cenário reproduz o defeito: tarifa CHEIA no banco e a cobertura de frete
 * faltando em UM pedido — a proporção real era 6 em 9.917.
 */
function fakeQuery({ ordersWithShipping = 999 } = {}) {
  return async (sql) => {
    if (sql.includes("FROM workspace_marketplace_syncs")) return [{
      covered_from: period.from.toISOString(), covered_to: period.to.toISOString(),
      products_synced_at: period.to.toISOString(), products_total: 1, active_products: 1, products_complete: true,
    }];
    if (sql.includes("COUNT(*)::int AS total_orders")) return [{
      total_orders: 1000, paid_orders: 1000, paid_revenue: "363396.19",
      faturamento: "363396.19", pedidos_faturados: 1000, sem_valor: 0,
      pending_revenue: null, pending_orders: 0,
      cancelled_revenue: "0", cancelled_orders: 0, currency: "BRL",
      last_sale_at: period.to.toISOString(),
    }];
    if (sql.includes("WITH scoped AS")) return [{
      orders_processed: 1000, processed_revenue: "363396.19", buyer_shipping: "0",
      fees: "115253.67", seller_shipping: "0", ads: "0", taxes_withheld: "0", refunds: "0",
      orders_with_fees: 1000, orders_with_shipping: ordersWithShipping,
      orders_with_ads: 1000, orders_with_taxes_withheld: 1000, orders_with_refunds: 1000,
    }];
    return [];
  };
}

const medir = (opcoes) => runWithWorkspace("w1", () =>
  getShopeeOverviewFromCanonical(connection, period, {
    query: fakeQuery(opcoes), workspaceId: "w1", taxRate: 0,
  }));

test("🔴 a fatia de TARIFA aparece mesmo com a cobertura incompleta", async () => {
  // 999 de 1000: é a proporção do defeito real (6 em 9.917). Antes disso zerava
  // a composição inteira; agora tem de continuar mostrando os R$ 115.253,67.
  const ov = await medir({ ordersWithShipping: 999 });
  const c = ov.profit.composicaoDaReceitaPaga;
  assert.equal(c.fees, 115253.67, "a tarifa esta no banco: ela TEM de aparecer na fatia");
  assert.notEqual(c.lucro, null, "um pedido sem bandeira nao pode anular a composicao");
});

test("a composicao FECHA: receita = tarifas + custo + imposto + resultado", async () => {
  const ov = await medir({ ordersWithShipping: 999 });
  const c = ov.profit.composicaoDaReceitaPaga;
  const soma = (c.fees ?? 0) + (c.sellerShipping ?? 0) + (c.ads ?? 0)
    + (c.taxesWithheld ?? 0) + (c.refunds ?? 0) + (c.cogs ?? 0) + (c.taxes ?? 0) + c.lucro;
  assert.ok(Math.abs(soma - c.receita) < 0.02,
    `as fatias somam ${soma.toFixed(2)} e o centro e ${c.receita}`);
});

test("o que FALTA e apontado com NUMERO, nao apagando o que se sabe", async () => {
  // A regra da casa: nunca "parcial", nunca anular — diga quantos pedidos ainda
  // nao tem repasse apurado, para a vendedora saber o tamanho do que falta.
  const incompleto = await medir({ ordersWithShipping: 994 });
  assert.equal(incompleto.profit.composicaoDaReceitaPaga.pedidosSemApuracao, 6);
  const completo = await medir({ ordersWithShipping: 1000 });
  assert.equal(completo.profit.composicaoDaReceitaPaga.pedidosSemApuracao, 0,
    "cobertura completa nao pode inventar pendencia");
});

test("o BALAIO de receita menos custo nao pode voltar", async () => {
  // 🔴 O numero exato do print dela: 363.396,19 - 170.605,16 = 192.791,03. Se o
  // resultado do painel voltar a valer isso, a tarifa sumiu de novo.
  const ov = await medir({ ordersWithShipping: 999 });
  const c = ov.profit.composicaoDaReceitaPaga;
  const balaio = c.receita - (c.cogs ?? 0);
  assert.notEqual(c.lucro, balaio,
    "resultado igual a receita menos custo significa tarifa fora da conta");
});
