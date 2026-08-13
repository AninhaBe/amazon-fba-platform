// Concilia somente o backlog financeiro TikTok em lotes limitados. Nao imprime
// workspace, loja, pedido, credencial ou payload do marketplace.
import { dbQuery, hasDb } from "../src/lib/db.ts";
import { runWithWorkspace } from "../src/lib/workspaceScope.ts";
import { runTiktokSyncBatch } from "../src/lib/integrations/tiktokSync.ts";
import { getTiktokOverviewFromCanonical } from "../src/lib/integrations/tiktokOverviewCanonical.ts";

if (!hasDb()) throw new Error("Variavel ausente: DATABASE_URL");

const connections = await dbQuery(
  `SELECT s.workspace_id, sync.connection_id, s.tax_rate
     FROM workspace_marketplace_syncs sync
     JOIN workspace_tiktok_shops s ON s.workspace_id=sync.workspace_id
      AND sync.connection_id='tiktok_shop:' || s.shop_id
    WHERE sync.provider='tiktok_shop' ORDER BY s.workspace_id, sync.connection_id`
);

async function totals(workspaceId, connectionId) {
  return runWithWorkspace(workspaceId, async () => {
    const [row] = await dbQuery(
      `SELECT COUNT(*) FILTER (WHERE o.status IN ('paid','shipped','delivered'))::int AS eligible,
              COUNT(*) FILTER (WHERE o.status IN ('paid','shipped','delivered')
                AND COALESCE((o.raw#>>'{_sellercore,statementSettled}')::boolean,false))::int AS settled,
              COUNT(*) FILTER (WHERE o.status IN ('paid','shipped','delivered')
                AND NOT COALESCE((o.raw#>>'{_sellercore,statementSettled}')::boolean,false))::int AS backlog
         FROM workspace_channel_orders o
        WHERE o.workspace_id=$1 AND o.provider='tiktok_shop' AND o.connection_id=$2`,
      [workspaceId, connectionId]
    );
    return row;
  });
}

for (let index = 0; index < connections.length; index++) {
  const item = connections[index];
  const before = await totals(item.workspace_id, item.connection_id);
  const status = process.env.TIKTOK_DIAGNOSTIC_ONLY === "1" ? null : await runWithWorkspace(item.workspace_id,
    () => runTiktokSyncBatch(item.connection_id, 45_000));
  const after = await totals(item.workspace_id, item.connection_id);
  const overview = await runWithWorkspace(item.workspace_id, () => getTiktokOverviewFromCanonical({
    id: item.connection_id, provider: "tiktok_shop", externalAccountId: "redacted",
    mode: "local", scopes: [], metadata: { taxRate: item.tax_rate == null ? null : Number(item.tax_rate) },
    status: "connected", connectedAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
  }, { from: new Date(Date.now() - 30 * 86_400_000), to: new Date(), label: "30 dias" }));
  console.log(JSON.stringify({ connection: index + 1, before, after,
    sync: status ? { status: status.status, phase: status.phase, ordersComplete: status.ordersComplete,
      productsComplete: status.productsComplete, financialBacklog: status.financialBacklog } : null,
    overview: overview ? { orders: overview.orders, ...overview.overview,
      coverage: Object.fromEntries(Object.entries(overview.coverage).map(([key, value]) =>
        [key, { status: value.status, applicable: value.applicable, known: value.known,
          missing: value.missing, pending: value.pending }])) } : null }));
}
