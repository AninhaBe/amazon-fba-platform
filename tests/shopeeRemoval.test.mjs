import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { removeLocalShopeeConnection } from "../src/lib/integrations/shopeeRemoval.ts";

const workspaceId = "workspace-a";
const connectionId = "shopee:shop-123";

function fakeTransaction({ owned = true } = {}) {
  const calls = [];
  const transaction = async (work) => work(async (sql, params = []) => {
    calls.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
    if (sql.includes("SELECT id FROM workspace_integrations")) {
      return owned ? [{ id: connectionId }] : [];
    }
    if (sql.includes("DELETE FROM workspace_integrations")) {
      return owned ? [{ id: connectionId }] : [];
    }
    return [];
  });
  return { transaction, calls };
}

test("remove Shopee somente depois de validar ownership e provider na mesma transação", async () => {
  const fake = fakeTransaction();
  const removed = await removeLocalShopeeConnection(fake.transaction, workspaceId, connectionId);

  assert.equal(removed, true);
  assert.match(fake.calls[0].sql, /WHERE workspace_id=\$1 AND id=\$2 AND provider=\$3 FOR UPDATE/);
  assert.deepEqual(fake.calls[0].params, [workspaceId, connectionId, "shopee"]);
  assert.match(fake.calls[1].sql, /FROM workspace_marketplace_syncs[\s\S]*FOR UPDATE/);
  assert.deepEqual(fake.calls[1].params, [workspaceId, "shopee", connectionId]);

  const final = fake.calls.at(-1);
  assert.match(final.sql, /^DELETE FROM workspace_integrations/);
  assert.deepEqual(final.params, [workspaceId, connectionId, "shopee"]);

  const scopedDeletes = fake.calls.filter((call) =>
    /DELETE FROM workspace_(?:channel|marketplace)_/.test(call.sql),
  );
  // ⚠️ ERA `scopedDeletes.length >= 12` e virou uma LISTA NOMEADA em 01/09/2026.
  //
  // O número caiu para 10 quando a migration 0025 removeu duas tabelas mortas
  // (`workspace_marketplace_overview_snapshots` e
  // `workspace_marketplace_materialization_leases`) — e baixar o `>= 12` para
  // `>= 10` faria o teste passar sem provar mais nada. Contagem mínima é fraca
  // dos dois lados: não acusa tabela nova que ficou de fora, e afrouxa sozinha a
  // cada remoção.
  //
  // A lista nomeada obriga uma decisão explícita: tabela de inquilino que entrar
  // no schema e não entrar aqui reprova, e tabela que sair tem de sair daqui
  // junto — com alguém olhando.
  const tabelasApagadas = scopedDeletes
    .map((call) => call.sql.match(/DELETE FROM (\w+)/)[1])
    .sort();
  assert.deepEqual(tabelasApagadas, [
    "workspace_channel_offer_history",
    "workspace_channel_order_fees",
    "workspace_channel_order_items",
    "workspace_channel_orders",
    "workspace_channel_products",
    "workspace_marketplace_events",
    "workspace_marketplace_orders",
    "workspace_marketplace_products",
    "workspace_marketplace_shipments",
    "workspace_marketplace_syncs",
  ]);
  for (const call of scopedDeletes) {
    assert.match(call.sql, /workspace_id=\$1 AND provider=\$2 AND connection_id=\$3/);
    assert.deepEqual(call.params, [workspaceId, "shopee", connectionId]);
  }

  const costs = fake.calls.find((call) => call.sql.includes("workspace_product_costs"));
  assert.deepEqual(costs.params, [workspaceId, `shopee:${connectionId}:`]);
  assert.match(costs.sql, /left\(id,length\(\$2\)\)=\$2/);

  const settings = fake.calls.find((call) => call.sql.includes("workspace_settings"));
  assert.deepEqual(settings.params, [workspaceId, `shopee:tax_rate:${connectionId}`]);
});

test("não apaga nada quando a conexão não pertence ao workspace/provider", async () => {
  const fake = fakeTransaction({ owned: false });
  const removed = await removeLocalShopeeConnection(fake.transaction, "workspace-estranho", connectionId);

  assert.equal(removed, false);
  assert.equal(fake.calls.length, 1);
  assert.match(fake.calls[0].sql, /^SELECT id FROM workspace_integrations/);
  assert.deepEqual(fake.calls[0].params, ["workspace-estranho", connectionId, "shopee"]);
});

test("remoção local não chama OpenAPI nem representa revogação externa", async () => {
  const implementation = await readFile(new URL("../src/lib/integrations/shopeeRemoval.ts", import.meta.url), "utf8");
  assert.doesNotMatch(implementation, /\bfetch\s*\(|https?:\/\/|openapi\.shopee/i);

  const route = await readFile(new URL("../src/app/api/integrations/route.ts", import.meta.url), "utf8");
  assert.match(route, /localOnly:\s*true/);
  assert.match(route, /marketplaceAccessRevoked:\s*false/);
});
