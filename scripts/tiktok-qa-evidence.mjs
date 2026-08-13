// Evidencia agregada e somente leitura para QA da TikTok Shop real.
// Nunca imprime workspace, loja, pedido, token, cookie, payload ou PII.
//
// Uso (origem -> banco -> overview):
//   node --experimental-strip-types --import ./scripts/ts-resolver.mjs \
//     --env-file=.env.local scripts/tiktok-qa-evidence.mjs
//
// Para incluir API interna autenticada (sessao copiada do navegador apenas para
// o processo atual; nao salvar em arquivo ou historico):
//   SELLERCORE_HEALTH_COOKIE='<cookie completo>' ...mesmo comando...

// O script e deliberadamente read-only: nao chama refresh, sync ou qualquer
// funcao de persistencia.

import { dbQuery, hasDb } from "../src/lib/db.ts";
import { runWithWorkspace } from "../src/lib/workspaceScope.ts";
import { getTiktokOrderList } from "../src/lib/tiktok.ts";
import { getTiktokShops } from "../src/lib/tiktokStore.ts";
import { getTiktokOverviewFromCanonical } from "../src/lib/integrations/tiktokOverviewCanonical.ts";
import { tiktokConnectionId } from "../src/lib/integrations/tiktokSync.ts";
import { REVENUE_STATUSES } from "../src/lib/integrations/canonical.ts";
import {
  publicConnectionEvidence,
  publicOverview,
  selectExclusiveEvidenceCandidate,
} from "./tiktok-qa-evidence-output.mjs";

const DAY = 86_400_000;
const days = 15;
const now = new Date();
const brazilToday = new Date(now.getTime() - 3 * 60 * 60_000).toISOString().slice(0, 10);
const fromDate = new Date(new Date(`${brazilToday}T00:00:00-03:00`).getTime() - days * DAY);
const period = { from: fromDate, to: now, label: `Ultimos ${days} dias` };
const dashboardPeriod = { ...period };

function safeError(error) {
  const name = error instanceof Error ? error.name : "Error";
  return { ok: false, error: name };
}

