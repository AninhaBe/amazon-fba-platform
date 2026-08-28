import { getIntegrations } from "../../integrations/integrationStore";
import { getMercadoLivreOverviewFromCanonical } from "../../integrations/mercadoLivreOverviewCanonical";
import type { IntegrationConnection } from "../../integrations/types";
import type { Detector, InsightCandidate } from "../types";

// Detector de ruptura de estoque (Mercado Livre). Reimplementação do princípio
// do detector da Amazon com o canônico do ML: lê o stockRadar do overview
// canônico — a MESMA classificação compartilhada (`classificarCobertura`) que a
// tela do radar usa — e levanta os anúncios que já romperam ou rompem em breve.

const TYPE = "ruptura";
const PROVIDER = "mercado_livre";
const LEAD_TIME_DAYS = 15; // premissa de reposição para estimar o risco

function shortDate(d: Date) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(d);
}

function periodo30d() {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 86_400_000);
  return { from, to, label: "Últimos 30 dias" };
}

export async function mercadoLivreConnections(): Promise<IntegrationConnection[]> {
  const all = await getIntegrations("mercado_livre");
  return all.filter((connection) => connection.status === "connected");
}

export const mercadoLivreRupturaDetector: Detector = {
  type: TYPE,
  provider: PROVIDER,
  async run(): Promise<InsightCandidate[]> {
    const candidates: InsightCandidate[] = [];
    for (const connection of await mercadoLivreConnections()) {
      const overview = await getMercadoLivreOverviewFromCanonical(connection, periodo30d()).catch(() => null);
      if (!overview) continue;
      for (const r of overview.stockRadar) {
        if (r.status !== "out" && r.status !== "critical") continue;
        const name = r.title || r.sku || r.id;
        const isOut = r.status === "out";
        const dias = r.daysRemaining ?? 0;
        const perDay = +(r.unitsSold / Math.max(1, r.calculationDays)).toFixed(2);
        // Fora de estoque = severidade máxima; crítico cresce conforme os dias caem.
        const severity = isOut ? 100 : Math.min(99, 60 + Math.max(0, 10 - dias) * 4);
        const reporAte = shortDate(new Date(Date.now() + dias * 86_400_000));

        const recommendation = isOut
          ? `${name} está sem estoque disponível no Mercado Livre. Reponha o quanto antes — cada dia parado é venda perdida.`
          : `${name} rompe em ${dias} dia(s) no ritmo de ${perDay}/dia. Reponha até ${reporAte} para não faltar.`;

        candidates.push({
          // A conta entra no fingerprint: dois vendedores ML no mesmo workspace
          // podem ter o mesmo SKU, e o insight é de um anúncio específico.
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
            premissa: `lead time de reposição ~${LEAD_TIME_DAYS} dias`,
          },
          recommendation,
          actionHref: "/mercado-livre/estoque",
        });
      }
    }
    return candidates;
  },
};
