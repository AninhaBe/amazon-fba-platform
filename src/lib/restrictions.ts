import { currentAccount } from "./accountContext";
import { defaultMarketplaceId, spapiFetch } from "./spapi";
import { cached } from "./cache";

// Elegibilidade de venda (gating) por ASIN, para a conta ativa. A mesma Listings
// Restrictions API que o criador de anúncios usa — aqui em lote, para a pesquisa de
// mercado responder "eu consigo vender isso?". A resposta é POR CONTA: o mesmo ASIN
// pode estar liberado para um vendedor e travado para outro.

export type ListingEligibility = "listable" | "approval" | "blocked";

export interface RestrictionInfo {
  eligibility: ListingEligibility;
  reason?: string;
}

interface RestrictionsResponse {
  restrictions?: Array<{
    reasons?: Array<{ message?: string; reasonCode?: string }>;
  }>;
}

async function fetchRestriction(asin: string, sellerId: string, marketplaceId: string): Promise<RestrictionInfo> {
  const data = await spapiFetch<RestrictionsResponse>("/listings/2021-08-01/restrictions", {
    query: {
      asin,
      sellerId,
      marketplaceIds: marketplaceId,
      conditionType: "new_new",
      reasonLocale: "pt_BR",
    },
  });
  const list = data.restrictions ?? [];
  // Lista vazia = pode listar sem aprovação.
  if (list.length === 0) return { eligibility: "listable" };
  const reasons = list.flatMap((r) => r.reasons ?? []);
  const codes = reasons.map((r) => r.reasonCode ?? "");
  // APPROVAL_REQUIRED = dá para vender após solicitar aprovação; caso contrário
  // (NOT_ELIGIBLE etc.) tratamos como bloqueado.
  const canApprove = codes.some((c) => c === "APPROVAL_REQUIRED") && !codes.some((c) => c === "NOT_ELIGIBLE");
  return { eligibility: canApprove ? "approval" : "blocked", reason: reasons[0]?.message };
}

// Concorrência limitada — não estourar o rate limit da SP-API com 20 chamadas de uma vez.
async function mapLimit<T>(items: T[], limit: number, fn: (t: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}

export async function getRestrictionsBatch(asins: string[]): Promise<Record<string, RestrictionInfo>> {
  const sellerId = currentAccount()?.sellerId;
  if (!sellerId) return {};
  const marketplaceId = defaultMarketplaceId();
  const unique = [...new Set(asins.map((a) => a.trim().toUpperCase()).filter(Boolean))].slice(0, 40);
  const out: Record<string, RestrictionInfo> = {};
  await mapLimit(unique, 4, async (asin) => {
    try {
      out[asin] = await cached(
        `restrict:${marketplaceId}:${sellerId}:${asin}`,
        3_600_000,
        () => fetchRestriction(asin, sellerId, marketplaceId)
      );
    } catch {
      // Falha pontual não derruba o lote — o ASIN simplesmente fica sem selo.
    }
  });
  return out;
}
