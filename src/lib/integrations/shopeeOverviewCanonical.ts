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
  /** O FATURAMENTO: todo pedido não cancelado, pelo valor do próprio pedido. */
  faturamento: string | null;
  pedidos_faturados: number;
  /** Pedidos que a Shopee ainda não valorizou. Ficam FORA da base, nunca valem zero. */
  sem_valor: number;
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
  /** `null` = a fonte nao informou. Ver ADR-033. */
  available_qty: number | null;
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
  // ⚠️ A varredura de resgate fica DENTRO do sub-namespace `sku:`.
  //
  // Antes ela aceitava qualquer entrada da mesma conexão, inclusive uma de
  // `item:` (custo do ANÚNCIO) que carregasse o campo `sku`. Hoje isso não
  // dispara — custo de anúncio sem SKU é gravado sem o campo —, mas está a uma
  // linha de distância, e essa linha anularia a decisão do ADR-029: o custo do
  // anúncio seria HERDADO por uma variação sem ninguém confirmar, que é
  // exatamente o que "sugestão a confirmar" existe para impedir.
  //
  // Decisão que depende de ninguém escrever uma linha não é decisão, é sorte.
  return Object.values(costs).find(
    (entry) => entry.sku === sku && entry.id.startsWith(`${namespace}:${connectionId}:sku:`)
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
  /**
   * Pedidos com NF-e pendente AGORA (sem recorte de período — pendência
   * operacional). `motivo` é o `pending_reason` cru da Shopee; null quando ela
   * não mandou (o campo só vem em pronto-para-enviar) — nunca inventado.
   */
  notasPendentes: { pedidos: number; motivos: Array<{ motivo: string | null; pedidos: number }> };
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
    /** Fatias do widget, todas no universo da receita paga. O lucro e o residuo. */
    composicaoDaReceitaPaga: {
      receita: number; fees: number | null; sellerShipping: number | null;
      ads: number | null; taxesWithheld: number | null; refunds: number | null;
      cogs: number | null; taxes: number | null; lucro: number | null;
    };
    coverage: {
      processedOrders: number;
      paidOrders: number;
      /**
       * Pedidos do período com tarifa da Shopee JÁ registrada.
       *
       * ⚠️ Existe porque a tela subtraía `paidOrders - processedOrders` para
       * dizer quantas vendas faltavam — e "processado" quer dizer que o pedido
       * entrou no canônico, NÃO que a tarifa dele chegou. Os dois eram 9.849 na
       * loja real, a conta dava zero, e a tela caía numa frase sem número.
       * Números certos, subtração respondendo pergunta que ninguém fez.
       */
      ordersWithFees: number;
      complete: boolean;
    };
    estimatedProfit: number | null;
    /**
     * A receita que o lucro cobre. Quando menor que o faturamento do período, a
     * tela DECLARA a diferença no card — nunca em tooltip, e nunca em silêncio.
     */
    revenueDoLucro: number;
    /** Pedidos pagos ainda sem tarifa apurada — o que falta, com número. */
    pedidosSemApuracao: number;
    marginPct: number | null;
    unitsWithoutCost: number;
    /** SKUs distintos sem custo — a unidade de ACAO da vendedora. */
    skusWithoutCost: number;
  };
  dailySales: Array<{ date: string; revenue: number; orders: number; units: number }>;
  topProducts: Array<{
    id: string; sku: string | null; title: string; units: number; revenue: number;
    cost: number; contribution: number; complete: boolean; marginPct: number | null;
  }>;
  stockRadar: Array<{
    id: string; sku: string | null; title: string; availableQuantity: number | null;
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
  /**
   * Busca do monitor (E3, 28/08/2026): filtra a LISTA detalhada por pedido,
   * SKU ou título, no servidor — busca só na página carregada seria mentira
   * com paginação de servidor. Vazio = sem filtro (comportamento original);
   * não afeta agregados, cards nem o dashboard.
   */
  detailQuery?: string;
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
  const detailQuery = (options.detailQuery ?? "").trim();
  if (detailQuery.length > 120) throw new RangeError("Busca do detalhe muito longa.");

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
              -- O FATURAMENTO: todo pedido nao cancelado, pelo valor do proprio
              -- pedido. E a base de lucro, margem e imposto desde 01/09/2026 —
              -- a mesma regra que a Amazon ja segue. Ver a nota em faturamento.
              SUM(gross) FILTER (WHERE status <> 'cancelled') AS faturamento,
              COUNT(*) FILTER (WHERE status <> 'cancelled')::int AS pedidos_faturados,
              COUNT(*) FILTER (WHERE status <> 'cancelled' AND gross IS NULL)::int AS sem_valor,
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

  const [dailyRows, recentRows, productTotalsRows, lineRows, catalogRows, costs, aggRows, cogsRows, invoiceRows] =
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
              -- Busca do monitor (E3): pedido, SKU ou título, no servidor.
              AND ($9 = '' OR external_order_id ILIKE '%'||$9||'%' OR EXISTS (
                    SELECT 1 FROM workspace_channel_order_items qi
                     WHERE qi.workspace_id = workspace_channel_orders.workspace_id
                       AND qi.provider = workspace_channel_orders.provider
                       AND qi.connection_id = workspace_channel_orders.connection_id
                       AND qi.external_order_id = workspace_channel_orders.external_order_id
                       AND (qi.sku ILIKE '%'||$9||'%' OR qi.title ILIKE '%'||$9||'%')))
            ORDER BY occurred_at DESC
            LIMIT $7 OFFSET $8
         )
         SELECT d.external_order_id, d.occurred_at, d.provider_status, d.currency, d.gross,
                d.buyer_shipping, d.fulfillment, d.financial_settled, d.fees_known, d.shipping_known,
                d.ads_known, d.taxes_withheld_known, d.refunds_known,
                i.line_no, i.external_product_id, i.sku, i.title, i.qty, i.unit_price,
                fees.commission, fees.seller_shipping, fees.ads,
                fees.taxes_withheld, fees.refunds
           FROM detailed d
           JOIN workspace_channel_order_items i
             ON i.workspace_id = $1 AND i.provider = $2 AND i.connection_id = $3
            AND i.external_order_id = d.external_order_id
           -- UM LATERAL, NÃO CINCO (28/08/2026, reclamação de lentidão da Ana).
           --
           -- Eram cinco varreduras da tabela de tarifas por pedido — uma por
           -- tipo. SUM(...) FILTER (WHERE ...) lê a mesma fatia UMA vez e
           -- separa por tipo em memória. Medido na loja real: 953ms → 52ms na
           -- janela de 30 dias (18×), e 9,1s → 528ms na de um ano.
           --
           -- ⚠️ EQUIVALÊNCIA PROVADA ANTES DA TROCA, porque isto calcula
           -- DINHEIRO: 300 pedidos que TÊM tarifa, 1.500 comparações, 659
           -- valores reais (comissão, frete, ads, estorno) — zero divergência,
           -- e os 841 nulos continuaram nulos. SUM sobre zero linhas é NULL nas
           -- duas formas: "não sei" não vira "R$ 0,00".
           LEFT JOIN LATERAL (
             SELECT SUM(amount) FILTER (WHERE fee_type IN ('commission', 'payment'))        AS commission,
                    SUM(amount) FILTER (WHERE fee_type IN ('shipping_seller', 'fulfillment')) AS seller_shipping,
                    SUM(amount) FILTER (WHERE fee_type = 'ads')                             AS ads,
                    SUM(amount) FILTER (WHERE fee_type = 'taxes_withheld')                  AS taxes_withheld,
                    SUM(amount) FILTER (WHERE fee_type = 'refund')                          AS refunds
               FROM workspace_channel_order_fees f
              WHERE f.workspace_id = $1 AND f.provider = $2 AND f.connection_id = $3
                AND f.external_order_id = d.external_order_id
           ) fees ON true
          ORDER BY d.occurred_at DESC, d.external_order_id, i.line_no`,
        [...scopeParams(workspaceId, connection.id, period, provider), REVENUE, detailPage.limit, detailPage.offset, detailQuery]
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
      // NF-e pendente AGORA — pendência operacional, não métrica: de propósito
      // SEM filtro de período (nota travada trava o envio hoje, não importa o
      // recorte da tela). O motivo é o texto cru da Shopee quando ela o manda;
      // ausente vira null, nunca texto inventado. Só pedidos vivos ('paid'):
      // cancelado/entregue não tem envio a destravar.
      query<{ motivo: string | null; pedidos: number }>(
        `SELECT NULLIF(TRIM(raw #>> '{invoice_data,pending_reason}'), '') AS motivo,
                COUNT(*)::int AS pedidos
           FROM workspace_channel_orders
          WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
            AND status = 'paid'
            AND raw #>> '{invoice_data,status}' = 'pending'
          GROUP BY 1
          ORDER BY pedidos DESC`,
        [workspaceId, provider, connection.id]
      ),
    ]);

  const taxRate = configuredTaxRate;
  const currency = totals.currency ?? "BRL";
  // ═══ A BASE É O FATURAMENTO, E SÓ ELE (01/09/2026) ═════════════════════════
  //
  // A mesma decisão que a Amazon aplicou em 31/08, nas palavras dela: *"TEM QUE
  // ESQUECER O APURADO E LEVAR EM CONSIDERAÇÃO SOMENTE O FATURAMENTO."* A Shopee
  // era o terceiro canal a dividir por `processedRevenue` — a receita já
  // conciliada — enquanto o card ao lado exibia outro número.
  //
  // ⚠️ E O QUE FALTA NÃO ENCOLHE A BASE. Pedido sem custo cadastrado ou sem
  // tarifa postada continua DENTRO do faturamento; a tela o aponta com número
  // (regra dela de 29/08). Encolher a base para "proteger" o número é
  // exatamente o que ela mandou parar de fazer.
  const faturamento = Number(totals.faturamento ?? 0);
  const pedidosFaturados = totals.pedidos_faturados ?? 0;
  const pedidosSemValor = totals.sem_valor ?? 0;

  // Com busca ativa, o universo da paginação é o conjunto FILTRADO — hasMore
  // contra o total sem filtro afirmaria uma próxima página que não existe.
  let universoDetalhe: number | null = null;
  if (detailQuery) {
    const [contagem] = await query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM workspace_channel_orders
        WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
          AND occurred_at >= $4 AND occurred_at <= $5 AND status = ANY($6::text[])
          AND EXISTS (SELECT 1 FROM workspace_channel_order_items di
                       WHERE di.workspace_id = workspace_channel_orders.workspace_id
                         AND di.provider = workspace_channel_orders.provider
                         AND di.connection_id = workspace_channel_orders.connection_id
                         AND di.external_order_id = workspace_channel_orders.external_order_id)
          AND (external_order_id ILIKE '%'||$7||'%' OR EXISTS (
                SELECT 1 FROM workspace_channel_order_items qi
                 WHERE qi.workspace_id = workspace_channel_orders.workspace_id
                   AND qi.provider = workspace_channel_orders.provider
                   AND qi.connection_id = workspace_channel_orders.connection_id
                   AND qi.external_order_id = workspace_channel_orders.external_order_id
                   AND (qi.sku ILIKE '%'||$7||'%' OR qi.title ILIKE '%'||$7||'%')))`,
      [...scopeParams(workspaceId, connection.id, period, provider), REVENUE, detailQuery]
    );
    universoDetalhe = contagem?.total ?? 0;
  }

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
  let unitsWithCost = 0;
  // Produtos que VENDERAM no período e não têm custo. É o que a vendedora pode
  // resolver para mudar o número da tela — ver `productsWithoutCost` adiante.
  const vendidosSemCusto = new Set<string>();
  // SKU e a unidade de ACAO: ela cadastra custo por SKU, nao por unidade
  // vendida. Medido em 30/08/2026 na UTILEIRA: 3 unidades sem custo eram 2 SKUs
  // (um vendido duas vezes) — a tela pedia 3 cadastros para um trabalho de 2.
  const skusSemCusto = new Set<string>();
  for (const row of cogsRows) {
    const entry = shopeeCostEntry(costs, connection.id, row.external_product_id, row.sku, costNamespace);
    if (entry) {
      cogs += costAt(entry, new Date(row.occurred_at).toISOString()) * row.qty;
      unitsWithCost += row.qty;
    } else {
      unitsWithoutCost += row.qty;
      vendidosSemCusto.add(row.external_product_id ?? row.sku ?? "");
      skusSemCusto.add(row.sku ?? row.external_product_id ?? "");
    }
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

  /**
   * ⚠️ O IMPOSTO INCIDE SOBRE A MESMA BASE DO LUCRO (01/09/2026).
   *
   * Ele incidia sobre `processedRevenue` enquanto o lucro partia do
   * FATURAMENTO — numerador de um universo, subtracao de outro. E a SEGUNDA
   * forma da familia, a mesma que a Amazon teve em 31/08, e chegou aqui por
   * REPLICACAO INCOMPLETA: quando a base do lucro passou a ser o faturamento,
   * o numerador se moveu e o imposto ficou.
   *
   * Achado pela vendedora em 01/09/2026, no Shopee: ela somou os tres cards da
   * tela (15.734,08 - 4.306,24 - 7.020,48 = 4.407,36) e o lucro exibido era
   * 4.266,39. A diferenca de R$ 140,97 era o imposto — e o imposto estava
   * calculado sobre R$ 14.097,09 (pagos + enviados) em vez de R$ 15.734,08
   * (com os pendentes), subestimado em ~R$ 16,37.
   *
   * 📌 A regra, que vale para TODO componente do lucro: quem subtrai tem de
   * cobrir o mesmo universo de quem soma. Se a base mudar de novo, ESTE calculo
   * muda junto — e e por isso que os dois leem a mesma variavel, em vez de duas
   * variaveis que por acaso coincidem hoje.
   */
  const taxes = taxRateKnown ? faturamento * taxRate! / 100 : null;

  const coveredFrom = syncRow.covered_from ? new Date(syncRow.covered_from).getTime() : Number.POSITIVE_INFINITY;
  const coveredTo = syncRow.covered_to ? new Date(syncRow.covered_to).getTime() : 0;
  const periodCovered = coveredFrom <= period.from.getTime()
    && coveredTo + COVERAGE_TOLERANCE_MS >= period.to.getTime()
    && !!syncRow.products_synced_at;
  // `taxes` saiu desta lista de propósito: a alíquota é configuração da
  // vendedora, não dado da Shopee. Sem ela o lucro sai SEM imposto (`taxes ?? 0`)
  // e a tela rotula. Tarifa, frete, ads, retenção, estorno e custo continuam
  // aqui — sem eles o número seria otimista sem ninguém saber.
  // ⚠️ `cogsKnown` SAIU DAQUI em 30/08/2026, por decisao da vendedora.
  //
  // Palavras dela: *"as 3 unidades sem custo — ISSO NAO PODE EXISTIR. Tem que
  // mostrar a margem independente de se tem algo nao cadastrado. [...] Voce nao
  // precisa tomar essa responsabilidade de entregar dados errados. O erro e do
  // seller que nao cadastrou o custo."*
  //
  // A pendencia de custo virou SINAL, nao trava: lucro e margem passam a sair
  // com o que se sabe, e `skusWithoutCost` viaja no payload para a tela mostrar
  // o sinal COLADO no numero. Quem esconde numero decide pela dona do negocio o
  // que ela pode ver — e ela decidiu o contrario.
  //
  // ⚠️ `financialComplete` continua sendo COBERTURA FINANCEIRA e nao "tudo
  // pronto": ele ainda exige os cinco componentes da Shopee. E o que a tela usa
  // para dizer se o numero ainda muda SOZINHO, que e a outra causa e tem outra
  // frase.
  const financialComplete = periodCovered && ordersProcessed >= totals.paid_orders
    && [fees, sellerShipping, ads, taxesWithheld, refunds].every((value) => value != null);
  // ⚠️ A SOMA DO QUE SE SABE NÃO É DESCONHECIDA.
  //
  // Aqui morava `cogsKnown ? cogs : null`: duas unidades sem custo entre 210
  // faziam a tela devolver travessão no custo INTEIRO — e `cogs` já estava
  // somado na linha de cima, com as outras 208. O número existia e era jogado
  // fora.
  //
  // `null` é desconhecido; a soma de 208 unidades com custo cadastrado é FATO —
  // dinheiro que ela gastou e que a gente sabe. Esconder fato para não arriscar
  // um total incompleto é o tudo-ou-nada, não a regra da casa: a regra manda
  // NOMEAR o que falta com número e link (`unitsWithoutCost` faz isso), não
  // sumir com o que se tem. Relatado pela Ana em 29/08/2026, depois de cadastrar
  // os custos e a tela continuar sem calcular nada.
  //
  // ⚠️ ATÉ 30/08/2026 LUCRO E MARGEM ESPERAVAM AQUI, e não esperam mais — a
  // vendedora reverteu essa decisão. O custo continua sendo soma de fatos; o que
  // mudou é que a lacuna virou SINAL ao lado do número em vez de motivo para
  // escondê-lo. Ver `financialComplete` acima e `skusWithoutCost` no payload.
  //
  // ⚠️ E se NENHUMA unidade tem custo, aí sim é `null`. "R$ 0,00" com zero
  // unidades conhecidas não é a soma do que se sabe — é um número que parece
  // dizer "não custou nada". Somar fato é honesto; exibir vazio como zero é o
  // erro que a regra da casa proíbe desde sempre.
  const cogsValue = unitsWithCost > 0 || unitsWithoutCost === 0 ? cogs : null;
  // `cogsValue ?? 0`: com NENHUMA unidade custeada o custo e desconhecido (null)
  // e o lucro sai sem ele — maior que a verdade, e por isso o sinal ao lado nao
  // e opcional. Ver `skusWithoutCost` no payload.
  // ⚠️ COBERTURA INCOMPLETA DEIXA DE ANULAR O LUCRO (31/08/2026).
  //
  // Até aqui `financialComplete` era condição para EXISTIR lucro, e ele exige
  // que todos os pedidos pagos tenham sido processados. Na conta real isso dava
  // travessão com 9.027 de 9.877 vendas com tarifa: 91% do período apurado, e a
  // tela mostrava nada.
  //
  // É o mesmo tudo-ou-nada que a vendedora já derrubou duas vezes — no custo em
  // 29/08 (*"não precisa mostrar que é parcial... se tem venda e não tem custo,
  // fica apontado lá"*) e no faturamento da Amazon em 31/08 (*"o lucro tem que
  // ser em cima do Faturamento"*). A Shopee foi o canal que ficou para trás.
  //
  // ⚠️ E A BASE VAI DECLARADA, senão troco travessão por número que não fecha
  // com o card ao lado: `revenueDoLucro` é a receita dos pedidos que compõem o
  // resultado, e `ordersAwaitingCapture` diz quantos faltam. A tela cola isso no
  // número — sem a palavra "parcial", que explica o que ela já sabe em vez de
  // dizer o que falta.
  //
  // O que continua anulando: os cinco componentes da Shopee serem desconhecidos.
  // `fees == null` não é "não cobraram", é "não sei quanto" — e aí o lucro seria
  // otimista. Ausência de componente ≠ ausência de cobertura.
  const componentesConhecidos = [fees, sellerShipping, ads, taxesWithheld, refunds].every((v) => v != null);
  // ⚠️ A BASE TROCOU DE `processedRevenue` PARA `faturamento` (01/09/2026), e o
  // numerador e o denominador trocam JUNTOS. Trocar só o denominador daria
  // resultado de um universo dividido pela receita de outro — foi assim que a
  // Amazon exibiu −90,5% e +120,9% no mesmo dia, e é o defeito que esta réplica
  // existe para não repetir aqui.
  /**
   * A COMPOSIÇÃO DA RECEITA PAGA — o universo do widget "Repasses, taxas e
   * lucro", que é OUTRO e precisa ser coerente consigo mesmo.
   *
   * ⚠️ O DEFEITO QUE ISTO CONSERTA, achado pela vendedora em 01/09/2026: o
   * widget exibia no centro a **receita paga** (R$ 14.097,09, pagos e enviados)
   * e as fatias somavam R$ 15.734,08 — o universo TOTAL, com os pendentes. O
   * selo dizia "Composição completa" enquanto a composição **estourava o todo em
   * R$ 1.636,99**, que é exatamente o valor dos pendentes.
   *
   * As fatias de canal (tarifa, frete, anúncio, imposto retido, estorno) e o
   * custo já vinham do universo certo — todas nascem do mesmo `scoped`, filtrado
   * por `status = ANY(REVENUE_STATUSES)`. Os dois intrusos eram:
   *  - o LUCRO, que é `estimatedProfit`, calculado sobre o faturamento;
   *  - e o IMPOSTO, que passou a incidir sobre o faturamento no mesmo dia, para
   *    os CARDS. O conserto de um universo não pode contaminar o outro.
   *
   * 📌 Por isso o lucro daqui é o RESÍDUO deste universo, e não o lucro do
   * período: `receita paga − custo − tarifas − imposto − …`. Os dois números
   * coexistem porque cada um é coerente consigo e diz de qual base fala — o
   * defeito da família nunca foi *qual* base, foi MISTURAR.
   */
  const impostoDaReceitaPaga = taxRateKnown ? +(processedRevenue * taxRate! / 100).toFixed(2) : null;
  const componentesDaReceitaPaga = [fees, sellerShipping, ads, taxesWithheld, refunds];
  const lucroDaReceitaPaga = componentesDaReceitaPaga.every((v) => v != null)
    ? +(processedRevenue
        - fees! - sellerShipping! - ads! - taxesWithheld! - refunds!
        - (cogsValue ?? 0) - (impostoDaReceitaPaga ?? 0)).toFixed(2)
    : null;
  const composicaoDaReceitaPaga = {
    receita: processedRevenue,
    fees, sellerShipping, ads, taxesWithheld, refunds,
    cogs: cogsValue,
    taxes: impostoDaReceitaPaga,
    lucro: lucroDaReceitaPaga,
  };

  const estimatedProfit = componentesConhecidos
    ? +(faturamento - fees! - (cogsValue ?? 0) - (taxes ?? 0) - sellerShipping! - ads! - taxesWithheld! - refunds!).toFixed(2)
    : null;
  const marginPct = estimatedProfit != null && faturamento > 0 ? (estimatedProfit / faturamento) * 100 : null;

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
    // ⚠️ `!= null &&` explícito, nunca `?? 0` (ADR-033): estoque desconhecido não
    // pode virar zero para caber numa comparação. Anúncio pausado com estoque
    // DESCONHECIDO fica fora do radar — não dá para dizer que tem mercadoria
    // presa sem saber se tem.
    .filter((product) => product.status === "active"
      || (product.status === "paused" && product.availableQuantity != null && product.availableQuantity > 0))
    .map((product) => {
      const unitsSold = unitsByItem.get(product.id) ?? 0;
      // Sem data de início do anúncio no canônico, o período inteiro é a janela.
      const calculationDays = periodDays;
      const perDay = unitsSold / calculationDays;
      // Sem estoque conhecido não há previsão possível — e `null` aqui já é o
      // vocabulário existente para "não dá para prever".
      const daysRemaining = perDay > 0 && product.availableQuantity != null
        ? Math.floor(product.availableQuantity / perDay)
        : null;
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
      // ⚠️ CONTA QUEM VENDEU, NÃO O CATÁLOGO INTEIRO.
      //
      // Era `catalog.filter(cost == null)` — todos os produtos da loja, sem
      // filtro de venda, de período ou de status. Na UTILEIRA isso dava **680**
      // (catálogo de 747) quando os produtos com venda em 30 dias eram **123**.
      // A Ana cadastrou os que venderam e a tela continuou pedindo 680: ação que
      // não cabe numa tarde não é ação, é parede — e ainda faz parecer que o
      // trabalho dela não serviu de nada.
      productsWithoutCost: vendidosSemCusto.size,
      orders30d: totals.total_orders,
      // ⚠️ O NÚMERO AO LADO DO FATURAMENTO CONTA O MESMO CONJUNTO QUE ELE.
      //
      // Era `paid_orders` — só os pagos — ao lado de um valor que agora soma
      // todos os não cancelados. Card dizendo "R$ X · N pedidos" com o X de um
      // conjunto e o N de outro é a mesma família da base misturada, só que na
      // contagem: aparece quando alguém confere somando à mão, que é
      // exatamente o que a vendedora faz.
      //
      // A cobertura do lucro (`profit.coverage.paidOrders`, abaixo) CONTINUA
      // contando os pagos: lá a pergunta é "quantos já foram apurados", e essa
      // é outra pergunta.
      paidOrders: pedidosFaturados,
      // ⚠️ O CARD DE FATURAMENTO PASSA A EXIBIR O FATURAMENTO (01/09/2026).
      //
      // Era `paid_revenue` — só os pedidos já pagos —, e por isso ele e o lucro
      // discordavam por construção. Agora é o mesmo número da base: todo pedido
      // não cancelado, pendente inclusive. É a decisão dela de 30/08 ("Faturamento
      // deve significar todos os pedidos independente de status Confirmado"),
      // que a Amazon já seguia e a Shopee não.
      //
      // `paid_revenue` continua vivo em `revenue` para a cascata do conciliado,
      // que é pergunta diferente — e que o marketplace não responde.
      revenue30d: faturamento,
      cancelledRevenue: Number(totals.cancelled_revenue ?? 0),
      cancelledOrders: totals.cancelled_orders,
      lastSaleAt: totals.last_sale_at ? new Date(totals.last_sale_at).toISOString() : null,
      currency,
      revenueCoverage: { capturedOrders: totals.total_orders, totalOrders: totals.total_orders, complete: periodCovered },
    },
    notasPendentes: {
      pedidos: invoiceRows.reduce((total, row) => total + row.pedidos, 0),
      motivos: invoiceRows.map((row) => ({ motivo: row.motivo, pedidos: row.pedidos })),
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
      /**
       * A composicao do widget "Repasses, taxas e lucro", coerente NO UNIVERSO
       * DA RECEITA PAGA. Ver a nota longa em `composicaoDaReceitaPaga`: o widget
       * nao pode misturar estas fatias com o lucro do periodo, que parte do
       * faturamento e inclui pendente.
       */
      composicaoDaReceitaPaga,
      coverage: {
        processedOrders: ordersProcessed,
        paidOrders: totals.paid_orders,
        ordersWithFees,
        complete: financialComplete,
      },
      estimatedProfit,
      // A BASE que lucro, margem e imposto usam — o faturamento, e é o mesmo
      // número do card ao lado. Como as duas passam a coincidir, a declaração
      // de base some sozinha da tela: `declaracaoDeBase` devolve `null` quando
      // o faturamento exibido não é maior que a base.
      revenueDoLucro: +faturamento.toFixed(2),
      // ⚠️ O QUE FALTA, COM NÚMERO — e ele mede outra coisa desde 01/09/2026.
      // Era "pagos menos processados" (cobertura de apuração). Como a base
      // passou a ser o faturamento, o que interessa é quantos pedidos DELA a
      // Shopee ainda não valorizou: esses ficam fora da soma e é isso que a
      // tela precisa apontar. Somá-los como zero afirmaria "vendeu e não
      // faturou" (`null` ≠ `0`).
      pedidosSemApuracao: pedidosSemValor,
      marginPct,
      unitsWithoutCost,
      skusWithoutCost: skusSemCusto.size,
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
      totalOrders: universoDetalhe ?? ordersProcessed,
      returnedOrders: linesByOrder.size,
      hasMore: detailPage.offset + linesByOrder.size < (universoDetalhe ?? ordersProcessed),
      complete: detailPage.offset === 0 && linesByOrder.size >= (universoDetalhe ?? ordersProcessed),
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