async function authenticatedApi(connectionId) {
  const cookie = process.env.SELLERCORE_HEALTH_COOKIE?.trim();
  if (!cookie) return { status: "BLOCKED", reason: "SELLERCORE_HEALTH_COOKIE ausente" };
  const base = process.env.SELLERCORE_QA_BASE_URL?.trim() || "http://127.0.0.1:3000";
  const params = new URLSearchParams({
    from: period.from.toISOString().slice(0, 10),
    to: period.to.toISOString().slice(0, 10),
    connection_id: connectionId,
  });
  const response = await fetch(`${base}/api/integrations/tiktok/overview?${params}`, {
    headers: { cookie }, redirect: "manual", signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) return { status: "FAIL", httpStatus: response.status };
  const body = await response.json();
  return { status: "PASS", httpStatus: response.status, overview: publicOverview(body) };
}

if (!hasDb()) throw new Error("Variavel ausente: DATABASE_URL");
if (!process.env.TIKTOK_APP_KEY || !process.env.TIKTOK_APP_SECRET) {
  throw new Error("Credenciais de aplicacao TikTok ausentes.");
}

const candidates = await dbQuery(
  `SELECT s.workspace_id, s.shop_id, sync.covered_to,
          (SELECT COUNT(DISTINCT owner.workspace_id)::int
             FROM workspace_tiktok_shops owner
            WHERE owner.shop_id=s.shop_id) AS ownership_count
     FROM workspace_tiktok_shops s
     JOIN workspace_marketplace_syncs sync
       ON sync.workspace_id=s.workspace_id AND sync.provider='tiktok_shop'
      AND sync.connection_id='tiktok_shop:' || s.shop_id
    WHERE lower(s.shop_name)=lower($1)
    ORDER BY s.workspace_id, s.shop_id`,
  ["Crystal Fancy"]
);
const candidate = selectExclusiveEvidenceCandidate(candidates);
if (!candidate.covered_to) throw new Error("Cobertura canonica ausente.");
period.to = new Date(Math.min(period.to.getTime(), new Date(candidate.covered_to).getTime()));

const evidence = await runWithWorkspace(candidate.workspace_id, async () => {
    const shops = await getTiktokShops();
    const shop = shops.find((item) => item.shopId === candidate.shop_id);
    if (!shop) throw new Error("Conexao indisponivel no workspace.");
    const expiresAt = shop.accessExpiresAt ? new Date(shop.accessExpiresAt).getTime() : 0;
    if (!expiresAt || expiresAt <= Date.now()) {
      throw new Error("Access token expirado; refresh recusado por este harness.");
    }
    const connectionId = tiktokConnectionId(shop.shopId);
    const connection = {
      id: connectionId, provider: "tiktok_shop", externalAccountId: shop.shopId,
      displayName: "TikTok Shop", mode: "local", region: shop.region,
      scopes: [], metadata: {}, status: "connected", connectedAt: shop.connectedAt,
      updatedAt: shop.connectedAt,
    };
    const overview = await getTiktokOverviewFromCanonical(connection, period);
    const dashboardOverview = await getTiktokOverviewFromCanonical(connection, dashboardPeriod);
    const dbAggregate = await dbQuery(
      `SELECT count(*)::int AS all_orders,
              count(*) FILTER (WHERE status=ANY($5::text[]))::int AS revenue_orders,
              COALESCE(sum(gross) FILTER (WHERE status=ANY($5::text[])),0)::numeric AS revenue
         FROM workspace_channel_orders
        WHERE workspace_id=$1 AND provider='tiktok_shop' AND connection_id=$2
          AND occurred_at >= $3 AND occurred_at <= $4`,
      [candidate.workspace_id, connectionId, period.from, period.to, [...REVENUE_STATUSES]]
    );
    return {
      connectionId,
      database: { allOrders: dbAggregate[0].all_orders, revenueOrders: dbAggregate[0].revenue_orders, revenue: Number(dbAggregate[0].revenue) },
      overview: publicOverview(overview),
      dashboardCurrent: dashboardOverview,
    };
});

// A origem e consultada somente depois de provar ownership global exclusivo.
const source = await runWithWorkspace(candidate.workspace_id, async () => {
  const shop = (await getTiktokShops()).find((item) => item.shopId === candidate.shop_id);
  if (!shop) throw new Error("Conexao indisponivel.");
  const expiresAt = shop.accessExpiresAt ? new Date(shop.accessExpiresAt).getTime() : 0;
  if (!expiresAt || expiresAt <= Date.now()) throw new Error("Access token expirado; refresh nao executado.");
  let pageToken;
  let pages = 0;
  let count = 0;
  const uniqueOrderIds = new Set();
  do {
    const page = await getTiktokOrderList({ accessToken: shop.accessToken, shopCipher: shop.shopCipher }, {
      createTimeGe: Math.floor(period.from.getTime() / 1000),
      createTimeLt: Math.floor(period.to.getTime() / 1000), pageToken,
    });
    pages += 1;
    count += page.items.length;
    for (const item of page.items) uniqueOrderIds.add(item.id);
    pageToken = page.nextPageToken;
    if (pages > 500) throw new Error("Limite defensivo de paginacao excedido.");
  } while (pageToken);
  return { ok: true, pages, returnedRows: count, uniqueOrders: uniqueOrderIds.size, duplicateRows: count - uniqueOrderIds.size };
}).catch(safeError);

const api = await authenticatedApi(evidence.connectionId).catch(safeError);
console.log(JSON.stringify({
  window: { from: period.from.toISOString(), to: period.to.toISOString(), timezone: "America/Sao_Paulo" },
  source, connection: publicConnectionEvidence(evidence), api,
}, null, 2));
