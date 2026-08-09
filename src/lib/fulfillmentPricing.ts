// Leitura do menor preço por tipo de logística (FBA x vendedor).
//
// `competitivePrice` não diz quem entrega, e é justamente isso que separa
// concorrente de verdade de vendedor que não compete: na Amazon, `AFN` = FBA
// (Amazon envia) e `MFN` = o vendedor envia. É o equivalente ao filtro "FULL"
// de outros marketplaces.
//
// Módulo sem I/O de propósito: o parsing é onde mora a decisão que importa —
// distinguir ausência de oferta FBA (`null`) de preço zero — e fica testável
// sem rede. A chamada vive em `pricing.ts`.

export const AFN = "AFN"; // Amazon Fulfilled Network = FBA
export const MFN = "MFN"; // Merchant Fulfilled Network = o vendedor envia

interface CompetitiveSummaryOffer {
  fulfillmentType?: string;
  listingPrice?: { amount?: number; currencyCode?: string };
}

export interface CompetitiveSummaryResponse {
  responses?: {
    body?: {
      asin?: string;
      lowestPricedOffers?: { offers?: CompetitiveSummaryOffer[] }[];
      featuredBuyingOptions?: { segmentedFeaturedOffers?: CompetitiveSummaryOffer[] }[];
    };
  }[];
}

export interface FulfillmentPrice {
  /** Menor preço entre ofertas FBA. `null` = nenhuma oferta FBA (não é zero). */
  fbaPrice: number | null;
  /** Menor preço considerando qualquer logística. */
  lowestPrice: number | null;
  /** Quem está com a oferta em destaque. */
  featured: "fba" | "seller" | null;
  currency: string;
}

/**
 * Traduz a resposta do lote em "menor preço FBA" por ASIN.
 * O ASIN é lido de `body.asin` — o `request` devolvido pela Amazon volta vazio,
 * então casar por ordem de envio seria frágil.
 */
export function parseCompetitiveSummary(
  data: CompetitiveSummaryResponse
): Map<string, FulfillmentPrice> {
  const map = new Map<string, FulfillmentPrice>();
  for (const resp of data.responses ?? []) {
    const asin = resp.body?.asin;
    if (!asin) continue;

    let fbaPrice: number | null = null;
    let lowestPrice: number | null = null;
    let currency = "BRL";

    for (const grupo of resp.body?.lowestPricedOffers ?? []) {
      for (const offer of grupo.offers ?? []) {
        const valor = offer.listingPrice?.amount;
        if (typeof valor !== "number") continue;
        if (offer.listingPrice?.currencyCode) currency = offer.listingPrice.currencyCode;
        if (lowestPrice == null || valor < lowestPrice) lowestPrice = valor;
        if (offer.fulfillmentType === AFN && (fbaPrice == null || valor < fbaPrice)) {
          fbaPrice = valor;
        }
      }
    }

    const destaque = resp.body?.featuredBuyingOptions?.[0]?.segmentedFeaturedOffers?.[0];
    map.set(asin, {
      fbaPrice,
      lowestPrice,
      featured: destaque?.fulfillmentType === AFN ? "fba" : destaque?.fulfillmentType ? "seller" : null,
      currency,
    });
  }
  return map;
}

/** Monta o corpo do lote (até 20 ASINs por chamada). */
export function competitiveSummaryBody(asins: string[], marketplaceId: string) {
  return {
    requests: asins.slice(0, 20).map((asin) => ({
      uri: "/products/pricing/2022-05-01/items/competitiveSummary",
      method: "GET",
      asin,
      marketplaceId,
      includedData: ["lowestPricedOffers", "featuredBuyingOptions"],
      lowestPricedOffersInputs: [{ itemCondition: "New", offerType: "Consumer" }],
    })),
  };
}
