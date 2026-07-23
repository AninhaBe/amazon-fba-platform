import { runReport, parseTsv } from "./reports";
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
export function getListings(): Promise<Listing[]> {
  return swr("listings", 30 * 60_000, fetchListings, { fallback: [] });
}

async function fetchListings(): Promise<Listing[]> {
  const tsv = await runReport("GET_MERCHANT_LISTINGS_ALL_DATA");
  const rows = parseTsv(tsv);

  return rows
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
        openDate: r["open-date"] || undefined,
      };
    })
    .filter((l) => l.sku);
}
