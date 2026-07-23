import { spapiFetch, defaultMarketplaceId } from "./spapi";
import { estimateStorage } from "./storage";

interface Dimension {
  unit: string;
  value: number;
}
interface RankEntry {
  title?: string;
  rank: number;
}
interface CatalogItemResponse {
  asin?: string;
  summaries?: { marketplaceId: string; itemName?: string; brand?: string }[];
  images?: {
    marketplaceId: string;
    images: { link: string; height: number; width: number }[];
  }[];
  dimensions?: {
    marketplaceId: string;
    package?: {
      height?: Dimension;
      length?: Dimension;
      width?: Dimension;
      weight?: Dimension;
    };
  }[];
  attributes?: {
    product_site_launch_date?: { value: string; marketplace_id: string }[];
  };
  salesRanks?: {
    marketplaceId: string;
    classificationRanks?: RankEntry[];
    displayGroupRanks?: RankEntry[];
  }[];
}

export interface ItemInfo {
  asin: string;
  title?: string;
  brand?: string;
  imageUrl?: string;
  launchDate?: string; // data de disponibilização do anúncio (Date First Available)
  salesRank?: { rank: number; category?: string }; // BSR
  dimensionsCm?: { length: number; width: number; height: number };
  volumeM3?: number;
  storageTier?: "small" | "large";
  storageRatePerM3?: number;
  estimatedStorageFee?: number; // custo mensal cheio (1 unidade / 1 mês)
}

/** Converte uma dimensão para centímetros (a API pode vir em polegadas ou cm). */
function toCm(d?: Dimension): number | undefined {
  if (!d) return undefined;
  const unit = d.unit?.toLowerCase();
  if (unit === "inches" || unit === "in") return d.value * 2.54;
  if (unit === "centimeters" || unit === "cm") return d.value;
  if (unit === "millimeters" || unit === "mm") return d.value / 10;
  return d.value; // assume cm se desconhecido
}

/**
 * Busca a imagem (capa) de vários ASINs de uma vez — searchCatalogItems aceita
 * até 20 identifiers por chamada. Retorna { asin: url } (só os que têm imagem).
 * Operação: searchCatalogItems — GET /catalog/2022-04-01/items?identifiers=...
 */
export async function getCatalogImages(
  asins: string[],
  marketplaceId = defaultMarketplaceId()
): Promise<Record<string, string>> {
  const unique = Array.from(new Set(asins.filter(Boolean)));
  const out: Record<string, string> = {};
  for (let i = 0; i < unique.length; i += 20) {
    const batch = unique.slice(i, i + 20);
    try {
      const data = await spapiFetch<{ items?: { asin?: string; images?: { images?: { link: string; width: number }[] }[] }[] }>(
        "/catalog/2022-04-01/items",
        { query: { identifiers: batch.join(","), identifiersType: "ASIN", marketplaceIds: marketplaceId, includedData: "images", pageSize: 20 } }
      );
      for (const item of data.items ?? []) {
        const imgs = item.images?.[0]?.images ?? [];
        const biggest = imgs.slice().sort((a, b) => b.width - a.width)[0];
        if (item.asin && biggest?.link) out[item.asin] = biggest.link;
      }
    } catch {
      // Lote que falhar segue sem imagem — não derruba a lista inteira.
    }
  }
  return out;
}

/**
 * Busca nome/marca/imagem/dimensões de um ASIN e estima a tarifa de armazenagem.
 * Operação: getCatalogItem — GET /catalog/2022-04-01/items/{asin}
 */
export async function getItemInfo(
  asin: string,
  marketplaceId = defaultMarketplaceId()
): Promise<ItemInfo> {
  const data = await spapiFetch<CatalogItemResponse>(
    `/catalog/2022-04-01/items/${encodeURIComponent(asin)}`,
    {
      query: {
        marketplaceIds: marketplaceId,
        includedData: "summaries,images,dimensions,attributes,salesRanks",
      },
    }
  );

  const summary = data.summaries?.[0];
  const imageSet = data.images?.[0]?.images ?? [];
  const biggest = imageSet.slice().sort((a, b) => b.width - a.width)[0];

  const pkg = data.dimensions?.[0]?.package;
  const length = toCm(pkg?.length);
  const width = toCm(pkg?.width);
  const height = toCm(pkg?.height);

  const info: ItemInfo = {
    asin,
    title: summary?.itemName,
    brand: summary?.brand,
    imageUrl: biggest?.link,
    launchDate: data.attributes?.product_site_launch_date?.[0]?.value,
  };

  const ranks = data.salesRanks?.[0];
  const bestRank = ranks?.displayGroupRanks?.[0] ?? ranks?.classificationRanks?.[0];
  if (bestRank) {
    info.salesRank = { rank: bestRank.rank, category: bestRank.title };
  }

  if (length && width && height) {
    const dims = {
      length: +length.toFixed(2),
      width: +width.toFixed(2),
      height: +height.toFixed(2),
    };
    const storage = estimateStorage(dims);
    info.dimensionsCm = dims;
    info.volumeM3 = storage.volumeM3;
    info.storageTier = storage.tier;
    info.storageRatePerM3 = storage.ratePerM3;
    info.estimatedStorageFee = storage.monthlyFee;
  }

  return info;
}
