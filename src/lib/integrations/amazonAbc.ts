import { dbQuery, hasDb } from "../db";
import { currentWorkspaceId } from "../workspaceScope";
import { currentAccountId } from "../accountContext";
import { getCosts, costAt } from "../costStore";
import { cached } from "../cache";
import { amazonConnectionId } from "./amazonSync";

// Curva ABC por lucro (Amazon), servida pelo modelo canônico — espelha o leitor
// do Mercado Livre (mercadoLivreAbc.ts). Diferenças da Amazon: sem alíquota de
// imposto do vendedor (tax = 0); "fees" = todas as tarifas debitadas do vendedor
// (comissão, FBA, frete etc. — tudo menos estorno); custo resolve por sku ?? asin.
//
// Enquanto o lucro da Amazon não é validado contra o Seller Central (fase 5D), os
// números aqui herdam a mesma cobertura do canônico e podem mudar com o backfill.

const PROVIDER = "amazon";
const REVENUE_STATUSES = ["paid", "shipped", "delivered"];
const COVERAGE_TOLERANCE_MS = 15 * 60_000;

type AbcClass = "A" | "B" | "C";
type AbcQuadrant = "motor" | "vamp" | "joia" | "morto";

interface AbcProduct {
  productId: string;
  sku: string | null;
  title: string;
  units: number;
  revenue: number;
  cost: number;
  fees: number;
  tax: number;
  // Nulo quando o custo não está cadastrado — sem custo não supomos margem.
  contribution: number | null;
  marginPct: number | null;
  costMissing: boolean;
  salesClass: AbcClass;
  profitClass: AbcClass | null;
  quadrant: AbcQuadrant | null;
  complete: boolean;
}
export interface AmazonAbc {
  currency: string;
  covered: boolean;
  taxRate: number;
  products: AbcProduct[];
}

interface Period { from: Date; to: Date }
interface Row { external_product_id: string; sku: string | null; title: string; day: string; qty: number; revenue: string; fees: string; fees_known: boolean }
interface SyncMetaRow { covered_from: Date | string | null; covered_to: Date | string | null }

function classify(entries: Array<{ key: string; value: number }>): Map<string, AbcClass> {
  const sorted = [...entries].sort((a, b) => b.value - a.value);
  const total = sorted.reduce((sum, e) => sum + Math.max(0, e.value), 0) || 1;
  const result = new Map<string, AbcClass>();
  let cumulative = 0;
  for (const e of sorted) {
    if (e.value <= 0) { result.set(e.key, "C"); continue; }
    cumulative += e.value;
    const pct = (cumulative / total) * 100;
    result.set(e.key, pct <= 80 ? "A" : pct <= 95 ? "B" : "C");
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

async function computeAbc(period: Period): Promise<AmazonAbc | null> {
  const sellerId = currentAccountId();
  if (!sellerId) return null;
  const connectionId = amazonConnectionId(sellerId);
  const workspaceId = currentWorkspaceId();
  const scope = [workspaceId, PROVIDER, connectionId, period.from, period.to];

  const [rows, syncRows, costs] = await Promise.all([
    dbQuery<Row>(
      `WITH order_fee AS (
         SELECT external_order_id, SUM(amount) AS fee
           FROM workspace_channel_order_fees
          WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3 AND fee_type <> 'refund'
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
      [...scope, REVENUE_STATUSES]
    ),
    dbQuery<SyncMetaRow>(
      `SELECT covered_from, covered_to FROM workspace_marketplace_syncs
        WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3`,
      [workspaceId, PROVIDER, connectionId]
    ),
    getCosts(),
  ]);

  const costOf = (sku: string | null, asin: string) => {
    const entry = (sku ? costs[sku] : undefined) ?? costs[asin];
    return entry && entry.cost > 0 ? entry : null;
  };

  interface Acc { productId: string; sku: string | null; title: string; units: number; revenue: number; fees: number; cost: number; feesKnown: boolean; costKnown: boolean }
  const bySku = new Map<string, Acc>();
  for (const row of rows) {
    const key = row.sku || row.external_product_id;
    const acc = bySku.get(key) ?? { productId: row.external_product_id, sku: row.sku, title: row.title, units: 0, revenue: 0, fees: 0, cost: 0, feesKnown: true, costKnown: true };
    const entry = costOf(row.sku, row.external_product_id);
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
    // Amazon: sem imposto do vendedor. Sem custo cadastrado, contribuição é nula.
    const contribution = costMissing ? null : +(acc.revenue - acc.cost - acc.fees).toFixed(2);
    return {
      productId: acc.productId, sku: acc.sku, title: acc.title,
      units: acc.units,
      revenue: +acc.revenue.toFixed(2),
      cost: +acc.cost.toFixed(2),
      fees: +acc.fees.toFixed(2),
      tax: 0,
      contribution,
      marginPct: contribution != null && acc.revenue > 0 ? +(contribution / acc.revenue * 100).toFixed(2) : null,
      costMissing,
      complete: acc.feesKnown && acc.costKnown,
      key: acc.sku || acc.productId,
    };
  });

  const profitClass = classify(partial.filter((p) => p.contribution != null).map((p) => ({ key: p.key, value: p.contribution as number })));
  const salesClass = classify(partial.map((p) => ({ key: p.key, value: p.revenue })));

  const products: AbcProduct[] = partial
    .map(({ key, ...p }) => {
      const sc = salesClass.get(key) ?? "C";
      const pc = p.contribution == null ? null : (profitClass.get(key) ?? "C");
      return { ...p, salesClass: sc, profitClass: pc, quadrant: pc == null ? null : quadrantOf(sc, p.marginPct) };
    })
    .sort((a, b) => {
      if ((a.contribution == null) !== (b.contribution == null)) return a.contribution == null ? 1 : -1;
      if (a.contribution != null && b.contribution != null) return b.contribution - a.contribution;
      return b.revenue - a.revenue;
    });

  const syncRow = syncRows[0];
  const coveredFrom = syncRow?.covered_from ? new Date(syncRow.covered_from).getTime() : Number.POSITIVE_INFINITY;
  const coveredTo = syncRow?.covered_to ? new Date(syncRow.covered_to).getTime() : 0;
  const covered = coveredFrom <= period.from.getTime() && coveredTo + COVERAGE_TOLERANCE_MS >= period.to.getTime();

  return { currency: "BRL", covered, taxRate: 0, products };
}

export function getAmazonAbc(period: Period): Promise<AmazonAbc | null> {
  if (!hasDb()) return Promise.resolve(null);
  const sellerId = currentAccountId() ?? "none";
  const key = `amazon-abc:${sellerId}:${period.from.getTime()}:${period.to.getTime()}`;
  return cached(key, 5 * 60_000, () => computeAbc(period));
}
