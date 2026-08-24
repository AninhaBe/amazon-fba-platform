import { dbQuery, hasDb } from "../db";
import { currentWorkspaceId } from "../workspaceScope";
import { getCosts, costAt } from "../costStore";
import { allocateByWeight, calculateContribution, type ProfitabilityLine } from "../profitability";
import {
  brazilDateKey,
  getMercadoLivreOverview,
  mercadoLivreCostEntry,
  mercadoLivreTaxRate,
  type MercadoLivrePeriod,
  type MercadoLivreProduct,
} from "./mercadoLivre";
import { classificarCobertura, ORDEM_DO_RADAR, type StockStatus } from "../coberturaDeEstoque";
import type { IntegrationConnection } from "./types";

// Overview do Mercado Livre servido pelo modelo canônico (fase 4 da migração,
// docs/canonical-schema.md): agregados em SQL sobre colunas indexadas + linhas
// magras para o cálculo de lucro — nenhum payload jsonb sai do banco. Espelha
// a semântica do getMercadoLivreOverview (rateio por receita, custo por
// vigência, cobertura sem extrapolar); o tipo de retorno idêntico é garantido
// pelo compilador.

const PROVIDER = "mercado_livre";
const DETAILED_ORDER_LIMIT = 1_000;
// Conciliado / receita real: SÓ vendas aprovadas (ADR-020).
const REVENUE_STATUSES = ["paid", "shipped", "delivered"];
// BRUTO: "Vendas brutas" do painel do ML = aprovadas + canceladas, só produto
// (sem frete). Confirmado ao centavo contra o Mercado Livre e o Mercado Turbo.
//
// ⚠️ Incluir canceladas aqui é DE PROPÓSITO e não é inconsistência com o
// conciliado: são duas perguntas diferentes (ADR-020). O bruto existe para a
// pessoa conferir contra o painel do marketplace, que é a visão que ela conhece;
// o conciliado é a que o marketplace não dá. Canceladas seguem exibidas à parte.
const GROSS_STATUSES = ["paid", "shipped", "delivered", "cancelled"];
const COVERAGE_TOLERANCE_MS = 15 * 60_000;

export type MercadoLivreOverview = Awaited<ReturnType<typeof getMercadoLivreOverview>>;

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
  approved_revenue: string | null;
  cancelled_revenue: string | null;
  cancelled_orders: number;
  pending_orders: number;
  pending_revenue: string | null;
  currency: string | null;
  last_sale_at: Date | string | null;
}

interface DailyRow { date: string; revenue: string; orders: number; units: number }

// Agregado financeiro do período INTEIRO (sem o corte de detalhe): é o que
// alimenta o bloco "Do faturamento à margem". Antes ele saía do mesmo laço das
// linhas detalhadas e herdava o teto de 1000 pedidos, o que subestimava o
// resultado em contas grandes.
interface AggRow {
  orders_processed: number;
  processed_revenue: string | null;
  buyer_shipping: string | null;
  fees: string | null;
  seller_shipping: string | null;
  orders_with_shipping: number;
}

// Unidades por produto e por dia — granularidade suficiente para resolver o
// custo por vigência em JS sobre todas as vendas do período.
interface CogsRow {
  external_product_id: string;
  sku: string | null;
  occurred_at: Date | string;
  qty: number;
}

interface RecentRow {
  external_order_id: string;
  pack_id: string | null;
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
}

function scopeParams(connectionId: string, period: MercadoLivrePeriod): unknown[] {
  return [currentWorkspaceId(), PROVIDER, connectionId, period.from, period.to];
}

