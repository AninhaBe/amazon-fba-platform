import { spapiFetch, defaultMarketplaceId } from "./spapi";

interface PriceAmount {
  CurrencyCode: string;
  Amount: number;
}

interface OfferPrice {
  condition: string;
  fulfillmentChannel?: string;
  LandedPrice?: PriceAmount;
  ListingPrice: PriceAmount;
  Shipping?: PriceAmount;
}

interface ItemOffersResponse {
  payload?: {
    Summary?: {
      BuyBoxPrices?: OfferPrice[];
      LowestPrices?: OfferPrice[];
    };
  };
}

export interface CurrentPrice {
  listingPrice: number;
  shipping: number;
  currency: string;
  source: "buybox" | "lowest";
}

/**
 * Puxa o preço atual de um ASIN no marketplace.
 * Operação: getItemOffers — GET /products/pricing/v0/items/{Asin}/offers
 * Usa o Buy Box; se não houver, cai para o menor preço "New".
 */
export async function getCurrentPrice(
  asin: string,
  marketplaceId = defaultMarketplaceId()
): Promise<CurrentPrice | null> {
  const data = await spapiFetch<ItemOffersResponse>(
    `/products/pricing/v0/items/${encodeURIComponent(asin)}/offers`,
    { query: { MarketplaceId: marketplaceId, ItemCondition: "New" } }
  );

  const summary = data.payload?.Summary;
  const pick = summary?.BuyBoxPrices?.[0] ?? summary?.LowestPrices?.[0];
  if (!pick) return null;

  return {
    listingPrice: pick.ListingPrice.Amount,
    shipping: pick.Shipping?.Amount ?? 0,
    currency: pick.ListingPrice.CurrencyCode,
    source: summary?.BuyBoxPrices?.[0] ? "buybox" : "lowest",
  };
}
