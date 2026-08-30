import { dbQuery, hasDb } from "../db";
import { cacheScope } from "../accountContext";
import { currentWorkspaceId } from "../workspaceScope";
import { currentAccount } from "../accountContext";
import { getIntegrations } from "./integrationStore";
import { getCosts, costAt } from "../costStore";
import { cached } from "../cache";
import { allocateByWeight, calculateContribution, type ProfitabilityLine } from "../profitability";
import { descontarAnuncio } from "../financialMath";
import { anuncioDoCanal } from "../anuncioDoCanal";
import type { Period } from "../period";
import { amazonConnectionId } from "./amazonSync";
import { brazilDateKey } from "./mercadoLivre";

// Overview da Amazon servido pelo modelo canônico (fase 5 da migração,
// docs/canonical-schema.md). Espelha o mercadoLivreOverviewCanonical: agregados
// em SQL sobre workspace_channel_orders/items/fees + linhas magras para o lucro,
// sem payload jsonb. Diferenças da Amazon: sem alíquota de imposto do vendedor
// (tax = 0) e sem frete do vendedor (sellerShipping = null); fulfillment
// platform = FBA / seller = Próprio; custo resolve por sku ?? asin.
//
// Este módulo é apenas leitura. Já serve `/api/order-profitability`, `/api/radar`
// e `/api/top-products` quando o período está coberto. O faturamento headline
// continua vindo do Sales API (orderMetrics) para manter o match ao centavo com
// o Seller Central — `/api/sales` só cai aqui quando não há **nenhuma** conta
// SP-API no workspace, e nesse caso responde `source: "canonical"` para a tela
// poder avisar que o número não é o oficial.
//
// Ler daqui não exige credencial: a chave é workspace + provider + conexão. Por
// isso `resolveConnection` aceita workspace sem conta SP-API ativa (demonstração,
// ou autorização revogada).

const PROVIDER = "amazon";
const DETAILED_ORDER_LIMIT = 1_000;
const REVENUE_STATUSES = ["paid", "shipped", "delivered"];
const COVERAGE_TOLERANCE_MS = 15 * 60_000;

export interface AmazonCanonicalTopProduct {
  sku: string;
  asin: string;
  title: string;
  units: number;
  salePrice: number | null;
  cost: number | null;
  revenue: number;
  marginPct: number | null;
}

export interface AmazonCanonicalOverview {
  sellerId: string;
  connectionId: string;
  currency: string;
  /** Período totalmente coberto pelo sync (senão, quem consome deve cair na SP-API). */
  covered: boolean;
  metrics: {
    totalOrders: number;
    paidOrders: number;
    fbaOrders: number;
    cancelledOrders: number;
    revenue: number; // gross canônico (referência; headline segue no Sales API)
    /**
     * `null` = houve cancelamento mas o valor é DESCONHECIDO, não zero.
     * A Amazon cancela a maioria dos pedidos ainda em `Pending`, e em `Pending`
     * ela não expõe `OrderTotal` — 2.078 das 2.085 canceladas não têm valor.
     * Exibir R$ 0,00 aí afirma "cancelar não custou nada" (AGENTS.md: null ≠ 0).
     */
    cancelledRevenue: number | null;
    /** Quantos dos cancelados tem valor conhecido. Menor que cancelledOrders = soma parcial. */
    cancelledOrdersWithValue: number;
    /** Quantos desses valores sao estimados pelo preco do SKU, nao medidos. */
    cancelledOrdersEstimated: number;
    lastSaleAt: string | null;
  };
  /** Unidades vendidas por SKU no período — insumo da velocidade do radar. */
  velocityBySku: Record<string, number>;
  /** Série diária contínua (dias sem venda zerados) no fuso de São Paulo. */
  dailySales: Array<{ date: string; revenue: number; orders: number; units: number }>;
  topProducts: AmazonCanonicalTopProduct[];
  profit: {
    revenueProcessed: number;
    fees: number;
    cogs: number;
    /**
     * ⚠️ JÁ COM O ANÚNCIO DENTRO (30/08/2026) — ver a fronteira em
     * `financialMath.ts`. Quem exibe não subtrai de novo. `null` quando o gasto
     * com anúncio é desconhecido.
     */
    estimatedProfit: number | null;
    /** Anúncio já descontado acima. `null` = desconhecido; `0` = não gastou. */
    ads: number | null;
    adsDesconhecido: boolean;
    /** Último dia com métrica. Os dias que faltam não são extrapolados. */
    adsAteDia: string | null;
    unitsWithCost: number;
    unitsWithoutCost: number;
    /** SKUs distintos sem custo — a unidade de ACAO da vendedora. */
    skusWithoutCost: number;
    coverage: { processedOrders: number; paidOrders: number; complete: boolean };
  };
  profitabilityLines: ProfitabilityLine[];
  profitabilityScope: { processedOrders: number; completePeriod: boolean };
  recentOrders: Array<{
    amazonOrderId: string;
    purchaseDate: string;
    orderStatus: string;
    /**
     * Ausente = valor ainda desconhecido. É a mesma forma que a SP-API usa: ela
     * omite `OrderTotal` enquanto o pedido está `Pending`. A tela deve dizer
     * "aguardando valor", nunca R$ 0,00 — zero seria afirmar que a venda não teve
     * receita (AGENTS.md: `null` ≠ `0`).
     */
    orderTotal?: { CurrencyCode: string; Amount: string };
  }>;
}

