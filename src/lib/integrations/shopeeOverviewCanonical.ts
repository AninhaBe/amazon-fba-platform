import { dbQuery, hasDb } from "../db";
import { currentWorkspaceId } from "../workspaceScope";
import { getCosts, costAt } from "../costStore";
import { allocateByWeight, calculateContribution, type ProfitabilityLine } from "../profitability";
import { classificarCobertura, ORDEM_DO_RADAR, type StockStatus } from "../coberturaDeEstoque";
import { REVENUE_STATUSES } from "./canonical";
import { getShopeeTaxRateSetting, normalizeShopeeTaxRate } from "./shopeeSettings";
import type { IntegrationConnection, IntegrationProvider } from "./types";

// Overview da Shopee servido pelo modelo canônico (docs/canonical-schema.md).
//
// Mesma semântica do overview do Mercado Livre — rateio de tarifa por peso de
// receita, custo por vigência, cobertura sem extrapolar — com duas diferenças
// que vêm do canal:
//   1. Faturamento = status de receita do canônico. A regra "aprovadas +
//      canceladas" é peculiaridade do painel do ML, não vale aqui.
//   2. Produtos saem de workspace_channel_products (canônico). O ML ainda lê da
//      tabela legada; quando ele migrar, este módulo e o dele viram um só,
//      parametrizados por provider — a duplicação atual é consciente para não
//      mexer num cálculo já validado ao centavo.

const PROVIDER = "shopee";
const DEFAULT_DETAILED_ORDER_LIMIT = 100;
const REVENUE = [...REVENUE_STATUSES];
const COVERAGE_TOLERANCE_MS = 15 * 60_000;

function brazilDateKey(date: Date | string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(typeof date === "string" ? new Date(date) : date);
}

export interface ShopeePeriod {
  from: Date;
  to: Date;
  label: string;
}

interface SyncMetaRow {
  covered_from: Date | string | null;
  covered_to: Date | string | null;
  products_synced_at: Date | string | null;
  products_total: number;
  active_products: number;
  products_complete: boolean;
}

interface TotalsRow {
  total_orders: number;
  paid_orders: number;
  paid_revenue: string | null;
  cancelled_revenue: string | null;
  cancelled_orders: number;
  currency: string | null;
  last_sale_at: Date | string | null;
}

interface DailyRow { date: string; revenue: string; orders: number; units: number }

interface AggRow {
  orders_processed: number;
  processed_revenue: string | null;
  buyer_shipping: string | null;
  fees: string | null;
  seller_shipping: string | null;
  orders_with_fees: number;
  ads: string | null; taxes_withheld: string | null; refunds: string | null;
  orders_with_shipping: number; orders_with_ads: number; orders_with_taxes_withheld: number; orders_with_refunds: number;
}

interface CogsRow {
  external_product_id: string;
  sku: string | null;
  occurred_at: Date | string;
  qty: number;
}

interface RecentRow {
  external_order_id: string;
  provider_status: string;
  occurred_at: Date | string;
  gross: string;
  currency: string;
  units: number;
}

interface ProductTotalsRow {
  external_product_id: string;
  sku: string | null;
  title: string;
  units: number;
  revenue: string;
}

interface DetailedLineRow {
  external_order_id: string;
  occurred_at: Date | string;
  provider_status: string;
  currency: string;
  gross: string;
  buyer_shipping: string | null;
  fulfillment: string | null;
  line_no: number;
  external_product_id: string;
  sku: string | null;
  title: string;
  qty: number;
  unit_price: string;
  commission: string | null;
  seller_shipping: string | null;
  ads: string | null; taxes_withheld: string | null; refunds: string | null;
  fees_known: boolean; shipping_known: boolean; ads_known: boolean; taxes_withheld_known: boolean; refunds_known: boolean;
  financial_settled: boolean;
}

interface CatalogRow {
  external_product_id: string;
  sku: string | null;
  title: string;
  status: string;
  price: string;
  available_qty: number;
  thumbnail: string | null;
  permalink: string | null;
  synced_at: Date | string;
}

/** Chave de custo do canal — mesmo formato dos demais: provider:conexão:sku|item. */
export function shopeeCostId(connectionId: string, productId: string, sku?: string | null): string {
  return `shopee:${connectionId}:${sku ? `sku:${sku}` : `item:${productId}`}`;
}

function shopeeCostEntry(
  costs: Awaited<ReturnType<typeof getCosts>>,
  connectionId: string,
  productId: string,
  sku?: string | null,
  namespace = "shopee"
) {
  const preferred = costs[`${namespace}:${connectionId}:${sku ? `sku:${sku}` : `item:${productId}`}`];
  if (preferred) return preferred;
  if (!sku) return undefined;
  return Object.values(costs).find(
    (entry) => entry.sku === sku && entry.id.startsWith(`${namespace}:${connectionId}:`)
  );
}

