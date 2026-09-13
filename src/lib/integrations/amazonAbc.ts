import { dbQuery, hasDb } from "../db";
import { currentWorkspaceId } from "../workspaceScope";
import { currentAccountId } from "../accountContext";
import { custoNaDataOuNull, getCosts } from "../costStore";
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
  /** Receita TOTAL do período. Fato — não muda com esta frente. */
  revenue: number;
  /** Receita dos pedidos que JÁ têm repasse postado. É a base da contribuição. */
  revenueApurada: number;
  /** Receita ainda sem repasse (dinheiro). Existe também para quem tem apurado. */
  receitaSemRepasse: number;
  /** Pedidos ainda sem repasse (contagem), para a frase da tela. */
  pedidosSemRepasse: number;
  cost: number;
  fees: number;
  tax: number;
  // Nulo quando o custo não está cadastrado OU quando nenhum pedido tem repasse
  // postado — sem custo não supomos margem, e sem repasse não supomos tarifa.
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
  /** Quanto do período ainda não tem repasse — a faixa do topo da tela. */
  semRepasse: { receita: number; produtos: number; produtosSemClasse: number };
}

interface Period { from: Date; to: Date }
interface Row { external_product_id: string; sku: string | null; title: string; day: string; qty: number; revenue: string; fees: string; fees_known: boolean; qty_apurada: number; revenue_apurada: string; pedidos_sem_repasse: number }
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
              bool_and(ofe.fee IS NOT NULL) AS fees_known,
              -- APURADO: só o que tem repasse postado. A tarifa desconhecida
              -- somava ZERO acima enquanto a receita entrava inteira — e era
              -- isso que inflava a contribuição e contaminava a classe A/B/C.
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
    return entry ?? null;
  };

  interface Acc { productId: string; sku: string | null; title: string; units: number; revenue: number; fees: number; cost: number; feesKnown: boolean; costKnown: boolean; revenueApurada: number; custoApurado: number; pedidosSemRepasse: number }
  const bySku = new Map<string, Acc>();
  for (const row of rows) {
    const key = row.sku || row.external_product_id;
    const acc = bySku.get(key) ?? { productId: row.external_product_id, sku: row.sku, title: row.title, units: 0, revenue: 0, fees: 0, cost: 0, feesKnown: true, costKnown: true, revenueApurada: 0, custoApurado: 0, pedidosSemRepasse: 0 };
    const entry = costOf(row.sku, row.external_product_id);
    const unitCost = custoNaDataOuNull(entry, new Date(`${row.day}T12:00:00-03:00`).toISOString());
    acc.units += row.qty;
    acc.revenue += Number(row.revenue);
    acc.fees += Number(row.fees);
    // O custo do APURADO acompanha as unidades apuradas — senão o custo inteiro
    // entraria contra uma receita parcial e a margem sairia para baixo, que é
    // trocar a superestimativa de hoje por uma subestimativa.
    acc.revenueApurada += Number(row.revenue_apurada ?? 0);
    if (unitCost != null) acc.custoApurado += unitCost * Number(row.qty_apurada ?? 0);
    acc.pedidosSemRepasse += Number(row.pedidos_sem_repasse ?? 0);
    if (unitCost != null) acc.cost += unitCost * row.qty;
    else acc.costKnown = false;
    if (!row.fees_known) acc.feesKnown = false;
    bySku.set(key, acc);
  }

  const partial = [...bySku.values()].map((acc) => {
    const costMissing = !acc.costKnown;
    // ⚠️ CLASSIFICAR PELO APURADO (29/08/2026). Antes a contribuição usava a
    // receita TOTAL contra tarifas que valiam ZERO quando não postadas — lucro
    // inflado, e a classe A/B/C sai dele: produto virava "A" por lhe FALTAREM
    // tarifas. Medido em 12 meses: 50 de 71 produtos e 74% da receita afetados,
    // e 18 sem nenhuma tarifa apareciam com margem cheia.
    //
    // Agora a contribuição só olha os pedidos com repasse postado, e é `null`
    // quando nenhum tem. Amazon: sem imposto do vendedor.
    const semApurado = acc.revenueApurada <= 0;
    const contribution = costMissing || semApurado
      ? null
      : +(acc.revenueApurada - acc.custoApurado - acc.fees).toFixed(2);
    return {
      productId: acc.productId, sku: acc.sku, title: acc.title,
      units: acc.units,
      // Receita TOTAL do período: continua sendo fato e não muda.
      revenue: +acc.revenue.toFixed(2),
      // Receita que já tem repasse postado — é a base da contribuição acima.
      revenueApurada: +acc.revenueApurada.toFixed(2),
      // O que ficou de fora, em dinheiro e em pedidos. Existe TAMBÉM para quem
      // tem venda apurada: é o único jeito de a tela dizer que um número verde
      // é PISO, não total.
      receitaSemRepasse: +(acc.revenue - acc.revenueApurada).toFixed(2),
      pedidosSemRepasse: acc.pedidosSemRepasse,
      cost: +acc.cost.toFixed(2),
      fees: +acc.fees.toFixed(2),
      tax: 0,
      contribution,
      // ⚠️ Divide pela receita APURADA, não pela total. Dividir pela total
      // trocaria a superestimativa de hoje por uma subestimativa — o mesmo erro
      // com o sinal invertido.
      marginPct: contribution != null && acc.revenueApurada > 0
        ? +(contribution / acc.revenueApurada * 100).toFixed(2)
        : null,
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

  // AGREGADO do período, para a faixa do topo. Sai da soma dos PRÓPRIOS
  // produtos, então nunca discorda das linhas da tabela.
  const semRepasse = {
    receita: +products.reduce((s, p) => s + p.receitaSemRepasse, 0).toFixed(2),
    produtos: products.filter((p) => p.receitaSemRepasse > 0).length,
    produtosSemClasse: products.filter((p) => p.contribution == null).length,
  };
  return { currency: "BRL", covered, taxRate: 0, products, semRepasse };
}

export function getAmazonAbc(period: Period): Promise<AmazonAbc | null> {
  if (!hasDb()) return Promise.resolve(null);
  const sellerId = currentAccountId() ?? "none";
  const key = `amazon-abc:${sellerId}:${period.from.getTime()}:${period.to.getTime()}`;
  return cached(key, 5 * 60_000, () => computeAbc(period));
}
