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
  /** Receita TOTAL do período. Fato — não muda com esta frente. */
  revenue: number;
  /** Receita dos pedidos que JÁ têm repasse postado. Base da contribuição. */
  revenueApurada: number;
  /** Receita ainda sem repasse (dinheiro). Existe também para quem tem apurado. */
  receitaSemRepasse: number;
  /** Pedidos ainda sem repasse (contagem), para a frase da tela. */
  pedidosSemRepasse: number;
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
  /** `null` quando a alíquota não foi configurada. */
  taxRate: number | null;
  products: AbcProduct[];
  /** Quanto do período ainda não tem repasse — a faixa do topo da tela. */
  semRepasse: { receita: number; produtos: number; produtosSemClasse: number };
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
  qty_apurada: number;
  revenue_apurada: string;
  pedidos_sem_repasse: number;
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
              bool_and(ofe.fee IS NOT NULL) AS fees_known,
              -- APURADO: só o que tem repasse postado. Idêntico ao gêmeo da
              -- Amazon — a tarifa desconhecida somava ZERO acima enquanto a
              -- receita entrava inteira, inflando a contribuição e a classe.
              SUM(CASE WHEN ofe.fee IS NOT NULL THEN i.qty ELSE 0 END)::int AS qty_apurada,
              SUM(CASE WHEN ofe.fee IS NOT NULL THEN i.qty * i.unit_price ELSE 0 END) AS revenue_apurada,
              COUNT(DISTINCT CASE WHEN ofe.fee IS NULL THEN i.external_order_id END)::int AS pedidos_sem_repasse
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
  interface Acc { productId: string; sku: string | null; title: string; units: number; revenue: number; fees: number; cost: number; feesKnown: boolean; costKnown: boolean; revenueApurada: number; custoApurado: number; pedidosSemRepasse: number }
  const bySku = new Map<string, Acc>();
  for (const row of rows) {
    const key = row.sku || row.external_product_id;
    const acc = bySku.get(key) ?? { productId: row.external_product_id, sku: row.sku, title: row.title, units: 0, revenue: 0, fees: 0, cost: 0, feesKnown: true, costKnown: true, revenueApurada: 0, custoApurado: 0, pedidosSemRepasse: 0 };
    const entry = mercadoLivreCostEntry(costs, connection.id, row.external_product_id, row.sku);
    const unitCost = entry ? costAt(entry, new Date(`${row.day}T12:00:00-03:00`).toISOString()) : 0;
    acc.units += row.qty;
    acc.revenue += Number(row.revenue);
    acc.fees += Number(row.fees);
    if (unitCost > 0) acc.cost += unitCost * row.qty;
    else acc.costKnown = false;
    if (!row.fees_known) acc.feesKnown = false;
    // O custo do APURADO acompanha as unidades apuradas — ver o gêmeo da Amazon.
    acc.revenueApurada += Number(row.revenue_apurada ?? 0);
    if (unitCost > 0) acc.custoApurado += unitCost * Number(row.qty_apurada ?? 0);
    acc.pedidosSemRepasse += Number(row.pedidos_sem_repasse ?? 0);
    bySku.set(key, acc);
  }

  const partial = [...bySku.values()].map((acc) => {
    const costMissing = !acc.costKnown;
    // Sem alíquota o imposto é desconhecido; some da conta em vez de virar zero.
    const tax = taxRate == null ? 0 : acc.revenue * taxRate / 100;
    // ⚠️ CLASSIFICAR PELO APURADO (29/08/2026) — ver o gêmeo da Amazon. O
    // imposto do apurado acompanha a receita apurada, pela mesma razão do custo.
    const semApurado = acc.revenueApurada <= 0;
    const taxApurado = taxRate == null ? 0 : acc.revenueApurada * taxRate / 100;
    // Sem custo cadastrado não há margem confiável — não supomos zero.
    const contribution = costMissing || semApurado
      ? null
      : +(acc.revenueApurada - acc.custoApurado - acc.fees - taxApurado).toFixed(2);
    return {
      productId: acc.productId,
      sku: acc.sku,
      title: acc.title,
      units: acc.units,
      revenue: +acc.revenue.toFixed(2),
      revenueApurada: +acc.revenueApurada.toFixed(2),
      receitaSemRepasse: +(acc.revenue - acc.revenueApurada).toFixed(2),
      pedidosSemRepasse: acc.pedidosSemRepasse,
      cost: +acc.cost.toFixed(2),
      fees: +acc.fees.toFixed(2),
      tax: +tax.toFixed(2),
      contribution,
      // Divide pela APURADA — dividir pela total inverteria o erro em vez de corrigi-lo.
      marginPct: contribution != null && acc.revenueApurada > 0 ? +(contribution / acc.revenueApurada * 100).toFixed(2) : null,
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

  // AGREGADO do período, para a faixa do topo. Sai da soma dos PRÓPRIOS
  // produtos, então nunca discorda das linhas da tabela.
  const semRepasse = {
    receita: +products.reduce((s, p) => s + p.receitaSemRepasse, 0).toFixed(2),
    produtos: products.filter((p) => p.receitaSemRepasse > 0).length,
    produtosSemClasse: products.filter((p) => p.contribution == null).length,
  };
  return { currency: "BRL", covered, taxRate, products, semRepasse };
}

export function getMercadoLivreAbc(connection: IntegrationConnection, period: MercadoLivrePeriod): Promise<MercadoLivreAbc | null> {
  if (!hasDb()) return Promise.resolve(null);
  const key = `ml-abc:${connection.id}:${period.from.getTime()}:${period.to.getTime()}`;
  return cached(key, 5 * 60_000, () => computeAbc(connection, period));
}