interface SyncMetaRow {
  covered_from: Date | string | null;
  covered_to: Date | string | null;
}

/**
 * Descobre de qual conexão ler. Com conta SP-API no contexto, é a dela. Sem
 * conta — workspace de demonstração, ou leitura fora do fluxo autenticado da
 * Amazon — cai na conexão registrada no workspace: o canônico é chaveado por
 * workspace + provider + connection e não depende de credencial para ser lido.
 */
async function resolveConnection(): Promise<{ sellerId: string; connectionId: string } | null> {
  // `currentAccountId()` devolve a string "default" fora de contexto, então não
  // serve para detectar ausência de conta — só `currentAccount()` distingue.
  const account = currentAccount();
  if (account) return { sellerId: account.sellerId, connectionId: amazonConnectionId(account.sellerId) };

  const connections = (await getIntegrations(PROVIDER)).filter((item) => item.status === "connected");
  const connection = connections[0];
  if (!connection) return null;
  return { sellerId: connection.externalAccountId, connectionId: connection.id };
}

interface TotalsRow {
  total_orders: number;
  paid_orders: number;
  fba_orders: number;
  paid_revenue: string | null;
  cancelled_revenue: string | null;
  cancelled_orders: number;
  cancelled_with_value: number;
  cancelled_estimated: number;
  currency: string | null;
  last_sale_at: Date | string | null;
}

interface VelocityRow { sku: string | null; external_product_id: string; units: number }

interface DailyRow { date: string; revenue: string | null; orders: number; units: number }

interface ProductTotalsRow {
  external_product_id: string;
  sku: string | null;
  title: string;
  units: number;
  revenue: string;
}

interface RecentRow {
  external_order_id: string;
  provider_status: string;
  occurred_at: Date | string;
  /** `null` = valor ainda desconhecido (pedido `Pending`), nunca zero. */
  gross: string | null;
  currency: string;
}

interface DetailedLineRow {
  external_order_id: string;
  occurred_at: Date | string;
  provider_status: string;
  currency: string;
  buyer_shipping: string | null;
  fulfillment: string | null;
  line_no: number;
  external_product_id: string;
  sku: string | null;
  title: string;
  qty: number;
  unit_price: string;
  fees: string | null;
}

function scopeParams(connectionId: string, period: Period): unknown[] {
  return [currentWorkspaceId(), PROVIDER, connectionId, new Date(period.startISO), new Date(period.endISO)];
}

