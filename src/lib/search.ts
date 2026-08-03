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
  salesRank?: number;
  salesRankCategory?: string;
  subRank?: number; // rank na subcategoria (classificação mais específica)
  subRankCategory?: string;
  price?: number | null;
  currency?: string;
  offerCount?: number | null; // nº de vendedores/ofertas
}

export interface SearchResults {
  total: number;
  items: ProductResult[];
  nextToken?: string;
}

// --- Identidade (título/marca/foto) de vários ASINs numa chamada (ADR-011) ---
// A mesma operação da busca aceita `identifiers` em vez de `keywords`: até 20 ASINs
// por chamada. É o que permite preencher a watchlist herdada sem uma chamada por ASIN.
const IDENTIFIERS_POR_CHAMADA = 20;

export interface CatalogIdentity {
  title?: string;
  brand?: string;
  imageUrl?: string;
}

export async function getCatalogIdentities(
  asins: string[],
  marketplaceId = defaultMarketplaceId()
): Promise<Map<string, CatalogIdentity>> {
  const map = new Map<string, CatalogIdentity>();
  const unicos = [...new Set(asins.filter(Boolean))];
  if (!unicos.length) return map;

  const lotes: string[][] = [];
  for (let i = 0; i < unicos.length; i += IDENTIFIERS_POR_CHAMADA) {
    lotes.push(unicos.slice(i, i + IDENTIFIERS_POR_CHAMADA));
  }

  // Sequencial de propósito: são poucas chamadas e o rate limit da Catalog API é
  // apertado — paralelizar aqui só trocaria latência por 429.
  for (const lote of lotes) {
    const data = await spapiFetch<SearchResponse>("/catalog/2022-04-01/items", {
      query: {
        marketplaceIds: marketplaceId,
        identifiers: lote.join(","),
        identifiersType: "ASIN",
        includedData: "summaries,images",
        // O padrão da API é 10 por página: sem isto metade do lote some em silêncio.
        pageSize: IDENTIFIERS_POR_CHAMADA,
      },
    }).catch(() => null);
    if (!data) continue; // lote que falhar é pulado; os outros seguem
    for (const it of data.items ?? []) {
      const s = it.summaries?.[0] ?? {};
      const imgs = it.images?.[0]?.images ?? [];
      const biggest = imgs.slice().sort((a, b) => b.width - a.width)[0];
      map.set(it.asin, { title: s.itemName, brand: s.brand, imageUrl: biggest?.link });
    }
  }
  return map;
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
    const best = ranks?.displayGroupRanks?.[0] ?? ranks?.classificationRanks?.[0];
    // Subcategoria: a classificação mais específica (ex.: "Canudos de papel"),
    // que é o rank comparável dentro do nicho pesquisado.
    const sub = ranks?.classificationRanks?.[0];
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
      salesRank: best?.rank,
      salesRankCategory: best?.title,
      subRank: sub?.rank,
      subRankCategory: sub?.title,
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