export async function getMercadoLivreOverviewFromCanonical(
  connection: IntegrationConnection,
  period: MercadoLivrePeriod
): Promise<MercadoLivreOverview | null> {
  if (!hasDb()) return null;
  const workspaceId = currentWorkspaceId();

  const [syncRows, totalsRows] = await Promise.all([
    dbQuery<SyncMetaRow>(
      `SELECT covered_from, covered_to, products_synced_at, products_total, active_products, products_complete
         FROM workspace_marketplace_syncs
        WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3`,
      [workspaceId, PROVIDER, connection.id]
    ),
    dbQuery<TotalsRow>(
      `SELECT COUNT(*)::int AS total_orders,
              COUNT(*) FILTER (WHERE status = ANY($6::text[]))::int AS paid_orders,
              -- Faturamento = "Vendas brutas" do painel do ML = aprovadas +
              -- canceladas, só produto (sem frete).
              SUM(gross) FILTER (WHERE status = ANY($7::text[])) AS paid_revenue,
              SUM(gross) FILTER (WHERE status = ANY($6::text[])) AS approved_revenue,
              SUM(gross) FILTER (WHERE status = 'cancelled') AS cancelled_revenue,
              COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled_orders,
              -- AGUARDANDO PAGAMENTO = o que não é aprovado nem cancelado.
              -- Definido por exclusão de propósito: o ML cria status novo sem
              -- avisar, e uma lista fixa faria o pedido novo sumir da legenda em
              -- vez de aparecer como pendente.
              COUNT(*) FILTER (WHERE status <> ALL($6::text[]) AND status <> 'cancelled')::int AS pending_orders,
              SUM(gross) FILTER (WHERE status <> ALL($6::text[]) AND status <> 'cancelled') AS pending_revenue,
              MAX(occurred_at) FILTER (WHERE status = ANY($6::text[])) AS last_sale_at,
              MAX(currency) AS currency
         FROM workspace_channel_orders
        WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
          AND occurred_at >= $4 AND occurred_at <= $5`,
      [...scopeParams(connection.id, period), REVENUE_STATUSES, GROSS_STATUSES]
    ),
  ]);
  const syncRow = syncRows[0];
  const totals = totalsRows[0];
  if (!syncRow || (!syncRow.products_synced_at && totals.total_orders === 0)) return null;

  const [dailyRows, recentRows, productTotalsRows, lineRows, productRows, costs, aggRows, cogsRows] = await Promise.all([
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
      [...scopeParams(connection.id, period), GROSS_STATUSES]
    ),
    dbQuery<RecentRow>(
      `SELECT o.external_order_id, o.pack_id, o.provider_status, o.occurred_at, o.gross, o.currency,
              COALESCE((SELECT SUM(i.qty)::int FROM workspace_channel_order_items i
                         WHERE i.workspace_id = o.workspace_id AND i.provider = o.provider
                           AND i.connection_id = o.connection_id AND i.external_order_id = o.external_order_id), 0) AS units
         FROM workspace_channel_orders o
        WHERE o.workspace_id = $1 AND o.provider = $2 AND o.connection_id = $3
          AND o.occurred_at >= $4 AND o.occurred_at <= $5
        ORDER BY o.occurred_at DESC
        LIMIT 10`,
      scopeParams(connection.id, period)
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
      [...scopeParams(connection.id, period), REVENUE_STATUSES]
    ),
    dbQuery<DetailedLineRow>(
      `WITH detailed AS (
         SELECT external_order_id, occurred_at, provider_status, currency, gross, buyer_shipping, fulfillment
           FROM workspace_channel_orders
          WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
            AND occurred_at >= $4 AND occurred_at <= $5 AND status = ANY($6::text[])
          ORDER BY occurred_at DESC
          LIMIT $7
       )
       SELECT d.external_order_id, d.occurred_at, d.provider_status, d.currency, d.gross,
              d.buyer_shipping, d.fulfillment,
              i.line_no, i.external_product_id, i.sku, i.title, i.qty, i.unit_price,
              fc.amount AS commission, fs.amount AS seller_shipping
         FROM detailed d
         JOIN workspace_channel_order_items i
           ON i.workspace_id = $1 AND i.provider = $2 AND i.connection_id = $3
          AND i.external_order_id = d.external_order_id
         LEFT JOIN LATERAL (
           SELECT SUM(amount) AS amount FROM workspace_channel_order_fees f
            WHERE f.workspace_id = $1 AND f.provider = $2 AND f.connection_id = $3
              AND f.external_order_id = d.external_order_id AND f.fee_type = 'commission'
         ) fc ON true
         LEFT JOIN LATERAL (
           SELECT SUM(amount) AS amount FROM workspace_channel_order_fees f
            WHERE f.workspace_id = $1 AND f.provider = $2 AND f.connection_id = $3
              AND f.external_order_id = d.external_order_id AND f.fee_type = 'shipping_seller'
         ) fs ON true
        ORDER BY d.occurred_at DESC, d.external_order_id, i.line_no`,
      [...scopeParams(connection.id, period), REVENUE_STATUSES, DETAILED_ORDER_LIMIT]
    ),
    dbQuery<{ payload: MercadoLivreProduct }>(
      `SELECT payload FROM workspace_marketplace_products
        WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
        ORDER BY synced_at DESC`,
      [workspaceId, PROVIDER, connection.id]
    ),
    getCosts(),
    // Agregado sobre TODOS os pedidos do período (não só os 1000 detalhados).
    dbQuery<AggRow>(
      `WITH scoped AS (
         SELECT o.gross, o.buyer_shipping,
                EXISTS (SELECT 1 FROM workspace_channel_order_items i
                         WHERE i.workspace_id = o.workspace_id AND i.provider = o.provider
                           AND i.connection_id = o.connection_id AND i.external_order_id = o.external_order_id) AS has_items,
                (SELECT SUM(f.amount) FROM workspace_channel_order_fees f
                  WHERE f.workspace_id = o.workspace_id AND f.provider = o.provider
                    AND f.connection_id = o.connection_id AND f.external_order_id = o.external_order_id
                    AND f.fee_type = 'commission') AS commission,
                (SELECT SUM(f.amount) FROM workspace_channel_order_fees f
                  WHERE f.workspace_id = o.workspace_id AND f.provider = o.provider
                    AND f.connection_id = o.connection_id AND f.external_order_id = o.external_order_id
                    AND f.fee_type = 'shipping_seller') AS seller_shipping
           FROM workspace_channel_orders o
          WHERE o.workspace_id = $1 AND o.provider = $2 AND o.connection_id = $3
            AND o.occurred_at >= $4 AND o.occurred_at <= $5 AND o.status = ANY($6::text[])
       )
       -- Tudo restrito aos pedidos com itens conciliados: é o conjunto para o
       -- qual sabemos receita, tarifa E custo. Incluir tarifa de pedido sem
       -- custo conhecido distorceria a margem nos dois sentidos.
       SELECT COUNT(*) FILTER (WHERE has_items)::int AS orders_processed,
              SUM(gross) FILTER (WHERE has_items) AS processed_revenue,
              SUM(buyer_shipping) FILTER (WHERE has_items) AS buyer_shipping,
              SUM(commission) FILTER (WHERE has_items) AS fees,
              SUM(seller_shipping) FILTER (WHERE has_items) AS seller_shipping,
              COUNT(*) FILTER (WHERE has_items AND seller_shipping IS NOT NULL)::int AS orders_with_shipping
         FROM scoped`,
      [...scopeParams(connection.id, period), REVENUE_STATUSES]
    ),
    // Unidades por produto/dia para o custo por vigência em todo o período.
    dbQuery<CogsRow>(
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
      [...scopeParams(connection.id, period), REVENUE_STATUSES]
    ),
  ]);

  const taxRate = mercadoLivreTaxRate(connection);
  const currency = totals.currency ?? "BRL";
  const revenue = Number(totals.paid_revenue ?? 0);

  // Produtos ainda vêm da tabela legada (payload pequeno, tem activeSince);
  // o peso da migração estava nos pedidos.
  const products = productRows.map((row) => row.payload);
  for (const product of products) {
    const entry = mercadoLivreCostEntry(costs, connection.id, product.id, product.sku);
    product.cost = entry?.cost && entry.cost > 0 ? entry.cost : null;
  }

  // Totais por produto (todas as vendas do período, sem o corte de detalhe).
  const productTotals = new Map<string, { id: string; sku: string | null; title: string; units: number; revenue: number; processedRevenue: number; cost: number; contribution: number; calculationsComplete: boolean }>();
  const unitsByItem = new Map<string, number>();
  for (const row of productTotalsRows) {
    const key = row.sku || row.external_product_id;
    const current = productTotals.get(key) ?? { id: row.external_product_id, sku: row.sku, title: row.title, units: 0, revenue: 0, processedRevenue: 0, cost: 0, contribution: 0, calculationsComplete: true };
    current.units += row.units;
    current.revenue += Number(row.revenue);
    productTotals.set(key, current);
    unitsByItem.set(row.external_product_id, (unitsByItem.get(row.external_product_id) ?? 0) + row.units);
  }

  // Detalhe por linha: rateia comissão/frete do pedido pelas linhas por peso
  // de receita (mesma regra do overview antigo) e resolve custo por vigência.
  const linesByOrder = new Map<string, DetailedLineRow[]>();
  for (const row of lineRows) {
    const group = linesByOrder.get(row.external_order_id) ?? [];
    group.push(row);
    linesByOrder.set(row.external_order_id, group);
  }

  // Agregado financeiro do período inteiro, vindo do SQL — não depende mais do
  // teto de DETAILED_ORDER_LIMIT, que só limita a lista detalhada abaixo.
  const agg = aggRows[0];
  const fees = Number(agg?.fees ?? 0);
  const sellerShipping = +Number(agg?.seller_shipping ?? 0).toFixed(2);
  const buyerShipping = +Number(agg?.buyer_shipping ?? 0).toFixed(2);
  const processedRevenue = Number(agg?.processed_revenue ?? 0);
  const ordersProcessed = agg?.orders_processed ?? 0;
  const ordersWithShippingKnown = agg?.orders_with_shipping ?? 0;

  // Custo das mercadorias por vigência, sobre TODAS as vendas do período.
  let cogs = 0;
  let unitsWithoutCost = 0;
  for (const row of cogsRows) {
    const entry = mercadoLivreCostEntry(costs, connection.id, row.external_product_id, row.sku);
    const unitCost = entry ? costAt(entry, new Date(row.occurred_at).toISOString()) : 0;
    if (unitCost > 0) cogs += unitCost * row.qty;
    else unitsWithoutCost += row.qty;
  }

  const profitabilityLines: ProfitabilityLine[] = [];

  for (const [orderId, lines] of linesByOrder) {
    const order = lines[0];
    const commissionKnown = order.commission != null;
    const shippingKnown = order.seller_shipping != null;
    const orderCommission = Number(order.commission ?? 0);
    const orderSellerShipping = Number(order.seller_shipping ?? 0);
    const orderBuyerShipping = order.buyer_shipping == null ? null : Number(order.buyer_shipping);

    const weights = lines.map((line) => line.qty * Number(line.unit_price));
    const commissionShares = allocateByWeight(orderCommission, weights);
    const sellerShares = allocateByWeight(orderSellerShipping, weights);
    const buyerShares = allocateByWeight(orderBuyerShipping ?? 0, weights);

    lines.forEach((line, index) => {
      const lineRevenue = line.qty * Number(line.unit_price);
      const entry = mercadoLivreCostEntry(costs, connection.id, line.external_product_id, line.sku);
      const occurredAt = new Date(line.occurred_at).toISOString();
      const unitCost = entry ? costAt(entry, occurredAt) : 0;
      const lineFees = commissionKnown ? commissionShares[index] : null;
      const lineSellerShipping = shippingKnown ? sellerShares[index] : null;
      const lineBuyerShipping = orderBuyerShipping == null ? null : buyerShares[index];
      // Mesmo contrato do caminho legado: sem alíquota, imposto é desconhecido.
      const lineTax = taxRate == null ? null : lineRevenue * taxRate / 100;
      const lineProductCost = unitCost > 0 ? unitCost * line.qty : null;
      const complete = lineFees != null && lineSellerShipping != null;
      const lineResult = complete
        ? calculateContribution({ revenue: lineRevenue, productCost: lineProductCost, marketplaceFees: lineFees, sellerShipping: lineSellerShipping, tax: lineTax })
        : { contribution: null, marginPct: null, complete: false };
      const key = line.sku || line.external_product_id;
      const current = productTotals.get(key) ?? { id: line.external_product_id, sku: line.sku, title: line.title, units: 0, revenue: 0, processedRevenue: 0, cost: 0, contribution: 0, calculationsComplete: true };
      current.processedRevenue += lineRevenue;
      current.cost += unitCost * line.qty;
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
        fulfillment: order.fulfillment === "platform" ? "Full" : null,
        unitPrice: Number(line.unit_price),
        quantity: line.qty,
        revenue: lineRevenue,
        currency: line.currency,
        productCost: lineProductCost,
        marketplaceFees: lineFees,
        buyerShipping: lineBuyerShipping,
        buyerShippingIsRevenue: false,
        sellerShipping: lineSellerShipping,
        netReceived: lineSellerShipping != null && lineFees != null ? +(lineRevenue - lineFees - lineSellerShipping).toFixed(2) : null,
        tax: lineTax,
        contribution: lineResult.contribution,
        marginPct: lineResult.marginPct,
        complete: lineResult.complete,
      });
    });
  }

  const taxes = taxRate == null ? null : processedRevenue * taxRate / 100;
  // `taxes ?? 0`: sem alíquota o lucro sai sem imposto, exatamente como saía
  // antes. Quem avisa é a tela — mudar o número aqui seria alterar o resultado
  // exibido sem a vendedora ter pedido.
  const estimatedProfit = processedRevenue - fees - cogs - (taxes ?? 0) - sellerShipping;

  // Cobertura: mesmo critério do loadMercadoLivreSource.
  const coveredFrom = syncRow.covered_from ? new Date(syncRow.covered_from).getTime() : Number.POSITIVE_INFINITY;
  const coveredTo = syncRow.covered_to ? new Date(syncRow.covered_to).getTime() : 0;
  const periodCovered = coveredFrom <= period.from.getTime()
    && coveredTo + COVERAGE_TOLERANCE_MS >= period.to.getTime()
    && !!syncRow.products_synced_at;

  // Série diária contínua, com dias sem venda zerados.
  const daily = new Map(dailyRows.map((row) => [row.date, { date: row.date, revenue: Number(row.revenue), orders: row.orders, units: row.units }]));
  const dailySales: Array<{ date: string; revenue: number; orders: number; units: number }> = [];
  const cursor = new Date(`${brazilDateKey(period.from)}T12:00:00Z`);
  const lastDate = brazilDateKey(period.to);
  while (cursor.toISOString().slice(0, 10) <= lastDate) {
    const date = cursor.toISOString().slice(0, 10);
    dailySales.push(daily.get(date) ?? { date, revenue: 0, orders: 0, units: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const periodDays = Math.max(1, Math.ceil((period.to.getTime() - period.from.getTime()) / 86_400_000));
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
  const stockRadar = products
    .filter((product) => product.status === "active" || (product.status === "paused" && product.availableQuantity > 0))
    .map((product) => {
    const unitsSold = unitsByItem.get(product.id) ?? 0;
    const listingStart = product.activeSince ? new Date(product.activeSince).getTime() : Number.NaN;
    const effectiveStart = Number.isFinite(listingStart) ? Math.max(period.from.getTime(), listingStart) : period.from.getTime();
    const calculationDays = Math.max(1, Math.min(periodDays, Math.ceil((period.to.getTime() - effectiveStart) / 86_400_000)));
    const perDay = unitsSold / calculationDays;
    const daysRemaining = perDay > 0 ? Math.floor(product.availableQuantity / perDay) : null;
    // Mesma regra da Amazon, do mesmo lugar (`src/lib/radar.ts`). Antes havia uma
    // cópia de três status aqui, e nela anúncio com estoque e ZERO venda saía
    // como "Saudável" — ver `classificarCobertura`.
    const status = classificarCobertura({ disponivel: product.availableQuantity, porDia: perDay, diasRestantes: daysRemaining });
    // A foto já vinha no payload do anúncio e nunca chegava à tela: quem olha
    // ruptura reconhece o produto pela imagem antes de ler o SKU.
    return { id: product.id, sku: product.sku, title: product.title, thumbnail: product.thumbnail, availableQuantity: product.availableQuantity, unitsSold, calculationDays, daysRemaining, status };
  }).sort((a, b) => {
    const rank = (status: StockStatus) => ORDEM_DO_RADAR[status];
    return rank(a.status) - rank(b.status) || (a.daysRemaining ?? Infinity) - (b.daysRemaining ?? Infinity);
  });

  return {
    account: {
      id: connection.externalAccountId,
      nickname: String(connection.metadata.nickname ?? connection.displayName ?? "Mercado Livre"),
      siteId: String(connection.metadata.siteId ?? connection.region ?? "MLB"),
    },
    period: { from: period.from.toISOString(), to: period.to.toISOString(), label: period.label ?? "Últimos 30 dias" },
    metrics: {
      activeListings: syncRow.active_products,
      productsWithoutCost: products.filter((product) => product.cost == null || product.cost <= 0).length,
      orders30d: totals.total_orders,
      paidOrders: totals.paid_orders,
      revenue30d: revenue,
      approvedRevenue: Number(totals.approved_revenue ?? 0),
      cancelledRevenue: Number(totals.cancelled_revenue ?? 0),
      cancelledOrders: totals.cancelled_orders,
      pendingOrders: totals.pending_orders,
      pendingRevenue: totals.pending_revenue == null ? null : Number(totals.pending_revenue),
      lastSaleAt: totals.last_sale_at ? new Date(totals.last_sale_at).toISOString() : null,
      currency,
      // ⚠️ `capturedOrders` e `totalOrders` são o MESMO valor, e sempre foram —
      // por isso a tela comparava um número com ele mesmo e caía numa mensagem
      // que sugeria pedido faltando. Cobertura aqui NÃO é sobre contagem de
      // pedidos: é sobre a JANELA que o sync já importou. Quem diz isso são as
      // datas, e é o que a tela precisa mostrar.
      revenueCoverage: {
        capturedOrders: totals.total_orders,
        totalOrders: totals.total_orders,
        complete: periodCovered,
        sincronizadoAte: syncRow?.covered_to ? new Date(syncRow.covered_to).toISOString() : null,
        historicoDesde: syncRow?.covered_from ? new Date(syncRow.covered_from).toISOString() : null,
      },
    },
    profit: {
      fees,
      cogs,
      taxes,
      taxRate,
      sellerShipping,
      buyerShipping,
      shippingCostsComplete: periodCovered && ordersWithShippingKnown >= ordersProcessed,
      revenueProcessed: processedRevenue,
      coverage: { processedOrders: ordersProcessed, paidOrders: totals.paid_orders, complete: periodCovered && ordersProcessed >= totals.paid_orders },
      estimatedProfit,
      marginPct: processedRevenue > 0 ? estimatedProfit / processedRevenue * 100 : 0,
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
          marginPct: complete && product.revenue > 0 ? product.contribution / product.revenue * 100 : null,
        };
      }),
    profitabilityLines,
    recentOrders: recentRows.map((row) => ({
      id: row.external_order_id,
      packId: row.pack_id,
      status: row.provider_status,
      createdAt: new Date(row.occurred_at).toISOString(),
      total: Number(row.gross),
      currency: row.currency,
      items: row.units,
    })),
  };
}
