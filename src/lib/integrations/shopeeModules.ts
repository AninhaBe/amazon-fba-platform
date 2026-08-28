import { dbQuery, dbTransaction, hasDb } from "../db";
import { currentWorkspaceId } from "../workspaceScope";
import { getIntegrations } from "./integrationStore";
import { getShopeeOverviewFromCanonical, shopeeCostId } from "./shopeeOverviewCanonical";
import { getCosts, setCost } from "../costStore";
import { invalidateCostDerivedCaches } from "../costInvalidation";
import type { IntegrationConnection } from "./types";
import { shopeeAbcClass, shopeePageRequest, shopeePeriodRequest, ShopeeModuleError } from "./shopeeModuleContract";
import { withShopeeIntegrationWriteFence } from "./shopeeWriteFence";
import { escolherConexaoPadrao } from "./conexaoPadrao";

const PROVIDER = "shopee";
type Row = Record<string, unknown>;

export async function requireShopeeConnection(params: URLSearchParams): Promise<IntegrationConnection> {
  const requested = params.get("connection_id") ?? params.get("connectionId");
  return selectShopeeConnection(await getIntegrations(PROVIDER), requested);
}

export function selectShopeeConnection(connections: IntegrationConnection[], requested?: string | null): IntegrationConnection {
  // ⚠️ A escolha vem de `escolherConexaoPadrao`, a MESMA função que o seletor da
  // tela usa. Ter duas cópias da regra (era o caso até 28/08/2026) é como o
  // servidor acaba pintando a loja A enquanto o seletor diz loja B.
  const connection = escolherConexaoPadrao(
    connections.filter((item) => item.provider === PROVIDER),
    requested,
  );
  if (!connection) {
    throw new ShopeeModuleError(404, "CONNECTION_NOT_FOUND", "Nenhuma loja Shopee conectada.");
  }
  return connection;
}

export async function readShopeeCatalog(connection: IntegrationConnection, params: URLSearchParams) {
  const page = shopeePageRequest(params), q = (params.get("q") ?? "").trim();
  if (q.length > 120) throw new ShopeeModuleError(400, "INVALID_SEARCH", "Busca muito longa.");
  if (!hasDb()) return { items: [], page: { ...page, total: 0, hasMore: false }, availability: "NOT_AVAILABLE" as const };
  const rows = await dbQuery<Row>(`SELECT external_product_id,sku,title,status,provider_status,price,currency,available_qty,thumbnail,permalink,synced_at,COUNT(*) OVER()::int total FROM workspace_channel_products WHERE workspace_id=$1 AND provider=$2 AND connection_id=$3 AND ($4='' OR title ILIKE '%'||$4||'%' OR COALESCE(sku,'') ILIKE '%'||$4||'%' OR external_product_id ILIKE '%'||$4||'%') ORDER BY title,COALESCE(sku,''),external_product_id LIMIT $5 OFFSET $6`, [currentWorkspaceId(), PROVIDER, connection.id, q, page.limit, page.offset]);
  const items = rows.map(r => ({ productId: String(r.external_product_id), sku: r.sku == null ? null : String(r.sku), title: String(r.title), status: String(r.status), providerStatus: String(r.provider_status), price: r.price == null ? null : Number(r.price), currency: String(r.currency), availableQty: r.available_qty == null ? null : Number(r.available_qty), thumbnail: r.thumbnail == null ? null : String(r.thumbnail), permalink: r.permalink == null ? null : String(r.permalink), updatedAt: new Date(String(r.synced_at)).toISOString() }));
  const total = Number(rows[0]?.total ?? 0);
  return { items, page: { ...page, total, hasMore: page.offset + items.length < total }, availability: "AVAILABLE" as const };
}

export async function readShopeeInventory(connection: IntegrationConnection, params: URLSearchParams) {
  const period = shopeePeriodRequest(params), catalog = await readShopeeCatalog(connection, params);
  if (!hasDb()) return { ...catalog, period: { from: period.from.toISOString(), to: period.to.toISOString() } };
  const sold = await dbQuery<Row>(`SELECT i.external_product_id,i.sku,SUM(i.qty)::int units FROM workspace_channel_order_items i JOIN workspace_channel_orders o USING(workspace_id,provider,connection_id,external_order_id) WHERE i.workspace_id=$1 AND i.provider=$2 AND i.connection_id=$3 AND o.occurred_at BETWEEN $4 AND $5 AND o.status=ANY($6::text[]) GROUP BY i.external_product_id,i.sku`, [currentWorkspaceId(), PROVIDER, connection.id, period.from, period.to, ["paid","shipped","delivered"]]);
  const units = new Map(sold.map(r => [`${r.external_product_id}\0${r.sku ?? ""}`, Number(r.units)]));
  const days = Math.max(1, (period.to.getTime() - period.from.getTime()) / 86_400_000);
  return { ...catalog, items: catalog.items.map(p => { const unitsSold = units.get(`${p.productId}\0${p.sku ?? ""}`) ?? 0; const averagePerDay = unitsSold / days; return { ...p, unitsSold, averagePerDay: +averagePerDay.toFixed(4), daysRemaining: p.availableQty != null && averagePerDay > 0 ? +(p.availableQty / averagePerDay).toFixed(1) : null }; }), period: { from: period.from.toISOString(), to: period.to.toISOString() } };
}

