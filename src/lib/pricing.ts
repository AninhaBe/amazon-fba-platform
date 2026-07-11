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

// ---- Preço competitivo + nº de ofertas em LOTE (até 20 ASINs por chamada) ----
interface CompPriceResponse {
  payload?: {
    status?: string;
    ASIN?: string;
    Product?: {
      CompetitivePricing?: {
        CompetitivePrices?: { CompetitivePriceId?: string; Price?: { ListingPrice?: PriceAmount } }[];
        NumberOfOfferListings?: { condition?: string; Count?: number }[];
      };
    };
  }[];
}

export interface CompPrice {
  price: number | null;
  currency: string;
  offerCount: number | null; // nº de ofertas "New" (≈ vendedores)
}

/**
 * Preço competitivo (buy box) + nº de ofertas para vários ASINs de uma vez.
 * Operação: getCompetitivePricing — GET /products/pricing/v0/competitivePrice
 */
export async function getCompetitivePricingBatch(
  asins: string[],
  marketplaceId = defaultMarketplaceId()
): Promise<Map<string, CompPrice>> {
  const map = new Map<string, CompPrice>();
  if (!asins.length) return map;

  const data = await spapiFetch<CompPriceResponse>("/products/pricing/v0/competitivePrice", {
    query: { MarketplaceId: marketplaceId, ItemType: "Asin", Asins: asins.slice(0, 20).join(",") },
  });

  for (const p of data.payload ?? []) {
    if (!p.ASIN) continue;
    const cp = p.Product?.CompetitivePricing;
    const listing = cp?.CompetitivePrices?.find((c) => c.CompetitivePriceId === "1")?.Price?.ListingPrice;
    const offers =
      cp?.NumberOfOfferListings?.find((o) => o.condition === "New")?.Count ??
      cp?.NumberOfOfferListings?.find((o) => o.condition === "Any")?.Count ??
      null;
    map.set(p.ASIN, {
      price: listing?.Amount ?? null,
      currency: listing?.CurrencyCode ?? "BRL",
      offerCount: offers,
    });
  }
  return map;
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
