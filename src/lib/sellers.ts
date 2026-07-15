import { spapiFetch, defaultMarketplaceId } from "./spapi";

// Sellers API — usado só para descobrir um nome amigável do marketplace da conta.
// O OAuth devolve apenas o selling_partner_id (um código); isto dá contexto
// ("Amazon.com.br") para exibir no seletor de contas.

interface MarketplaceParticipation {
  marketplace: { id: string; name: string; countryCode: string };
  participation?: { isParticipating: boolean };
}

/**
 * Nome do marketplace da conta ativa (ex.: "Amazon.com.br"), ou null se não der.
 * Roda dentro do contexto da conta (usa o token dela). Falha silenciosa: se a
 * role não estiver concedida ou a chamada falhar, retorna null e a conexão segue.
 */
export async function getMarketplaceName(): Promise<string | null> {
  try {
    const data = await spapiFetch<{ payload?: MarketplaceParticipation[] }>(
      "/sellers/v1/marketplaceParticipations"
    );
    const list = data.payload ?? [];
    const preferred =
      list.find((p) => p.marketplace.id === defaultMarketplaceId()) ??
      list.find((p) => p.participation?.isParticipating) ??
      list[0];
    return preferred?.marketplace?.name ?? null;
  } catch {
    return null;
  }
}
