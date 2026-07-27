import { spapiFetch, defaultMarketplaceId } from "./spapi";
import { cached } from "./cache";
import { getCompetitivePricingBatch } from "./pricing";

// Busca de produtos no catálogo da Amazon por palavra-chave.
// Operação: searchCatalogItems — GET /catalog/2022-04-01/items

interface RankEntry {
  title?: string;
  rank: number;
}
interface Relationship {
  type?: string;
  parentAsins?: string[];
}
interface SearchItem {
  asin: string;
  summaries?: { itemName?: string; brand?: string }[];
  images?: { images: { link: string; height: number; width: number }[] }[];
  attributes?: { product_site_launch_date?: { value: string }[] };
  salesRanks?: { classificationRanks?: RankEntry[]; displayGroupRanks?: RankEntry[] }[];
  relationships?: { relationships?: Relationship[] }[];
}
interface SearchResponse {
  numberOfResults?: number;
  pagination?: { nextToken?: string };
  items?: SearchItem[];
}

export interface ProductResult {
  asin: string;
  title?: string;
  brand?: string;
  imageUrl?: string;
  launchDate?: string; // data de disponibilização DESTE ASIN
  isVariation: boolean;
  parentAsin?: string;
  familyLaunchDate?: string; // data do produto-pai (idade real da linha)
  salesRank?: number; // rank de nicho (subcategoria mais específica)
  salesRankCategory?: string;
  salesRanks?: { rank: number; category?: string }[]; // todos os nós (nicho + amplo)
  price?: number | null;
  currency?: string;
  offerCount?: number | null; // nº de vendedores/ofertas
}

export interface SearchResults {
  total: number;
  items: ProductResult[];
  nextToken?: string;
}

// --- Data de lançamento de um ASIN (lean, cacheada 1h) ---
async function fetchLaunchDate(asin: string, marketplaceId: string): Promise<string | undefined> {
  const data = await spapiFetch<{ attributes?: { product_site_launch_date?: { value: string }[] } }>(
    `/catalog/2022-04-01/items/${encodeURIComponent(asin)}`,
    { query: { marketplaceIds: marketplaceId, includedData: "attributes" } }
  );
  return data.attributes?.product_site_launch_date?.[0]?.value;
}
function getLaunchDate(asin: string, marketplaceId: string): Promise<string | undefined> {
  return cached(`launch:${marketplaceId}:${asin}`, 3_600_000, () => fetchLaunchDate(asin, marketplaceId));
}

// Executa `fn` sobre os itens com concorrência limitada (evita estourar rate limit).
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

export function searchProducts(
  keywords: string,
  pageToken?: string,
  marketplaceId = defaultMarketplaceId()
): Promise<SearchResults> {
  const key = `search:${marketplaceId}:${keywords}:${pageToken ?? ""}`;
  return cached(key, 60_000, () => fetchSearch(keywords, pageToken, marketplaceId));
}

async function fetchSearch(
  keywords: string,
  pageToken: string | undefined,
  marketplaceId: string
): Promise<SearchResults> {
  const query: Record<string, string | number | undefined> = {
    marketplaceIds: marketplaceId,
    includedData: "summaries,images,salesRanks,attributes,relationships",
    pageSize: 20,
  };
  if (pageToken) query.pageToken = pageToken;
  else query.keywords = keywords;

  const data = await spapiFetch<SearchResponse>("/catalog/2022-04-01/items", { query });

  const items: ProductResult[] = (data.items ?? []).map((it) => {
    const s = it.summaries?.[0] ?? {};
    const imgs = it.images?.[0]?.images ?? [];
    const biggest = imgs.slice().sort((a, b) => b.width - a.width)[0];
    const ranks = it.salesRanks?.[0];
    const cls = ranks?.classificationRanks ?? [];
    const dsp = ranks?.displayGroupRanks ?? [];
    // Nicho = a subcategoria (classificação) tem prioridade sobre o grupo amplo:
    // é o rank comparável dentro do nicho pesquisado. Os dois nós ficam expostos.
    const niche = cls[0] ?? dsp[0];
    const allRanks = [...cls, ...dsp]
      .filter((r) => typeof r.rank === "number")
      .map((r) => ({ rank: r.rank, category: r.title }));
    const variation = it.relationships?.[0]?.relationships?.find((r) => r.type === "VARIATION");
    const parentAsin = variation?.parentAsins?.[0];
    return {
      asin: it.asin,
      title: s.itemName,
      brand: s.brand,
      imageUrl: biggest?.link,
      launchDate: it.attributes?.product_site_launch_date?.[0]?.value,
      isVariation: !!parentAsin,
      parentAsin,
      salesRank: niche?.rank,
      salesRankCategory: niche?.title,
      salesRanks: allRanks.length ? allRanks : undefined,
    };
  });

  // Para as variações, busca a data do produto-pai (idade real da linha).
  const parents = [...new Set(items.filter((i) => i.parentAsin).map((i) => i.parentAsin!))];
  const parentDates = new Map<string, string | undefined>();
  await mapLimit(parents, 4, async (p) => {
    parentDates.set(p, await getLaunchDate(p, marketplaceId).catch(() => undefined));
  });
  for (const it of items) {
    if (it.parentAsin) it.familyLaunchDate = parentDates.get(it.parentAsin);
  }

  // Preço competitivo + nº de vendedores, em lote (1 chamada para os 20).
  const prices = await getCompetitivePricingBatch(
    items.map((i) => i.asin),
    marketplaceId
  ).catch(() => new Map());
  for (const it of items) {
    const cp = prices.get(it.asin);
    if (cp) {
      it.price = cp.price;
      it.currency = cp.currency;
      it.offerCount = cp.offerCount;
    }
  }

  return {
    total: data.numberOfResults ?? items.length,
    items,
    nextToken: data.pagination?.nextToken,
  };
}