export function shopeeTaxRate(connection: IntegrationConnection): number | null {
  const raw = connection.metadata?.taxRate;
  if (raw == null) return null;

  let value: number;
  if (typeof raw === "number") {
    value = raw;
  } else if (typeof raw === "string") {
    const normalized = raw.trim();
    if (!normalized || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return null;
    value = Number(normalized);
  } else {
    return null;
  }

  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

export interface ShopeeOverview {
  account: { id: string; name: string; region: string };
  period: { from: string; to: string; label: string };
  metrics: {
    activeListings: number;
    productsWithoutCost: number;
    orders30d: number;
    paidOrders: number;
    revenue30d: number;
    cancelledRevenue: number;
    cancelledOrders: number;
    lastSaleAt: string | null;
    currency: string;
    revenueCoverage: { capturedOrders: number; totalOrders: number; complete: boolean };
  };
  profit: {
    fees: number | null;
    ads: number | null;
    taxesWithheld: number | null;
    refunds: number | null;
    cogs: number | null;
    taxes: number | null;
    taxRate: number | null;
    taxRateKnown: boolean;
    sellerShipping: number | null;
    buyerShipping: number | null;
    feesComplete: boolean;
    revenueProcessed: number;
    coverage: { processedOrders: number; paidOrders: number; complete: boolean };
    estimatedProfit: number | null;
    marginPct: number | null;
    unitsWithoutCost: number;
  };
  dailySales: Array<{ date: string; revenue: number; orders: number; units: number }>;
  topProducts: Array<{
    id: string; sku: string | null; title: string; units: number; revenue: number;
    cost: number; contribution: number; complete: boolean; marginPct: number | null;
  }>;
  stockRadar: Array<{
    id: string; sku: string | null; title: string; availableQuantity: number;
    unitsSold: number; calculationDays: number; daysRemaining: number | null;
    status: StockStatus;
  }>;
  profitabilityLines: ProfitabilityLine[];
  profitabilityPage: {
    limit: number; offset: number; totalOrders: number; returnedOrders: number;
    hasMore: boolean; complete: boolean;
  };
  recentOrders: Array<{
    id: string; status: string; createdAt: string; total: number; currency: string; items: number;
  }>;
}

function scopeParams(
  workspaceId: string,
  connectionId: string,
  period: ShopeePeriod,
  provider: IntegrationProvider
): unknown[] {
  return [workspaceId, provider, connectionId, period.from, period.to];
}

export interface CanonicalOverviewOptions {
  provider?: IntegrationProvider;
  costNamespace?: string;
  fulfillmentLabel?: string;
  taxRateKnown?: boolean;
  query?: typeof dbQuery;
  costs?: Awaited<ReturnType<typeof getCosts>>;
  workspaceId?: string;
  detailPage?: { limit: number; offset: number };
  /** Injeção explícita para testes; produção lê workspace_settings por conexão. */
  taxRate?: unknown;
}

export async function getShopeeOverviewFromCanonical(
  connection: IntegrationConnection,
  period: ShopeePeriod,
  options: CanonicalOverviewOptions = {}
): Promise<ShopeeOverview | null> {
  const query = options.query ?? dbQuery;
  if (!options.query && !hasDb()) return null;
  const workspaceId = options.workspaceId ?? currentWorkspaceId();
  const provider = options.provider ?? PROVIDER;
  const costNamespace = options.costNamespace ?? "shopee";
  const fulfillmentLabel = options.fulfillmentLabel ?? "Shopee";
  const hasTaxRateOverride = Object.prototype.hasOwnProperty.call(options, "taxRate");
  const configuredTaxRatePromise = hasTaxRateOverride
    ? Promise.resolve(normalizeShopeeTaxRate(options.taxRate))
    : getShopeeTaxRateSetting(query, workspaceId, connection.id);
  // O override pode tornar uma alíquota configurada deliberadamente desconhecida,
  // mas nunca converte ausência em zero conhecido.
  const detailPage = options.detailPage ?? { limit: DEFAULT_DETAILED_ORDER_LIMIT, offset: 0 };
  if (!Number.isInteger(detailPage.limit) || detailPage.limit < 1 || detailPage.limit > 100
    || !Number.isInteger(detailPage.offset) || detailPage.offset < 0) {
    throw new RangeError("Paginação do detalhe financeiro inválida.");
  }

  const [configuredTaxRate, syncRows, totalsRows] = await Promise.all([
    configuredTaxRatePromise,
    query<SyncMetaRow>(
      `SELECT covered_from, covered_to, products_synced_at, products_total, active_products, products_complete
         FROM workspace_marketplace_syncs
        WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3`,
      [workspaceId, provider, connection.id]
    ),
    query<TotalsRow>(
      `SELECT COUNT(*)::int AS total_orders,
              COUNT(*) FILTER (WHERE status = ANY($6::text[]))::int AS paid_orders,
              SUM(gross) FILTER (WHERE status = ANY($6::text[])) AS paid_revenue,
              SUM(gross) FILTER (WHERE status = 'cancelled') AS cancelled_revenue,
              COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled_orders,
              MAX(occurred_at) FILTER (WHERE status = ANY($6::text[])) AS last_sale_at,
              MAX(currency) AS currency
         FROM workspace_channel_orders
        WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
          AND occurred_at >= $4 AND occurred_at <= $5`,
      [...scopeParams(workspaceId, connection.id, period, provider), REVENUE]
    ),
  ]);
  const taxRateKnown = configuredTaxRate != null && (options.taxRateKnown ?? true);

  const syncRow = syncRows[0];
  const totals = totalsRows[0];
  // Sem sync e sem pedido no período: a UI mostra o estado de conexão, não zeros.
  if (!syncRow || (!syncRow.products_synced_at && (totals?.total_orders ?? 0) === 0)) return null;

  const [dailyRows, recentRows, productTotalsRows, lineRows, catalogRows, costs, aggRows, cogsRows] =
    await Promise.all([
      query<DailyRow>(
        `SELECT to_char(o.occurred_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS date,
                SUM(o.gross) AS revenue,
                COUNT(*)::int AS orders,
                COALESCE(SUM(u.units), 0)::int AS units
           FROM workspace_channel_orders o
           LEFT JOIN LATERAL (
             SELECT SUM(i.qty)::int AS units FROM workspace_channel_order_items i
              WHERE i.workspace_id = o.workspace_id AND i.provider = o.provider
                AND i.connection_id = o.connection_id AND i.external_order_id = o.external_order_id
           ) u ON true
          WHERE o.workspace_id = $1 AND o.provider = $2 AND o.connection_id = $3
            AND o.occurred_at >= $4 AND o.occurred_at <= $5 AND o.status = ANY($6::text[])
          GROUP BY 1`,
        [...scopeParams(workspaceId, connection.id, period, provider), REVENUE]
      ),
      query<RecentRow>(
        `SELECT o.external_order_id, o.provider_status, o.occurred_at, o.gross, o.currency,
                COALESCE((SELECT SUM(i.qty)::int FROM workspace_channel_order_items i
                           WHERE i.workspace_id = o.workspace_id AND i.provider = o.provider
                             AND i.connection_id = o.connection_id AND i.external_order_id = o.external_order_id), 0) AS units
           FROM workspace_channel_orders o
          WHERE o.workspace_id = $1 AND o.provider = $2 AND o.connection_id = $3
            AND o.occurred_at >= $4 AND o.occurred_at <= $5
          ORDER BY o.occurred_at DESC
          LIMIT 10`,
        scopeParams(workspaceId, connection.id, period, provider)
      ),
      query<ProductTotalsRow>(
        `SELECT i.external_product_id, i.sku, MIN(i.title) AS title,
                SUM(i.qty)::int AS units, SUM(i.qty * i.unit_price) AS revenue
           FROM workspace_channel_order_items i
           JOIN workspace_channel_orders o
             ON o.workspace_id = i.workspace_id AND o.provider = i.provider
            AND o.connection_id = i.connection_id AND o.external_order_id = i.external_order_id
          WHERE i.workspace_id = $1 AND i.provider = $2 AND i.connection_id = $3
            AND o.occurred_at >= $4 AND o.occurred_at <= $5 AND o.status = ANY($6::text[])
          GROUP BY i.external_product_id, i.sku`,
        [...scopeParams(workspaceId, connection.id, period, provider), REVENUE]
      ),
      query<DetailedLineRow>(
        `WITH detailed AS (
           -- Colunas primeiro (ADR-026 R2); o fallback ao raw cobre as linhas
           -- antigas até o backfill concluir e o namespace _sellercore morrer.
           SELECT external_order_id, occurred_at, provider_status, currency, gross, buyer_shipping, fulfillment,
                  (evidence_fees OR COALESCE((raw #>> '{_sellercore,financialEvidence,fees}')::boolean, false)) AS fees_known,
                  (evidence_seller_shipping OR COALESCE((raw #>> '{_sellercore,financialEvidence,sellerShipping}')::boolean, false)) AS shipping_known,
                  (evidence_ads OR COALESCE((raw #>> '{_sellercore,financialEvidence,ads}')::boolean, false)) AS ads_known,
                  (evidence_taxes_withheld OR COALESCE((raw #>> '{_sellercore,financialEvidence,taxesWithheld}')::boolean, false)) AS taxes_withheld_known,
                  (evidence_refunds OR COALESCE((raw #>> '{_sellercore,financialEvidence,refunds}')::boolean, false)) AS refunds_known,
                  (financial_settled OR COALESCE(raw #>> '{_sellercore,shopeeEscrowSettled}', 'false') = 'true') AS financial_settled
             FROM workspace_channel_orders
            WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
              AND occurred_at >= $4 AND occurred_at <= $5 AND status = ANY($6::text[])
              AND EXISTS (SELECT 1 FROM workspace_channel_order_items di
                           WHERE di.workspace_id = workspace_channel_orders.workspace_id
                             AND di.provider = workspace_channel_orders.provider
                             AND di.connection_id = workspace_channel_orders.connection_id
                             AND di.external_order_id = workspace_channel_orders.external_order_id)
            ORDER BY occurred_at DESC
            LIMIT $7 OFFSET $8
         )
         SELECT d.external_order_id, d.occurred_at, d.provider_status, d.currency, d.gross,
                d.buyer_shipping, d.fulfillment, d.financial_settled, d.fees_known, d.shipping_known,
                d.ads_known, d.taxes_withheld_known, d.refunds_known,
                i.line_no, i.external_product_id, i.sku, i.title, i.qty, i.unit_price,
                fc.amount AS commission, fs.amount AS seller_shipping, fa.amount AS ads,
                ft.amount AS taxes_withheld, fr.amount AS refunds
           FROM detailed d
           JOIN workspace_channel_order_items i
             ON i.workspace_id = $1 AND i.provider = $2 AND i.connection_id = $3
            AND i.external_order_id = d.external_order_id
           LEFT JOIN LATERAL (
             SELECT SUM(amount) AS amount FROM workspace_channel_order_fees f
              WHERE f.workspace_id = $1 AND f.provider = $2 AND f.connection_id = $3
                AND f.external_order_id = d.external_order_id
                AND f.fee_type IN ('commission', 'payment')
           ) fc ON true
           LEFT JOIN LATERAL (
             SELECT SUM(amount) AS amount FROM workspace_channel_order_fees f
              WHERE f.workspace_id = $1 AND f.provider = $2 AND f.connection_id = $3
                AND f.external_order_id = d.external_order_id
                AND f.fee_type IN ('shipping_seller', 'fulfillment')
           ) fs ON true
           LEFT JOIN LATERAL (SELECT SUM(amount) AS amount FROM workspace_channel_order_fees f WHERE f.workspace_id=$1 AND f.provider=$2 AND f.connection_id=$3 AND f.external_order_id=d.external_order_id AND f.fee_type='ads') fa ON true
           LEFT JOIN LATERAL (SELECT SUM(amount) AS amount FROM workspace_channel_order_fees f WHERE f.workspace_id=$1 AND f.provider=$2 AND f.connection_id=$3 AND f.external_order_id=d.external_order_id AND f.fee_type='taxes_withheld') ft ON true
           LEFT JOIN LATERAL (SELECT SUM(amount) AS amount FROM workspace_channel_order_fees f WHERE f.workspace_id=$1 AND f.provider=$2 AND f.connection_id=$3 AND f.external_order_id=d.external_order_id AND f.fee_type='refund') fr ON true
          ORDER BY d.occurred_at DESC, d.external_order_id, i.line_no`,
        [...scopeParams(workspaceId, connection.id, period, provider), REVENUE, detailPage.limit, detailPage.offset]
      ),
      query<CatalogRow>(
        `SELECT external_product_id, sku, title, status, price, available_qty, thumbnail, permalink, synced_at
           FROM workspace_channel_products
          WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3`,
        [workspaceId, provider, connection.id]
      ),
      options.costs ?? getCosts(),
      query<AggRow>(
        `WITH scoped AS (
           -- Colunas primeiro (ADR-026 R2); fallback ao raw até o backfill.
           SELECT o.gross, o.buyer_shipping,
                  (o.financial_settled
                    OR COALESCE(o.raw #>> '{_sellercore,shopeeEscrowSettled}', 'false') = 'true'
                    OR COALESCE(o.raw #>> '{_sellercore,statementSettled}', 'false') = 'true')
                    AS financial_settled,
                  EXISTS (SELECT 1 FROM workspace_channel_order_items i
                           WHERE i.workspace_id = o.workspace_id AND i.provider = o.provider
                             AND i.connection_id = o.connection_id AND i.external_order_id = o.external_order_id) AS has_items,
                  (SELECT SUM(f.amount) FROM workspace_channel_order_fees f
                    WHERE f.workspace_id = o.workspace_id AND f.provider = o.provider
                      AND f.connection_id = o.connection_id AND f.external_order_id = o.external_order_id
                      AND f.fee_type IN ('commission', 'payment')) AS commission,
                  (SELECT SUM(f.amount) FROM workspace_channel_order_fees f
                    WHERE f.workspace_id = o.workspace_id AND f.provider = o.provider
                      AND f.connection_id = o.connection_id AND f.external_order_id = o.external_order_id
                    AND f.fee_type IN ('shipping_seller', 'fulfillment')) AS seller_shipping
                  ,(SELECT SUM(f.amount) FROM workspace_channel_order_fees f WHERE f.workspace_id=o.workspace_id AND f.provider=o.provider AND f.connection_id=o.connection_id AND f.external_order_id=o.external_order_id AND f.fee_type='ads') AS ads
                  ,(SELECT SUM(f.amount) FROM workspace_channel_order_fees f WHERE f.workspace_id=o.workspace_id AND f.provider=o.provider AND f.connection_id=o.connection_id AND f.external_order_id=o.external_order_id AND f.fee_type='taxes_withheld') AS taxes_withheld
                  ,(SELECT SUM(f.amount) FROM workspace_channel_order_fees f WHERE f.workspace_id=o.workspace_id AND f.provider=o.provider AND f.connection_id=o.connection_id AND f.external_order_id=o.external_order_id AND f.fee_type='refund') AS refunds
                  ,(o.evidence_fees OR COALESCE((o.raw #>> '{_sellercore,financialEvidence,fees}')::boolean, false)) AS fees_known
                  ,(o.evidence_seller_shipping OR COALESCE((o.raw #>> '{_sellercore,financialEvidence,sellerShipping}')::boolean, false)) AS shipping_known
                  ,(o.evidence_ads OR COALESCE((o.raw #>> '{_sellercore,financialEvidence,ads}')::boolean, false)) AS ads_known
                  ,(o.evidence_taxes_withheld OR COALESCE((o.raw #>> '{_sellercore,financialEvidence,taxesWithheld}')::boolean, false)) AS taxes_withheld_known
                  ,(o.evidence_refunds OR COALESCE((o.raw #>> '{_sellercore,financialEvidence,refunds}')::boolean, false)) AS refunds_known
             FROM workspace_channel_orders o
            WHERE o.workspace_id = $1 AND o.provider = $2 AND o.connection_id = $3
              AND o.occurred_at >= $4 AND o.occurred_at <= $5 AND o.status = ANY($6::text[])
         )
         SELECT COUNT(*) FILTER (WHERE has_items)::int AS orders_processed,
                SUM(gross) FILTER (WHERE has_items) AS processed_revenue,
                SUM(buyer_shipping) FILTER (WHERE has_items) AS buyer_shipping,
                SUM(commission) FILTER (WHERE has_items) AS fees,
                SUM(seller_shipping) FILTER (WHERE has_items) AS seller_shipping,
                SUM(ads) FILTER (WHERE has_items) AS ads,
                SUM(taxes_withheld) FILTER (WHERE has_items) AS taxes_withheld,
                SUM(refunds) FILTER (WHERE has_items) AS refunds,
                COUNT(*) FILTER (WHERE has_items AND fees_known)::int AS orders_with_fees,
                COUNT(*) FILTER (WHERE has_items AND shipping_known)::int AS orders_with_shipping,
                COUNT(*) FILTER (WHERE has_items AND ads_known)::int AS orders_with_ads,
                COUNT(*) FILTER (WHERE has_items AND taxes_withheld_known)::int AS orders_with_taxes_withheld,
                COUNT(*) FILTER (WHERE has_items AND refunds_known)::int AS orders_with_refunds
           FROM scoped`,
        [...scopeParams(workspaceId, connection.id, period, provider), REVENUE]
      ),
      query<CogsRow>(
        `SELECT i.external_product_id, i.sku,
                MIN(o.occurred_at) AS occurred_at,
                SUM(i.qty)::int AS qty
           FROM workspace_channel_order_items i
           JOIN workspace_channel_orders o
             ON o.workspace_id = i.workspace_id AND o.provider = i.provider
            AND o.connection_id = i.connection_id AND o.external_order_id = i.external_order_id
          WHERE i.workspace_id = $1 AND i.provider = $2 AND i.connection_id = $3
            AND o.occurred_at >= $4 AND o.occurred_at <= $5 AND o.status = ANY($6::text[])
          GROUP BY i.external_product_id, i.sku,
                   to_char(o.occurred_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD')`,
        [...scopeParams(workspaceId, connection.id, period, provider), REVENUE]
      ),
    ]);

  const taxRate = configuredTaxRate;
  const currency = totals.currency ?? "BRL";
  const revenue = Number(totals.paid_revenue ?? 0);

  const productTotals = new Map<string, {
    id: string; sku: string | null; title: string; units: number; revenue: number;
    processedRevenue: number; cost: number; contribution: number; calculationsComplete: boolean;
  }>();
  const unitsByItem = new Map<string, number>();
  for (const row of productTotalsRows) {
    const key = row.sku || row.external_product_id;
    const current = productTotals.get(key)
      ?? { id: row.external_product_id, sku: row.sku, title: row.title, units: 0, revenue: 0, processedRevenue: 0, cost: 0, contribution: 0, calculationsComplete: true };
    current.units += row.units;
    current.revenue += Number(row.revenue);
    productTotals.set(key, current);
    unitsByItem.set(row.external_product_id, (unitsByItem.get(row.external_product_id) ?? 0) + row.units);
  }

  const linesByOrder = new Map<string, DetailedLineRow[]>();
  for (const row of lineRows) {
    const group = linesByOrder.get(row.external_order_id) ?? [];
    group.push(row);
    linesByOrder.set(row.external_order_id, group);
  }

  const agg = aggRows[0];
  const processedRevenue = Number(agg?.processed_revenue ?? 0);
  const ordersProcessed = agg?.orders_processed ?? 0;
  const ordersWithFees = agg?.orders_with_fees ?? 0;
  const allKnown = (known: number | undefined) => (known ?? 0) >= ordersProcessed;
  const fees = allKnown(agg?.orders_with_fees) ? Number(agg?.fees ?? 0) : null;
  const sellerShipping = allKnown(agg?.orders_with_shipping) ? +Number(agg?.seller_shipping ?? 0).toFixed(2) : null;
  const ads = allKnown(agg?.orders_with_ads) ? +Number(agg?.ads ?? 0).toFixed(2) : null;
  const taxesWithheld = allKnown(agg?.orders_with_taxes_withheld) ? +Number(agg?.taxes_withheld ?? 0).toFixed(2) : null;
  const refunds = allKnown(agg?.orders_with_refunds) ? +Number(agg?.refunds ?? 0).toFixed(2) : null;
  const buyerShipping = ordersProcessed === 0 || agg?.buyer_shipping != null ? +Number(agg?.buyer_shipping ?? 0).toFixed(2) : null;

  let cogs = 0;
  let unitsWithoutCost = 0;
  for (const row of cogsRows) {
    const entry = shopeeCostEntry(costs, connection.id, row.external_product_id, row.sku, costNamespace);
    if (entry) cogs += costAt(entry, new Date(row.occurred_at).toISOString()) * row.qty;
    else unitsWithoutCost += row.qty;
  }

  const profitabilityLines: ProfitabilityLine[] = [];
  for (const [orderId, lines] of linesByOrder) {
    const order = lines[0];
    // Na Shopee a tarifa real vem do escrow, que só fecha após o pagamento:
    // enquanto não chega, a linha fica marcada como incompleta em vez de virar zero.
    const feesKnown = order.fees_known && order.ads_known && order.taxes_withheld_known && order.refunds_known;
    const shippingKnown = order.shipping_known;
    const orderFees = Number(order.commission ?? 0) + Number(order.ads ?? 0)
      + Number(order.taxes_withheld ?? 0) + Number(order.refunds ?? 0);
    const orderSellerShipping = Number(order.seller_shipping ?? 0);
    const orderBuyerShipping = order.buyer_shipping == null ? null : Number(order.buyer_shipping);

    const weights = lines.map((line) => line.qty * Number(line.unit_price));
    const feeShares = allocateByWeight(orderFees, weights);
    const sellerShares = allocateByWeight(orderSellerShipping, weights);
    const buyerShares = allocateByWeight(orderBuyerShipping ?? 0, weights);

    lines.forEach((line, index) => {
      const lineRevenue = line.qty * Number(line.unit_price);
      const entry = shopeeCostEntry(costs, connection.id, line.external_product_id, line.sku, costNamespace);
      const occurredAt = new Date(line.occurred_at).toISOString();
      const unitCost = entry ? costAt(entry, occurredAt) : null;
      const lineFees = feesKnown ? feeShares[index] : null;
      const lineSellerShipping = shippingKnown ? sellerShares[index] : null;
      const lineBuyerShipping = orderBuyerShipping == null ? null : buyerShares[index];
      // Alíquota ausente NÃO bloqueia (decisão dela em 26/08/2026): entra como
      // zero na conta e a tela rotula "(sem imposto)". Tarifa e frete do canal
      // continuam bloqueando — esses são `null` de dado que a Shopee não
      // entregou, e ninguém na tela distingue "não cobraram" de "não sei".
      const lineTax = taxRateKnown ? lineRevenue * taxRate! / 100 : 0;
      const lineProductCost = unitCost == null ? null : unitCost * line.qty;
      const complete = lineFees != null && lineSellerShipping != null;
      const lineResult = complete
        ? calculateContribution({ revenue: lineRevenue, productCost: lineProductCost, marketplaceFees: lineFees, sellerShipping: lineSellerShipping, tax: lineTax })
        : { contribution: null, marginPct: null, complete: false };

      const key = line.sku || line.external_product_id;
      const current = productTotals.get(key)
        ?? { id: line.external_product_id, sku: line.sku, title: line.title, units: 0, revenue: 0, processedRevenue: 0, cost: 0, contribution: 0, calculationsComplete: true };
      current.processedRevenue += lineRevenue;
      current.cost += lineProductCost ?? 0;
      current.contribution += lineResult.contribution ?? 0;
      current.calculationsComplete = current.calculationsComplete && lineResult.complete;
      productTotals.set(key, current);

      profitabilityLines.push({
        id: `${orderId}:${line.external_product_id}:${line.line_no}`,
        orderId,
        product: line.title,
        sku: line.sku,
        date: occurredAt,
        status: order.provider_status,
        fulfillment: order.fulfillment === "platform" ? fulfillmentLabel : null,
        unitPrice: Number(line.unit_price),
        quantity: line.qty,
        revenue: lineRevenue,
        currency: line.currency,
        productCost: lineProductCost,
        marketplaceFees: lineFees,
        buyerShipping: lineBuyerShipping,
        buyerShippingIsRevenue: false,
        sellerShipping: lineSellerShipping,
        netReceived: lineSellerShipping != null && lineFees != null
          ? +(lineRevenue - lineFees - lineSellerShipping).toFixed(2)
          : null,
        tax: lineTax,
        contribution: lineResult.contribution,
        marginPct: lineResult.marginPct,
        complete: lineResult.complete,
      });
    });
  }

  const taxes = taxRateKnown ? processedRevenue * taxRate! / 100 : null;

  const coveredFrom = syncRow.covered_from ? new Date(syncRow.covered_from).getTime() : Number.POSITIVE_INFINITY;
  const coveredTo = syncRow.covered_to ? new Date(syncRow.covered_to).getTime() : 0;
  const periodCovered = coveredFrom <= period.from.getTime()
    && coveredTo + COVERAGE_TOLERANCE_MS >= period.to.getTime()
    && !!syncRow.products_synced_at;
  const cogsKnown = unitsWithoutCost === 0;
  // `taxes` saiu desta lista de propósito: a alíquota é configuração da
  // vendedora, não dado da Shopee. Sem ela o lucro sai SEM imposto (`taxes ?? 0`)
  // e a tela rotula. Tarifa, frete, ads, retenção, estorno e custo continuam
  // aqui — sem eles o número seria otimista sem ninguém saber.
  const financialComplete = periodCovered && ordersProcessed >= totals.paid_orders && cogsKnown
    && [fees, sellerShipping, ads, taxesWithheld, refunds].every((value) => value != null);
  const cogsValue = cogsKnown ? cogs : null;
  const estimatedProfit = financialComplete
    ? processedRevenue - fees! - cogsValue! - (taxes ?? 0) - sellerShipping! - ads! - taxesWithheld! - refunds!
    : null;
  const marginPct = estimatedProfit != null && processedRevenue > 0 ? (estimatedProfit / processedRevenue) * 100 : null;

  const daily = new Map(dailyRows.map((row) => [row.date, { date: row.date, revenue: Number(row.revenue), orders: row.orders, units: row.units }]));
  const dailySales: ShopeeOverview["dailySales"] = [];
  const cursor = new Date(`${brazilDateKey(period.from)}T12:00:00Z`);
  const lastDate = brazilDateKey(period.to);
  while (cursor.toISOString().slice(0, 10) <= lastDate) {
    const date = cursor.toISOString().slice(0, 10);
    dailySales.push(daily.get(date) ?? { date, revenue: 0, orders: 0, units: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const periodDays = Math.max(1, Math.ceil((period.to.getTime() - period.from.getTime()) / 86_400_000));
  const catalog = catalogRows.map((row) => ({
    id: row.external_product_id,
    sku: row.sku,
    title: row.title,
    status: row.status,
    price: Number(row.price),
    availableQuantity: row.available_qty,
    cost: shopeeCostEntry(costs, connection.id, row.external_product_id, row.sku, costNamespace)?.cost ?? null,
  }));

  // ⚠️ Anúncio PAUSADO sem estoque não é ruptura — é anúncio desligado.
  //
  // Antes o radar incluía todo "active ou paused", e como pausado costuma estar
  // zerado, ele virava "out" e entrava na contagem de estoque crítico. Na conta
  // medida em 23/08/2026: 301 produtos alertados, dos quais **294 eram anúncios
  // pausados com estoque zero**. Os 29 anúncios ativos tinham todos estoque
  // positivo — ou seja, o alerta inteiro era ruído e escondia o que importa.
  //
  // A regra passa a ser: anúncio ATIVO sempre entra (zerado nele é ruptura de
  // verdade); anúncio pausado só entra se ainda tem estoque parado, que é a
  // informação útil ("tem mercadoria presa num anúncio desligado").
  const stockRadar = catalog
    .filter((product) => product.status === "active" || (product.status === "paused" && product.availableQuantity > 0))
    .map((product) => {
      const unitsSold = unitsByItem.get(product.id) ?? 0;
      // Sem data de início do anúncio no canônico, o período inteiro é a janela.
      const calculationDays = periodDays;
      const perDay = unitsSold / calculationDays;
      const daysRemaining = perDay > 0 ? Math.floor(product.availableQuantity / perDay) : null;
      // Mesma regra dos outros canais, do mesmo lugar. Aqui havia a terceira
      // cópia da classificação — e com o mesmo defeito do ML: anúncio com
      // estoque e ZERO venda saía como "ok". Ver `classificarCobertura`.
      const status = classificarCobertura({ disponivel: product.availableQuantity, porDia: perDay, diasRestantes: daysRemaining });
      return {
        id: product.id,
        sku: product.sku,
        title: product.title,
        availableQuantity: product.availableQuantity,
        unitsSold,
        calculationDays,
        daysRemaining,
        status,
      };
    })
    .sort((a, b) => {
      const rank = (status: StockStatus) => ORDEM_DO_RADAR[status];
      return rank(a.status) - rank(b.status) || (a.daysRemaining ?? Infinity) - (b.daysRemaining ?? Infinity);
    });

  return {
    account: {
      id: connection.externalAccountId,
      name: connection.displayName ?? `Loja ${connection.externalAccountId}`,
      region: connection.region ?? "BR",
    },
    period: { from: period.from.toISOString(), to: period.to.toISOString(), label: period.label },
    metrics: {
      activeListings: catalog.filter((product) => product.status === "active").length,
      productsWithoutCost: catalog.filter((product) => product.cost == null).length,
      orders30d: totals.total_orders,
      paidOrders: totals.paid_orders,
      revenue30d: revenue,
      cancelledRevenue: Number(totals.cancelled_revenue ?? 0),
      cancelledOrders: totals.cancelled_orders,
      lastSaleAt: totals.last_sale_at ? new Date(totals.last_sale_at).toISOString() : null,
      currency,
      revenueCoverage: { capturedOrders: totals.total_orders, totalOrders: totals.total_orders, complete: periodCovered },
    },
    profit: {
      fees,
      ads,
      taxesWithheld,
      refunds,
      cogs: cogsValue,
      taxes,
      taxRate,
      taxRateKnown,
      sellerShipping,
      buyerShipping,
      feesComplete: periodCovered && allKnown(ordersWithFees),
      revenueProcessed: processedRevenue,
      coverage: { processedOrders: ordersProcessed, paidOrders: totals.paid_orders, complete: financialComplete },
      estimatedProfit,
      marginPct,
      unitsWithoutCost,
    },
    dailySales,
    stockRadar,
    topProducts: [...productTotals.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8)
      .map((product) => {
        const complete = product.calculationsComplete && Math.abs(product.processedRevenue - product.revenue) < 0.01;
        return {
          id: product.id,
          sku: product.sku,
          title: product.title,
          units: product.units,
          revenue: product.revenue,
          cost: product.cost,
          contribution: product.contribution,
          complete,
          marginPct: complete && product.revenue > 0 ? (product.contribution / product.revenue) * 100 : null,
        };
      }),
    profitabilityLines,
    profitabilityPage: {
      limit: detailPage.limit,
      offset: detailPage.offset,
      totalOrders: ordersProcessed,
      returnedOrders: linesByOrder.size,
      hasMore: detailPage.offset + linesByOrder.size < ordersProcessed,
      complete: detailPage.offset === 0 && linesByOrder.size >= ordersProcessed,
    },
    recentOrders: recentRows.map((row) => ({
      id: row.external_order_id,
      status: row.provider_status,
      createdAt: new Date(row.occurred_at).toISOString(),
      total: Number(row.gross),
      currency: row.currency,
      items: row.units,
    })),
  };
}