export async function readShopeeFinance(connection: IntegrationConnection, params: URLSearchParams) {
  const period = shopeePeriodRequest(params), page = shopeePageRequest(params);
  // Busca do monitor (E3): pedido, SKU ou título — filtrada no servidor, junto
  // da paginação, para nunca buscar só na página carregada.
  const q = (params.get("q") ?? "").trim();
  if (q.length > 120) throw new ShopeeModuleError(400, "INVALID_FILTER", "Busca muito longa.");
  const overview = await getShopeeOverviewFromCanonical(connection, period, { detailPage: page, detailQuery: q });
  if (!overview) return { availability: "NOT_AVAILABLE" as const, profit: null, orders: [], page: { ...page, total: 0, hasMore: false, complete: true } };
  return {
    availability: "AVAILABLE" as const,
    period: overview.period,
    currency: overview.metrics.currency,
    profit: overview.profit,
    orders: overview.profitabilityLines,
    page: {
      limit: overview.profitabilityPage.limit,
      offset: overview.profitabilityPage.offset,
      total: overview.profitabilityPage.totalOrders,
      returned: overview.profitabilityPage.returnedOrders,
      hasMore: overview.profitabilityPage.hasMore,
      complete: overview.profitabilityPage.complete,
    },
  };
}

export async function readShopeeAbc(connection: IntegrationConnection, params: URLSearchParams) {
  const period = shopeePeriodRequest(params), overview = await getShopeeOverviewFromCanonical(connection, period);
  if (!overview) return { items: [], coverage: null, availability: "NOT_AVAILABLE" as const };
  const rows = await dbQuery<Row>(`SELECT i.external_product_id,i.sku,MAX(i.title) title,SUM(i.qty*i.unit_price)::numeric revenue,SUM(i.qty)::int units FROM workspace_channel_order_items i JOIN workspace_channel_orders o USING(workspace_id,provider,connection_id,external_order_id) WHERE i.workspace_id=$1 AND i.provider=$2 AND i.connection_id=$3 AND o.occurred_at BETWEEN $4 AND $5 AND o.status=ANY($6::text[]) GROUP BY i.external_product_id,i.sku ORDER BY revenue DESC,i.external_product_id,i.sku`, [currentWorkspaceId(), PROVIDER, connection.id, period.from, period.to, ["paid","shipped","delivered"]]);
  const total = rows.reduce((sum, item) => sum + Number(item.revenue), 0); let cumulative = 0;
  return { items: rows.map(item => { const revenue = Number(item.revenue); cumulative += revenue; const share = total > 0 ? revenue / total : 0; return { productId: String(item.external_product_id), sku: item.sku == null ? null : String(item.sku), title: String(item.title), revenue, units: Number(item.units), revenueShare: +(share * 100).toFixed(2), class: shopeeAbcClass(total > 0 ? cumulative / total : 0), profit: null, profitAvailable: false }; }), coverage: overview.metrics.revenueCoverage, profitSubset: { profitAvailable: false, reason: "Lucro por SKU não é derivável com segurança do contrato canônico atual." }, availability: "AVAILABLE" as const };
}

export async function readShopeeCosts(connection: IntegrationConnection, params: URLSearchParams) {
  const [catalog, costs] = await Promise.all([readShopeeCatalog(connection, params), getCosts()]);
  return { ...catalog, items: catalog.items.map(product => { const id = shopeeCostId(connection.id, product.productId, product.sku); return { ...product, id, cost: costs[id]?.cost ?? null, costUpdatedAt: costs[id]?.updatedAt ?? null }; }) };
}

export async function writeShopeeCost(connection: IntegrationConnection, body: unknown) {
  const value = body as Record<string, unknown>; const productId = typeof value?.productId === "string" ? value.productId.trim() : ""; const sku = typeof value?.sku === "string" ? value.sku.trim() : null; const cost = typeof value?.cost === "number" ? value.cost : Number.NaN;
  if (!productId || productId.length > 160 || (sku?.length ?? 0) > 160 || !Number.isFinite(cost) || cost < 0) throw new ShopeeModuleError(400, "INVALID_COST", "Produto, SKU ou custo inválido.");
  const entry = { id: shopeeCostId(connection.id, productId, sku), sku: sku ?? undefined, title: typeof value.title === "string" ? value.title.slice(0, 300) : undefined, cost };
  if (!hasDb()) { const salvo = await setCost(entry); await invalidateCostDerivedCaches(); return salvo; }
  const fenced = await withShopeeIntegrationWriteFence(
    dbTransaction,
    currentWorkspaceId(),
    connection.id,
    (query) => setCost(entry, query),
  );
  if (!fenced.owned) throw new ShopeeModuleError(404, "CONNECTION_NOT_FOUND", "Nenhuma loja Shopee conectada.");
  // Depois do commit: invalidar antes deixaria a janela em que um leitor
  // recacheia o valor velho e a troca some de novo.
  await invalidateCostDerivedCaches();
  return fenced.value;
}
