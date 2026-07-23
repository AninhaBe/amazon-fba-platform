import { runReport, parseTsv } from "./reports";
import { getCatalogImages } from "./catalog";
import { swr } from "./swr";

export interface Listing {
  sku: string;
  asin?: string;
  title?: string;
  price: number | null; // preço de venda anunciado
  quantity: number | null;
  status?: string; // Active | Inactive | Incomplete
  fulfillment?: "fba" | "fbm"; // AMAZON_* = FBA (Logística da Amazon); DEFAULT/vazio = FBM (você envia)
  imageUrl?: string;
  openDate?: string;
}

/**
 * Lista TODOS os anúncios da conta com stale-while-revalidate.
 * O relatório é lento (~20s), então NUNCA esperamos: devolve o cache na hora
 * e atualiza em segundo plano. Relatório: GET_MERCHANT_LISTINGS_ALL_DATA.
 */
export function getListings(awaitIfEmpty = false): Promise<Listing[]> {
  // v2: chave nova invalida o cache antigo (que não tinha imagem/status).
  return swr("listings-v2", 30 * 60_000, fetchListings, { fallback: [], awaitIfEmpty });
}

async function fetchListings(): Promise<Listing[]> {
  const tsv = await runReport("GET_MERCHANT_LISTINGS_ALL_DATA");
  const rows = parseTsv(tsv);

  const listings = rows
    .map((r) => {
      // Nomes de coluna do flat file (variam levemente por marketplace).
      const sku = r["seller-sku"] || r["sku"] || "";
      const asin = r["asin1"] || r["asin"] || undefined;
      const title = r["item-name"] || undefined;
      const priceRaw = r["price"] || r["your-price"] || "";
      const qtyRaw = r["quantity"] || "";
      const price = priceRaw ? parseFloat(priceRaw.replace(",", ".")) : null;
      const quantity = qtyRaw ? parseInt(qtyRaw, 10) : null;
      const channelRaw = (r["fulfillment-channel"] || r["fulfilment-channel"] || "").toUpperCase();
      const fulfillment: Listing["fulfillment"] = channelRaw.startsWith("AMAZON") ? "fba" : channelRaw ? "fbm" : undefined;
      return {
        sku,
        asin,
        title,
        price: Number.isFinite(price) ? price : null,
        quantity: Number.isFinite(quantity as number) ? quantity : null,
        status: r["status"] || undefined,
        fulfillment,
        imageUrl: r["image-url"] || undefined,
        openDate: (r["open-date"] || "").slice(0, 10) || undefined, // "2026-05-28 13:44:28 BRT" -> "2026-05-28"
      } satisfies Listing;
    })
    .filter((l) => l.sku);

  // O relatório costuma vir sem imagem: busca a capa por ASIN na Catalog Items
  // API (em lote). Limita para não exagerar em contas com catálogo enorme.
  const missing = listings.filter((l) => l.asin && !l.imageUrl).map((l) => l.asin as string).slice(0, 200);
  if (missing.length) {
    const images = await getCatalogImages(missing);
    for (const listing of listings) {
      if (listing.asin && !listing.imageUrl && images[listing.asin]) listing.imageUrl = images[listing.asin];
    }
  }

  return listings;
}
