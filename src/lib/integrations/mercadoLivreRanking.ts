import { mercadoLivreFetch } from "./mercadoLivre";
import { cached } from "../cache";
import type { IntegrationConnection } from "./types";

// Ranqueamento por termo de busca (feature específica do Mercado Livre). Varre a
// busca pública `/sites/{site}/search?q=` — que devolve os resultados na ordem
// de ranqueamento — nas primeiras 20 páginas (teto de offset 1000 do ML) e
// descobre a posição dos seus anúncios e a dos concorrentes do topo.
//
// O ranking é aproximado: a busca real do comprador varia por localização,
// histórico e patrocinados. É a mesma limitação de ferramentas como o Mercado
// Turbo, e por isso a UI mostra o aviso.

const PAGE = 50;
const MAX_PAGES = 20; // 20 × 50 = 1000 (teto do offset no ML)
const TOP_COMPETITORS = 12;
const SCAN_CONCURRENCY = 5;

interface SearchSeller { id?: number; nickname?: string }
interface SearchResult {
  id: string;
  title: string;
  price?: number;
  currency_id?: string;
  permalink?: string;
  thumbnail?: string;
  seller?: SearchSeller;
}
interface SearchPage { paging?: { total?: number }; results?: SearchResult[] }

interface MlUser {
  nickname?: string;
  address?: { city?: string; state?: string };
  seller_reputation?: { power_seller_status?: string | null };
}

export interface RankingListing {
  position: number;
  page: number;
  id: string;
  title: string;
  price: number;
  currency: string;
  permalink: string | null;
  thumbnail: string | null;
}

export interface RankingCompetitor {
  sellerId: number;
  nickname: string;
  city: string | null;
  reputation: string | null; // "Platinum" | "Gold" | "Silver" | null
  count: number;
  positions: number[];
  bestPrice: number | null;
  currency: string;
}

export interface MercadoLivreRanking {
  term: string;
  total: number;
  scanned: number;
  perPage: number;
  mine: RankingListing[];
  competitors: RankingCompetitor[];
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      out[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const repLabel = (status?: string | null): string | null => {
  if (!status) return null;
  const map: Record<string, string> = { platinum: "Platinum", gold: "Gold", silver: "Silver" };
  return map[status] ?? status.charAt(0).toUpperCase() + status.slice(1);
};

async function scanRanking(connection: IntegrationConnection, term: string): Promise<MercadoLivreRanking> {
  const siteId = String(connection.metadata?.siteId ?? connection.region ?? "MLB");
  const myId = Number(connection.externalAccountId);
  const encoded = encodeURIComponent(term);
  const path = (offset: number) => `/sites/${siteId}/search?q=${encoded}&limit=${PAGE}&offset=${offset}`;

  // Primeira página: define o total e quantas páginas realmente varrer.
  const first = await mercadoLivreFetch<SearchPage>(connection, path(0));
  const total = first.paging?.total ?? (first.results?.length ?? 0);
  const pages = Math.min(MAX_PAGES, Math.max(1, Math.ceil(total / PAGE)));

  const restOffsets = Array.from({ length: pages - 1 }, (_, index) => (index + 1) * PAGE);
  const restPages = await mapLimit(restOffsets, SCAN_CONCURRENCY, (offset) =>
    mercadoLivreFetch<SearchPage>(connection, path(offset)).catch(() => ({ results: [] } as SearchPage))
  );

  // Achata em uma lista com a posição global (1-based) de cada resultado.
  interface Ranked { position: number; result: SearchResult }
  const ranked: Ranked[] = [];
  const collect = (page: SearchPage, baseOffset: number) => {
    (page.results ?? []).forEach((result, index) => ranked.push({ position: baseOffset + index + 1, result }));
  };
  collect(first, 0);
  restPages.forEach((page, index) => collect(page, restOffsets[index]));

  // Seus anúncios.
  const mine: RankingListing[] = ranked
    .filter((entry) => entry.result.seller?.id === myId)
    .map((entry) => ({
      position: entry.position,
      page: Math.ceil(entry.position / PAGE),
      id: entry.result.id,
      title: entry.result.title,
      price: Number(entry.result.price ?? 0),
      currency: entry.result.currency_id ?? "BRL",
      permalink: entry.result.permalink ?? null,
      thumbnail: entry.result.thumbnail ?? null,
    }));

  // Concorrentes: vendedores presentes na primeira página (top 50), com todas as
  // posições que ocupam em toda a varredura e o menor preço.
  const firstPageSellers = new Set<number>();
  ranked
    .filter((entry) => entry.position <= PAGE && entry.result.seller?.id && entry.result.seller.id !== myId)
    .forEach((entry) => firstPageSellers.add(entry.result.seller!.id!));

  const byId = new Map<number, { positions: number[]; prices: number[]; currency: string }>();
  for (const entry of ranked) {
    const id = entry.result.seller?.id;
    if (!id || !firstPageSellers.has(id)) continue;
    const agg = byId.get(id) ?? { positions: [], prices: [], currency: entry.result.currency_id ?? "BRL" };
    agg.positions.push(entry.position);
    const price = Number(entry.result.price);
    if (Number.isFinite(price) && price > 0) agg.prices.push(price);
    byId.set(id, agg);
  }

  const ordered = [...byId.entries()]
    .sort((a, b) => Math.min(...a[1].positions) - Math.min(...b[1].positions))
    .slice(0, TOP_COMPETITORS);

  // Enriquece reputação/cidade/nick com /users/{id} (só o topo).
  const competitors: RankingCompetitor[] = await mapLimit(ordered, SCAN_CONCURRENCY, async ([sellerId, agg]) => {
    let user: MlUser = {};
    try {
      user = await mercadoLivreFetch<MlUser>(connection, `/users/${sellerId}`);
    } catch {
      // segue sem enriquecer
    }
    const city = [user.address?.city, user.address?.state].filter(Boolean).join(", ") || null;
    return {
      sellerId,
      nickname: user.nickname ?? String(sellerId),
      city,
      reputation: repLabel(user.seller_reputation?.power_seller_status),
      count: agg.positions.length,
      positions: agg.positions.sort((a, b) => a - b),
      bestPrice: agg.prices.length ? Math.min(...agg.prices) : null,
      currency: agg.currency,
    };
  });

  return { term, total, scanned: pages * PAGE, perPage: PAGE, mine, competitors };
}

export function getMercadoLivreRanking(connection: IntegrationConnection, term: string): Promise<MercadoLivreRanking> {
  const key = `ml-ranking:${connection.id}:${term.trim().toLocaleLowerCase("pt-BR")}`;
  return cached(key, 5 * 60_000, () => scanRanking(connection, term));
}
