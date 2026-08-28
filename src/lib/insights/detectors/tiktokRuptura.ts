import { getTiktokShops, type TiktokShop } from "../../tiktokStore";
import { readInventory } from "../../integrations/tiktokModules";
import { tiktokConnectionId } from "../../integrations/tiktokContract";
import type { IntegrationConnection } from "../../integrations/types";
import type { Detector, InsightCandidate } from "../types";

// Detector de ruptura de estoque (TikTok Shop). Reimplementação do princípio da
// Amazon com o módulo de estoque do TikTok, que já classifica cobertura com a
// MESMA regra compartilhada dos quatro canais (`classificarCobertura`).

const TYPE = "ruptura";
const PROVIDER = "tiktok_shop";
const LEAD_TIME_DAYS = 15; // premissa de reposição para estimar o risco
const PAGE_LIMIT = 100;
const MAX_PAGES = 5; // teto defensivo: 500 anúncios por loja cobrem o catálogo real

function shortDate(d: Date) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(d);
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Conexão canônica derivada da loja — mesmo shape que a rota de overview monta. */
export function tiktokShopConnection(shop: TiktokShop): IntegrationConnection {
  return {
    id: tiktokConnectionId(shop.shopId),
    provider: PROVIDER,
    externalAccountId: shop.shopId,
    displayName: shop.shopName,
    mode: "local",
    region: shop.region,
    scopes: [],
    metadata: { taxRate: shop.taxRate ?? null },
    status: "connected",
    connectedAt: shop.connectedAt,
    updatedAt: shop.connectedAt,
  };
}

export const tiktokRupturaDetector: Detector = {
  type: TYPE,
  provider: PROVIDER,
  async run(): Promise<InsightCandidate[]> {
    const candidates: InsightCandidate[] = [];
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 86_400_000);
    for (const shop of await getTiktokShops()) {
      const connection = tiktokShopConnection(shop);
      for (let page = 0; page < MAX_PAGES; page++) {
        const params = new URLSearchParams({
          from: ymd(from),
          to: ymd(to),
          limit: String(PAGE_LIMIT),
          offset: String(page * PAGE_LIMIT),
        });
        const inventory = await readInventory(connection, params).catch(() => null);
        if (!inventory || inventory.availability !== "AVAILABLE") break;
        for (const item of inventory.items) {
          if (item.cobertura !== "out" && item.cobertura !== "critical") continue;
          const name = item.title || item.sku || item.productId;
          const isOut = item.cobertura === "out";
          const dias = item.daysRemaining == null ? 0 : Math.floor(item.daysRemaining);
          const perDay = item.averagePerDay;
          const severity = isOut ? 100 : Math.min(99, 60 + Math.max(0, 10 - dias) * 4);
          const reporAte = shortDate(new Date(Date.now() + dias * 86_400_000));

          candidates.push({
            id: `${TYPE}:${PROVIDER}:${shop.shopId}:${item.productId}:${item.sku ?? ""}`,
            type: TYPE,
            provider: PROVIDER,
            entityRef: item.sku ?? item.productId,
            severity,
            title: name,
            evidence: {
              disponivel: item.availableQty,
              vendasPorDia: perDay,
              diasRestantes: item.daysRemaining,
              vendidosNoPeriodo: item.unitsSold,
            },
            impact: {
              rupturaEmDias: isOut ? 0 : dias,
              unidadesEmRiscoEstimadas: Math.round(perDay * LEAD_TIME_DAYS),
              premissa: `lead time de reposição ~${LEAD_TIME_DAYS} dias`,
            },
            recommendation: isOut
              ? `${name} está sem estoque disponível na TikTok Shop. Reponha o quanto antes — cada dia parado é venda perdida.`
              : `${name} rompe em ${dias} dia(s) no ritmo de ${perDay}/dia. Reponha até ${reporAte} para não faltar.`,
            actionHref: "/tiktok/estoque",
          });
        }
        if (!inventory.page.hasMore) break;
      }
    }
    return candidates;
  },
};
