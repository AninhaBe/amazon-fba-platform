import { getIntegrations } from "../../integrations/integrationStore";
import { getShopeeOverviewFromCanonical } from "../../integrations/shopeeOverviewCanonical";
import type { IntegrationConnection } from "../../integrations/types";
import type { Detector, InsightCandidate } from "../types";

// Detector de ruptura de estoque (Shopee). Reimplementação do princípio da
// Amazon com o canônico da Shopee: lê o stockRadar do overview canônico — a
// MESMA classificação compartilhada (`classificarCobertura`). As quantidades da
// Shopee são agregadas por anúncio (sem variação): o insight fala do anúncio,
// que é o que o canônico realmente tem.

const TYPE = "ruptura";
const PROVIDER = "shopee";
const LEAD_TIME_DAYS = 15; // premissa de reposição para estimar o risco

function shortDate(d: Date) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(d);
}

export function periodo30d() {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 86_400_000);
  return { from, to, label: "Últimos 30 dias" };
}

export async function shopeeConnections(): Promise<IntegrationConnection[]> {
  const all = await getIntegrations("shopee");
  return all.filter((connection) => connection.status === "connected");
}

export const shopeeRupturaDetector: Detector = {
  type: TYPE,
  provider: PROVIDER,
  async run(): Promise<InsightCandidate[]> {
    const candidates: InsightCandidate[] = [];
    for (const connection of await shopeeConnections()) {
      const overview = await getShopeeOverviewFromCanonical(connection, periodo30d()).catch(() => null);
      if (!overview) continue;
      for (const r of overview.stockRadar) {
        if (r.status !== "out" && r.status !== "critical") continue;
        const name = r.title || r.sku || r.id;
        const isOut = r.status === "out";
        const dias = r.daysRemaining ?? 0;
        const perDay = +(r.unitsSold / Math.max(1, r.calculationDays)).toFixed(2);
        const severity = isOut ? 100 : Math.min(99, 60 + Math.max(0, 10 - dias) * 4);
        const reporAte = shortDate(new Date(Date.now() + dias * 86_400_000));

        const recommendation = isOut
          ? `${name} está sem estoque disponível na Shopee. Reponha o quanto antes — cada dia parado é venda perdida.`
          : `${name} rompe em ${dias} dia(s) no ritmo de ${perDay}/dia. Reponha até ${reporAte} para não faltar.`;

        candidates.push({
          // A loja entra no fingerprint: duas lojas Shopee no mesmo workspace
          // podem ter o mesmo anúncio/SKU.
          id: `${TYPE}:${PROVIDER}:${connection.externalAccountId}:${r.id}`,
          type: TYPE,
          provider: PROVIDER,
          entityRef: r.sku ?? r.id,
          severity,
          title: name,
          evidence: {
            disponivel: r.availableQuantity,
            vendasPorDia: perDay,
            diasRestantes: r.daysRemaining,
            vendidosNoPeriodo: r.unitsSold,
          },
          impact: {
            rupturaEmDias: isOut ? 0 : dias,
            unidadesEmRiscoEstimadas: Math.round(perDay * LEAD_TIME_DAYS),
            premissa: `lead time de reposição ~${LEAD_TIME_DAYS} dias; quantidades agregadas por anúncio`,
          },
          recommendation,
          actionHref: "/shopee/estoque",
        });
      }
    }
    return candidates;
  },
};
