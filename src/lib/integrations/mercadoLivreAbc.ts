import { dbQuery, hasDb } from "../db";
import { currentWorkspaceId } from "../workspaceScope";
import { getCosts, costAt } from "../costStore";
import { cached } from "../cache";
import { mercadoLivreCostEntry, mercadoLivreTaxRate, type MercadoLivrePeriod } from "./mercadoLivre";
import type { IntegrationConnection } from "./types";

// Curva ABC por lucro (Mercado Livre). Classifica os produtos do período pela
// contribuição acumulada (A = 80% do lucro, B = +15%, C = últimos 5%) e cruza
// com a classe por faturamento para posicionar cada um num quadrante
// giro × margem. Tudo sobre o período INTEIRO — a alocação da tarifa (que é por
// pedido) para cada SKU é feita em SQL, por peso de receita da linha.

const PROVIDER = "mercado_livre";
const REVENUE_STATUSES = ["paid", "shipped", "delivered"];
const COVERAGE_TOLERANCE_MS = 15 * 60_000;

export type AbcClass = "A" | "B" | "C";
export type AbcQuadrant = "motor" | "vamp" | "joia" | "morto";

export interface AbcProduct {
  productId: string;
  sku: string | null;
  title: string;
  units: number;
  revenue: number;
  cost: number;
  fees: number;
  tax: number;
  // Nulo quando o custo não está cadastrado: sem custo não dá para saber a
  // margem, então não supomos zero — o produto fica "custo pendente".
  contribution: number | null;
  marginPct: number | null;
  costMissing: boolean;
  salesClass: AbcClass;
  profitClass: AbcClass | null;
  quadrant: AbcQuadrant | null;
  complete: boolean; // tarifa e custo conhecidos para todas as vendas do SKU
}

export interface MercadoLivreAbc {
  currency: string;
  covered: boolean;
  taxRate: number;
  products: AbcProduct[];
}

interface Row {
  external_product_id: string;
  sku: string | null;
  title: string;
  day: string;
  qty: number;
  revenue: string;
  fees: string;
  fees_known: boolean;
}
interface SyncMetaRow { covered_from: Date | string | null; covered_to: Date | string | null }

function scopeParams(connectionId: string, period: MercadoLivrePeriod): unknown[] {
  return [currentWorkspaceId(), PROVIDER, connectionId, period.from, period.to];
}

// Ordena desc pela métrica e marca A/B/C pela fração acumulada do total positivo.
function classify(entries: Array<{ key: string; value: number }>): Map<string, AbcClass> {
  const sorted = [...entries].sort((a, b) => b.value - a.value);
  const total = sorted.reduce((sum, entry) => sum + Math.max(0, entry.value), 0) || 1;
  const result = new Map<string, AbcClass>();
  let cumulative = 0;
  for (const entry of sorted) {
    if (entry.value <= 0) { result.set(entry.key, "C"); continue; }
    cumulative += entry.value;
    const pct = (cumulative / total) * 100;
    result.set(entry.key, pct <= 80 ? "A" : pct <= 95 ? "B" : "C");
  }
  return result;
}

// Margem por unidade a partir da qual o produto é viável ("alta margem" no
// quadrante). Abaixo disso a margem é apertada demais e o produto cai em "baixa
// margem" (rever preço). Escala do vendedor: >=18% excelente, >=12% ok, <12% ruim.
const HIGH_MARGIN_PCT = 12;
function quadrantOf(salesClass: AbcClass, marginPct: number | null): AbcQuadrant {
  const highVolume = salesClass !== "C";
  const highMargin = (marginPct ?? 0) >= HIGH_MARGIN_PCT;
  if (highVolume && highMargin) return "motor";
  if (highVolume && !highMargin) return "vamp";
  if (!highVolume && highMargin) return "joia";
  return "morto";
}

