import { getSalesVelocity } from "../../orders";
import { getProducts } from "../../products";
import { periodFromDays, periodFromRange } from "../../period";
import type { Detector, InsightCandidate } from "../types";

// Detector de queda de velocidade (Amazon). Compara as unidades vendidas por SKU
// nos últimos 7 dias com os 7 dias anteriores. Queda > 25% com volume mínimo na
// janela anterior (para não disparar em ruído de item de baixo giro).

const TYPE = "velocidade";
const DROP_THRESHOLD = 0.25;
const MIN_PREVIOUS_UNITS = 5;

function ymd(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
}

export const velocidadeDetector: Detector = {
  type: TYPE,
  async run(): Promise<InsightCandidate[]> {
    const [current, previous, products] = await Promise.all([
      getSalesVelocity({ period: periodFromDays(7) }),
      getSalesVelocity({ period: periodFromRange(ymd(14), ymd(8)) }),
      getProducts().catch(() => []),
    ]);
    const titleBySku = new Map(products.map((p) => [p.id, p.title]));

    const candidates: InsightCandidate[] = [];
    for (const [sku, prevUnits] of Object.entries(previous.unitsBySku)) {
      if (prevUnits < MIN_PREVIOUS_UNITS) continue;
      const curUnits = current.unitsBySku[sku] ?? 0;
      const drop = (prevUnits - curUnits) / prevUnits;
      if (drop <= DROP_THRESHOLD) continue;
      const name = titleBySku.get(sku) || sku;
      const dropPct = Math.round(drop * 100);

      candidates.push({
        id: `${TYPE}:amazon:${sku}`,
        type: TYPE,
        provider: "amazon",
        entityRef: sku,
        // Queda maior = mais urgente (62 a ~95).
        severity: Math.min(95, 50 + Math.round(drop * 50)),
        title: name,
        evidence: {
          ultimos7d: curUnits,
          "7dAnteriores": prevUnits,
          quedaPct: dropPct,
        },
        impact: {
          unidadesAMenosPorSemana: prevUnits - curUnits,
          premissa: "comparação 7d vs 7d anteriores; vendas conciliadas por SKU",
        },
        recommendation: `Vendas de ${name} caíram ${dropPct}% na semana (${prevUnits} → ${curUnits} un). Revise preço, posição do anúncio e estoque — algo mudou.`,
        actionHref: "/amazon/monitor",
      });
    }
    return candidates;
  },
};