export async function getAmazonOverviewFromCanonical(period: Period): Promise<AmazonCanonicalOverview | null> {
  if (!hasDb()) return null;
  const resolved = await resolveConnection();
  if (!resolved) return null;
  const { sellerId, connectionId } = resolved;
  const workspaceId = currentWorkspaceId();

  const [syncRows, totalsRows] = await Promise.all([
    dbQuery<SyncMetaRow>(
      `SELECT covered_from, covered_to
         FROM workspace_marketplace_syncs
        WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3`,
      [workspaceId, PROVIDER, connectionId]
    ),
    dbQuery<TotalsRow>(
      `SELECT COUNT(*)::int AS total_orders,
              COUNT(*) FILTER (WHERE status = ANY($6::text[]))::int AS paid_orders,
              COUNT(*) FILTER (WHERE status = ANY($6::text[]) AND fulfillment = 'platform')::int AS fba_orders,
              SUM(gross) FILTER (WHERE status = ANY($6::text[])) AS paid_revenue,
              -- COALESCE com ordered_gross: pedido cancelado nunca tem gross,
              -- porque a Amazon zera o OrderTotal ao cancelar. O valor de tabela
              -- capturado antes do cancelamento (migrations/0010) é a única fonte.
              SUM(COALESCE(gross, ordered_gross)) FILTER (WHERE status = 'cancelled') AS cancelled_revenue,
              COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled_orders,
              -- Quantos cancelados tem valor conhecido. Sem esta contagem a tela
              -- soma o que capturou e apresenta como se fosse o total: medido em
              -- 22/08/2026, uma conta tinha 160 cancelados e 1 com valor, e a soma
              -- de R$ 89,70 seria lida como o valor dos 160. AGENTS.md: mostrar o
              -- que foi capturado E dizer que esta parcial.
              COUNT(COALESCE(gross, ordered_gross)) FILTER (WHERE status = 'cancelled')::int AS cancelled_with_value,
              -- Quantos desses valores sao ESTIMADOS (migrations/0011). A tela
              -- precisa dizer: soma com estimativa dentro nao pode se passar por
              -- medicao, e a estimativa erra para baixo (presume 1 unidade).
              COUNT(*) FILTER (WHERE status = 'cancelled' AND ordered_gross_source = 'estimado')::int AS cancelled_estimated,
              MAX(occurred_at) FILTER (WHERE status = ANY($6::text[])) AS last_sale_at,
              MAX(currency) AS currency
         FROM workspace_channel_orders
        WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
          AND occurred_at >= $4 AND occurred_at <= $5`,
      [...scopeParams(connectionId, period), REVENUE_STATUSES]
    ),
  ]);
  const syncRow = syncRows[0];
  const totals = totalsRows[0];
  // Sem sync algum e sem pedidos no período → nada canônico para servir.
  if (!syncRow && (!totals || totals.total_orders === 0)) return null;

  const [velocityRows, productTotalsRows, recentRows, lineRows, costs, dailyRows] = await Promise.all([
    dbQuery<VelocityRow>(
      `SELECT i.sku, i.external_product_id, SUM(i.qty)::int AS units
         FROM workspace_channel_order_items i
         JOIN workspace_channel_orders o
           ON o.workspace_id = i.workspace_id AND o.provider = i.provider
          AND o.connection_id = i.connection_id AND o.external_order_id = i.external_order_id
        WHERE i.workspace_id = $1 AND i.provider = $2 AND i.connection_id = $3
          AND o.occurred_at >= $4 AND o.occurred_at <= $5 AND o.status = ANY($6::text[])
        GROUP BY i.sku, i.external_product_id`,
      [...scopeParams(connectionId, period), REVENUE_STATUSES]
    ),
    dbQuery<ProductTotalsRow>(
      `SELECT i.external_product_id, i.sku, MIN(i.title) AS title,
              SUM(i.qty)::int AS units, SUM(i.qty * i.unit_price) AS revenue
         FROM workspace_channel_order_items i
         JOIN workspace_channel_orders o
           ON o.workspace_id = i.workspace_id AND o.provider = i.provider
          AND o.connection_id = i.connection_id AND o.external_order_id = i.external_order_id
        WHERE i.workspace_id = $1 AND i.provider = $2 AND i.connection_id = $3
          AND o.occurred_at >= $4 AND o.occurred_at <= $5 AND o.status = ANY($6::text[])
        GROUP BY i.external_product_id, i.sku`,
      [...scopeParams(connectionId, period), REVENUE_STATUSES]
    ),
    dbQuery<RecentRow>(
      `SELECT external_order_id, provider_status, occurred_at, gross, currency
         FROM workspace_channel_orders
        WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
          AND occurred_at >= $4 AND occurred_at <= $5
        ORDER BY occurred_at DESC
        LIMIT 10`,
      scopeParams(connectionId, period)
    ),
    dbQuery<DetailedLineRow>(
      `WITH detailed AS (
         SELECT external_order_id, occurred_at, provider_status, currency, buyer_shipping, fulfillment
           FROM workspace_channel_orders
          WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
            AND occurred_at >= $4 AND occurred_at <= $5 AND status = ANY($6::text[])
          ORDER BY occurred_at DESC
          LIMIT $7
       )
       SELECT d.external_order_id, d.occurred_at, d.provider_status, d.currency,
              d.buyer_shipping, d.fulfillment,
              i.line_no, i.external_product_id, i.sku, i.title, i.qty, i.unit_price,
              ff.amount AS fees
         FROM detailed d
         JOIN workspace_channel_order_items i
           ON i.workspace_id = $1 AND i.provider = $2 AND i.connection_id = $3
          AND i.external_order_id = d.external_order_id
         LEFT JOIN LATERAL (
           SELECT SUM(amount) AS amount FROM workspace_channel_order_fees f
            WHERE f.workspace_id = $1 AND f.provider = $2 AND f.connection_id = $3
              AND f.external_order_id = d.external_order_id AND f.fee_type <> 'refund'
         ) ff ON true
        ORDER BY d.occurred_at DESC, d.external_order_id, i.line_no`,
      [...scopeParams(connectionId, period), REVENUE_STATUSES, DETAILED_ORDER_LIMIT]
    ),
    getCosts(),
    dbQuery<DailyRow>(
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
      [...scopeParams(connectionId, period), REVENUE_STATUSES]
    ),
  ]);

  const currency = totals.currency ?? "BRL";

  // Cobertura: o período está dentro da janela já importada pelo sync.
  const coveredFrom = syncRow?.covered_from ? new Date(syncRow.covered_from).getTime() : Number.POSITIVE_INFINITY;
  const coveredTo = syncRow?.covered_to ? new Date(syncRow.covered_to).getTime() : 0;
  const periodCovered =
    coveredFrom <= new Date(period.startISO).getTime() &&
    coveredTo + COVERAGE_TOLERANCE_MS >= new Date(period.endISO).getTime();

  // Série diária contínua, com dias sem venda zerados — mesmo formato do ML e
  // da Shopee, para a central somar as três num gráfico só.
  const daily = new Map(dailyRows.map((row) => [row.date, { date: row.date, revenue: Number(row.revenue ?? 0), orders: row.orders, units: row.units }]));
  const dailySales: Array<{ date: string; revenue: number; orders: number; units: number }> = [];
  const cursor = new Date(`${brazilDateKey(new Date(period.startISO))}T12:00:00Z`);
  const lastDate = brazilDateKey(new Date(period.endISO));
  while (cursor.toISOString().slice(0, 10) <= lastDate) {
    const date = cursor.toISOString().slice(0, 10);
    dailySales.push(daily.get(date) ?? { date, revenue: 0, orders: 0, units: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const velocityBySku: Record<string, number> = {};
  for (const row of velocityRows) {
    const key = row.sku || row.external_product_id;
    velocityBySku[key] = (velocityBySku[key] ?? 0) + row.units;
  }

  const costOf = (sku: string | null, asin: string) => {
    const entry = (sku ? costs[sku] : undefined) ?? costs[asin];
    return entry && entry.cost > 0 ? entry : null;
  };

  // Detalhe por linha: rateia as fees do pedido entre as linhas por peso de
  // receita e resolve o custo por vigência (mesma regra do ML e do builder
  // ao vivo). Amazon não tem imposto do vendedor nem frete do vendedor.
  const linesByOrder = new Map<string, DetailedLineRow[]>();
  for (const row of lineRows) {
    const group = linesByOrder.get(row.external_order_id) ?? [];
    group.push(row);
    linesByOrder.set(row.external_order_id, group);
  }

  let fees = 0;
  let cogs = 0;
  let unitsWithCost = 0;
  let unitsWithoutCost = 0;
  // SKU e a unidade de ACAO da vendedora (ver oQueFaltaNoResultado.ts).
  const skusSemCusto = new Set<string>();
  let processedRevenue = 0;
  const profitabilityLines: ProfitabilityLine[] = [];

  for (const [orderId, lines] of linesByOrder) {
    const head = lines[0];
    const feesKnown = head.fees != null;
    const orderFees = Number(head.fees ?? 0);
    const orderBuyerShipping = head.buyer_shipping == null ? 0 : Number(head.buyer_shipping);
    if (feesKnown) fees += orderFees;

    const weights = lines.map((line) => line.qty * Number(line.unit_price));
    const feeShares = allocateByWeight(orderFees, weights);
    const buyerShares = allocateByWeight(orderBuyerShipping, weights);

    lines.forEach((line, index) => {
      const lineRevenue = line.qty * Number(line.unit_price);
      processedRevenue += lineRevenue;
      const occurredAt = new Date(line.occurred_at).toISOString();
      const entry = costOf(line.sku, line.external_product_id);
      const unitCost = entry ? costAt(entry, occurredAt) : 0;
      const lineProductCost = unitCost > 0 ? unitCost * line.qty : null;
      const lineFees = feesKnown ? feeShares[index] : null;
      const lineBuyerShipping = head.buyer_shipping == null ? null : buyerShares[index];
      const result = calculateContribution({
        revenue: lineRevenue,
        buyerShipping: lineBuyerShipping,
        productCost: lineProductCost,
        marketplaceFees: lineFees,
      });
      if (unitCost > 0) { cogs += unitCost * line.qty; unitsWithCost += line.qty; }
      else { unitsWithoutCost += line.qty; skusSemCusto.add(line.sku ?? line.external_product_id ?? ""); }

      profitabilityLines.push({
        id: `${orderId}:${line.external_product_id}:${line.line_no}`,
        orderId,
        product: line.title,
        sku: line.sku,
        date: occurredAt,
        status: head.provider_status,
        fulfillment: head.fulfillment === "platform" ? "FBA" : head.fulfillment === "seller" ? "Próprio" : null,
        unitPrice: Number(line.unit_price),
        quantity: line.qty,
        revenue: lineRevenue,
        currency: line.currency,
        productCost: lineProductCost,
        marketplaceFees: lineFees,
        buyerShipping: lineBuyerShipping,
        sellerShipping: null,
        tax: null,
        contribution: result.contribution,
        marginPct: result.marginPct,
        complete: result.complete,
      });
    });
  }

  // ⚠️ O ANÚNCIO ENTRA AQUI — fronteira em `financialMath.ts`. O dashboard da
  // Amazon subtraía o anúncio na TELA, em três lugares diferentes; agora o
  // número já sai daqui com ele dentro e a tela só lê.
  //
  // A guarda do extrato não se aplica neste caminho: aqui `fees` vem de
  // `workspace_channel_order_fees`, que é tarifa DE PEDIDO — anúncio nunca é
  // postado por pedido. O caminho que precisa da guarda é `profit.ts`, que lê o
  // extrato inteiro da Transactions API.
  const anuncio = await anuncioDoCanal("amazon", period.startISO, period.endISO);
  const lucro = descontarAnuncio(+(processedRevenue - fees - cogs).toFixed(2), anuncio);
  const estimatedProfit = lucro.estimatedProfit;

  const topProducts: AmazonCanonicalTopProduct[] = productTotalsRows
    .map((row) => {
      const revenue = Number(row.revenue);
      const salePrice = row.units > 0 ? +(revenue / row.units).toFixed(2) : null;
      const entry = costOf(row.sku, row.external_product_id);
      const cost = entry ? entry.cost : null;
      const marginPct = cost != null && salePrice != null && salePrice > 0 ? +((salePrice - cost) / salePrice * 100).toFixed(2) : null;
      return {
        sku: row.sku ?? row.external_product_id,
        asin: row.external_product_id,
        title: row.title,
        units: row.units,
        salePrice,
        cost,
        revenue,
        marginPct,
      };
    })
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  return {
    sellerId,
    connectionId,
    currency,
    covered: periodCovered,
    metrics: {
      totalOrders: totals.total_orders,
      paidOrders: totals.paid_orders,
      fbaOrders: totals.fba_orders,
      cancelledOrders: totals.cancelled_orders,
      cancelledOrdersWithValue: totals.cancelled_with_value,
      cancelledOrdersEstimated: totals.cancelled_estimated,
      revenue: Number(totals.paid_revenue ?? 0),
      // `?? 0` aqui era a violação: SUM() sobre valores nulos devolve NULL, e o
      // zero resultante virava "cancelaram e não custou nada" na tela.
      cancelledRevenue: totals.cancelled_revenue === null ? null : Number(totals.cancelled_revenue),
      lastSaleAt: totals.last_sale_at ? new Date(totals.last_sale_at).toISOString() : null,
    },
    velocityBySku,
    dailySales,
    topProducts,
    profit: {
      revenueProcessed: +processedRevenue.toFixed(2),
      fees: +fees.toFixed(2),
      cogs: +cogs.toFixed(2),
      estimatedProfit,
      ads: lucro.ads,
      adsDesconhecido: lucro.adsDesconhecido,
      adsAteDia: lucro.ateDia,
      unitsWithCost,
      unitsWithoutCost,
      skusWithoutCost: skusSemCusto.size,
      coverage: {
        processedOrders: linesByOrder.size,
        paidOrders: totals.paid_orders,
        complete: periodCovered && linesByOrder.size >= totals.paid_orders,
      },
    },
    profitabilityLines,
    profitabilityScope: {
      processedOrders: linesByOrder.size,
      completePeriod: periodCovered,
    },
    recentOrders: recentRows.map((row) => ({
      amazonOrderId: row.external_order_id,
      purchaseDate: new Date(row.occurred_at).toISOString(),
      orderStatus: row.provider_status,
      // `gross` nulo = valor ainda desconhecido (pedido `Pending`, a Amazon omite
      // `OrderTotal`). Devolver o campo AUSENTE reproduz exatamente o sinal que a
      // própria API manda nesse caso, então quem já sabe lidar com pendente sem
      // total continua funcionando. `String(null)` viraria `"null"` e, adiante,
      // `NaN` na tela.
      orderTotal: row.gross === null ? undefined : { CurrencyCode: row.currency, Amount: String(row.gross) },
    })),
  };
}

// Deduplica a computação canônica entre as rotas do dashboard que a consomem
// no mesmo carregamento (radar + top-products + rentabilidade). Namespaced por
// conta/workspace pelo próprio `cached`.
export function getAmazonOverviewCanonicalCached(period: Period): Promise<AmazonCanonicalOverview | null> {
  return cached(`amazon-overview-canonical:${cacheScope()}:${period.key}`, 60_000, () => getAmazonOverviewFromCanonical(period));
}
