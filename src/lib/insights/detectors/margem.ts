import { getAmazonProfitability } from "../../amazonProfitability";
import { periodFromDays } from "../../period";
import type { Detector, InsightCandidate } from "../types";

// Detector de margem comprometida (Amazon). Agrega as linhas CONCILIADAS (receita −
// tarifas reais − custo cadastrado) dos últimos 30 dias por SKU. Sem custo cadastrado
// a linha não é "completa" e fica de fora — nunca inventar margem (regra do projeto).

const TYPE = "margem";
const MARGIN_FLOOR_PCT = 8;
const MIN_REVENUE = 50; // ignora SKUs com receita irrisória no período (ruído)

export const margemDetector: Detector = {
  type: TYPE,
  provider: "amazon",
  async run(): Promise<InsightCandidate[]> {
    const result = await getAmazonProfitability(periodFromDays(30));
    const bySku = new Map<string, { name: string; revenue: number; contribution: number; units: number }>();
    for (const line of result.lines) {
      if (!line.complete || line.contribution == null || !line.sku) continue;
      const agg = bySku.get(line.sku) ?? { name: line.product, revenue: 0, contribution: 0, units: 0 };
      agg.revenue += line.revenue;
      agg.contribution += line.contribution;
      agg.units += line.quantity;
      bySku.set(line.sku, agg);
    }

    const candidates: InsightCandidate[] = [];
    for (const [sku, agg] of bySku) {
      if (agg.revenue < MIN_REVENUE) continue;
      const marginPct = (agg.contribution / agg.revenue) * 100;
      if (marginPct >= MARGIN_FLOOR_PCT) continue;
      const negative = agg.contribution < 0;

      candidates.push({
        id: `${TYPE}:amazon:${sku}`,
        type: TYPE,
        provider: "amazon",
        entityRef: sku,
        severity: negative ? 88 : 65,
        title: agg.name,
        evidence: {
          receita30d: +agg.revenue.toFixed(2),
          contribuicao30d: +agg.contribution.toFixed(2),
          margemPct: +marginPct.toFixed(1),
          unidades: agg.units,
        },
        impact: negative
          ? { prejuizoNoPeriodo: +(-agg.contribution).toFixed(2), premissa: "vendas conciliadas com custo cadastrado (30 dias)" }
          : { margemAbaixoDoPiso: `${marginPct.toFixed(1)}% < ${MARGIN_FLOOR_PCT}%`, premissa: "vendas conciliadas com custo cadastrado (30 dias)" },
        recommendation: negative
          ? `${agg.name} deu prejuízo de R$ ${(-agg.contribution).toFixed(2)} em 30 dias. Revise preço e custo — ou considere pausar.`
          : `Margem de ${agg.name} está em ${marginPct.toFixed(1)}% (abaixo de ${MARGIN_FLOOR_PCT}%). Revise preço, custo ou tarifa.`,
        actionHref: "/amazon/produtos",
      });
    }
    return candidates;
  },
};
