import { getStockRadar } from "../../radar";
import { periodFromDays } from "../../period";
import type { Detector, InsightCandidate } from "../types";

// Detector de ruptura de estoque (Amazon FBA). Lê o radar (estoque × velocidade) e
// levanta os itens que já romperam ou rompem dentro do lead time de reposição.

const TYPE = "ruptura";
const LEAD_TIME_DAYS = 15; // premissa de reposição para estimar o risco

function shortDate(d: Date) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(d);
}

export const rupturaDetector: Detector = {
  type: TYPE,
  async run(): Promise<InsightCandidate[]> {
    const radar = await getStockRadar(periodFromDays(30));
    const candidates: InsightCandidate[] = [];

    for (const r of radar) {
      if (r.status !== "out" && r.status !== "critical") continue;
      const name = r.productName || r.sellerSku;
      const isOut = r.status === "out";
      const dias = r.daysRemaining ?? 0;
      // Fora de estoque = severidade máxima; crítico cresce conforme os dias caem.
      const severity = isOut ? 100 : Math.min(99, 60 + Math.max(0, 10 - dias) * 4);
      const reporAte = shortDate(new Date(Date.now() + dias * 86_400_000));

      const recommendation = isOut
        ? `${name} está sem estoque disponível. Reponha o quanto antes — cada dia parado é venda perdida.`
        : `${name} rompe em ${dias} dia(s) no ritmo de ${r.perDay}/dia. Reponha até ${reporAte} para não faltar.`;

      candidates.push({
        id: `${TYPE}:amazon:${r.sellerSku}`,
        type: TYPE,
        provider: "amazon",
        entityRef: r.sellerSku,
        severity,
        title: name,
        evidence: {
          disponivel: r.fulfillable,
          aCaminho: r.inbound,
          vendasPorDia: r.perDay,
          diasRestantes: r.daysRemaining,
          vendidosNoPeriodo: r.unitsSold,
        },
        impact: {
          rupturaEmDias: isOut ? 0 : dias,
          unidadesEmRiscoEstimadas: Math.round(r.perDay * LEAD_TIME_DAYS),
          premissa: `lead time de reposição ~${LEAD_TIME_DAYS} dias`,
        },
        recommendation,
        actionHref: "/estoque",
      });
    }

    return candidates;
  },
};