async function computeAbc(connection: IntegrationConnection, period: MercadoLivrePeriod): Promise<MercadoLivreAbc> {
  const workspaceId = currentWorkspaceId();
  const taxRate = mercadoLivreTaxRate(connection);

  const [rows, syncRows, costs] = await Promise.all([
    // Por (produto, sku, dia): unidades, receita e a tarifa (comissão + frete do
    // vendedor) do pedido rateada para a linha por peso de receita. O dia serve
    // para resolver o custo por vigência em JS.
    dbQuery<Row>(
      `WITH order_fee AS (
         SELECT external_order_id, SUM(amount) AS fee
           FROM workspace_channel_order_fees
          WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
            AND fee_type IN ('commission', 'shipping_seller')
          GROUP BY external_order_id
       ),
       order_rev AS (
         SELECT external_order_id, SUM(qty * unit_price) AS rev
           FROM workspace_channel_order_items
          WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
          GROUP BY external_order_id
       )
       SELECT i.external_product_id, i.sku, MIN(i.title) AS title,
              to_char(o.occurred_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS day,
              SUM(i.qty)::int AS qty,
              SUM(i.qty * i.unit_price) AS revenue,
              SUM(CASE WHEN orv.rev > 0 AND ofe.fee IS NOT NULL
                       THEN ofe.fee * (i.qty * i.unit_price) / orv.rev ELSE 0 END) AS fees,
              bool_and(ofe.fee IS NOT NULL) AS fees_known
         FROM workspace_channel_order_items i
         JOIN workspace_channel_orders o
           ON o.workspace_id = i.workspace_id AND o.provider = i.provider
          AND o.connection_id = i.connection_id AND o.external_order_id = i.external_order_id
         LEFT JOIN order_fee ofe ON ofe.external_order_id = i.external_order_id
         LEFT JOIN order_rev orv ON orv.external_order_id = i.external_order_id
        WHERE i.workspace_id = $1 AND i.provider = $2 AND i.connection_id = $3
          AND o.occurred_at >= $4 AND o.occurred_at <= $5 AND o.status = ANY($6::text[])
        GROUP BY i.external_product_id, i.sku, day`,
      [...scopeParams(connection.id, period), REVENUE_STATUSES]
    ),
    dbQuery<SyncMetaRow>(
      `SELECT covered_from, covered_to FROM workspace_marketplace_syncs
        WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3`,
      [workspaceId, PROVIDER, connection.id]
    ),
    getCosts(),
  ]);

  // Acumula por SKU, resolvendo o custo por vigência a cada dia.
  interface Acc { productId: string; sku: string | null; title: string; units: number; revenue: number; fees: number; cost: number; feesKnown: boolean; costKnown: boolean }
  const bySku = new Map<string, Acc>();
  for (const row of rows) {
    const key = row.sku || row.external_product_id;
    const acc = bySku.get(key) ?? { productId: row.external_product_id, sku: row.sku, title: row.title, units: 0, revenue: 0, fees: 0, cost: 0, feesKnown: true, costKnown: true };
    const entry = mercadoLivreCostEntry(costs, connection.id, row.external_product_id, row.sku);
    const unitCost = entry ? costAt(entry, new Date(`${row.day}T12:00:00-03:00`).toISOString()) : 0;
    acc.units += row.qty;
    acc.revenue += Number(row.revenue);
    acc.fees += Number(row.fees);
    if (unitCost > 0) acc.cost += unitCost * row.qty;
    else acc.costKnown = false;
    if (!row.fees_known) acc.feesKnown = false;
    bySku.set(key, acc);
  }

  const partial = [...bySku.values()].map((acc) => {
    const costMissing = !acc.costKnown;
    const tax = acc.revenue * taxRate / 100;
    // Sem custo cadastrado não há margem confiável — não supomos zero.
    const contribution = costMissing ? null : +(acc.revenue - acc.cost - acc.fees - tax).toFixed(2);
    return {
      productId: acc.productId,
      sku: acc.sku,
      title: acc.title,
      units: acc.units,
      revenue: +acc.revenue.toFixed(2),
      cost: +acc.cost.toFixed(2),
      fees: +acc.fees.toFixed(2),
      tax: +tax.toFixed(2),
      contribution,
      marginPct: contribution != null && acc.revenue > 0 ? +(contribution / acc.revenue * 100).toFixed(2) : null,
      costMissing,
      complete: acc.feesKnown && acc.costKnown,
      key: acc.sku || acc.productId,
    };
  });

  // A classificação por lucro só considera produtos com custo cadastrado.
  const profitClass = classify(partial.filter((p) => p.contribution != null).map((p) => ({ key: p.key, value: p.contribution as number })));
  const salesClass = classify(partial.map((p) => ({ key: p.key, value: p.revenue })));

  const products: AbcProduct[] = partial
    .map(({ key, ...p }) => {
      const sc = salesClass.get(key) ?? "C";
      const pc = p.contribution == null ? null : (profitClass.get(key) ?? "C");
      return { ...p, salesClass: sc, profitClass: pc, quadrant: pc == null ? null : quadrantOf(sc, p.marginPct) };
    })
    .sort((a, b) => {
      // Com custo primeiro (por contribuição desc); sem custo ao fim (por receita).
      if ((a.contribution == null) !== (b.contribution == null)) return a.contribution == null ? 1 : -1;
      if (a.contribution != null && b.contribution != null) return b.contribution - a.contribution;
      return b.revenue - a.revenue;
    });

  const syncRow = syncRows[0];
  const coveredFrom = syncRow?.covered_from ? new Date(syncRow.covered_from).getTime() : Number.POSITIVE_INFINITY;
  const coveredTo = syncRow?.covered_to ? new Date(syncRow.covered_to).getTime() : 0;
  const covered = coveredFrom <= period.from.getTime() && coveredTo + COVERAGE_TOLERANCE_MS >= period.to.getTime();

  return { currency: "BRL", covered, taxRate, products };
}

export function getMercadoLivreAbc(connection: IntegrationConnection, period: MercadoLivrePeriod): Promise<MercadoLivreAbc | null> {
  if (!hasDb()) return Promise.resolve(null);
  const key = `ml-abc:${connection.id}:${period.from.getTime()}:${period.to.getTime()}`;
  return cached(key, 5 * 60_000, () => computeAbc(connection, period));
}
