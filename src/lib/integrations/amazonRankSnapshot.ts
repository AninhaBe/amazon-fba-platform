import { dbQuery, hasDb } from "../db";
import { runWithWorkspace } from "../workspaceScope";
import { runWithAccount, type AccountCtx } from "../accountContext";
import { getAccount } from "../accountStore";
import { getInventory } from "../inventory";
import { spapiFetch, defaultMarketplaceId } from "../spapi";
import { recordRanks } from "../rankHistory";
import { recordSeen, watchlistForSnapshot, type SeenItem } from "../watchlist";

// Foto diária de ranking (ADR-009). Para cada conta ativa, fotografa o rank de
// (1) todos os produtos da conta (FBA) + (2) a watchlist (ASINs que entraram via
// busca — ADR-011). Assim o histórico engrossa sozinho, sem depender de a usuária
// buscar. Best-effort: falha nunca derruba o cron.

const PROVIDER = "amazon";
const CONNECTION_PREFIX = "amazon:";
const MAX_ASINS = 150; // teto por conta/dia (rate limit da SP-API)
const CONCURRENCY = 3;
// A rota do cron tem maxDuration de 240s e a foto de ranking é o 3º de 5 passos.
// Reservar uma fatia explícita evita que ela consuma o que sobra e derrube o resto.
const TOTAL_BUDGET_MS = 90_000;

interface RankNode {
  title?: string;
  rank: number;
}

interface CatalogItem {
  salesRanks?: { classificationRanks?: RankNode[]; displayGroupRanks?: RankNode[] }[];
  summaries?: { itemName?: string; brand?: string }[];
  images?: { images: { link: string; height: number; width: number }[] }[];
}

interface Snapshot {
  rank?: number;
  category?: string;
  title?: string;
  brand?: string;
  imageUrl?: string;
}

// `summaries,images` viajam de graça na mesma chamada que já fazíamos pelo rank —
// é o que mantém título e foto da watchlist atualizados sem nenhuma requisição extra
// (ADR-011). Rank: grupo amplo com fallback pra classificação, igual à /pesquisa.
async function fetchSnapshot(asin: string, marketplaceId: string): Promise<Snapshot | null> {
  const data = await spapiFetch<CatalogItem>(`/catalog/2022-04-01/items/${encodeURIComponent(asin)}`, {
    query: { marketplaceIds: marketplaceId, includedData: "salesRanks,summaries,images" },
  });
  const ranks = data.salesRanks?.[0];
  const best = ranks?.displayGroupRanks?.[0] ?? ranks?.classificationRanks?.[0];
  const summary = data.summaries?.[0];
  const biggest = (data.images?.[0]?.images ?? []).slice().sort((a, b) => b.width - a.width)[0];
  if (!best && !summary && !biggest) return null;
  return {
    rank: best?.rank,
    category: best?.title,
    title: summary?.itemName,
    brand: summary?.brand,
    imageUrl: biggest?.link,
  };
}

// Para quando o orçamento de tempo acaba: devolve quantos itens não foram processados.
async function mapLimit<T>(items: T[], limit: number, deadline: number, fn: (t: T) => Promise<void>): Promise<number> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      if (Date.now() > deadline) return;
      const idx = i++;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return Math.max(0, items.length - i);
}

async function snapshotOneAccount(account: AccountCtx, deadline: number): Promise<number> {
  return runWithAccount(account, async () => {
    const marketplaceId = defaultMarketplaceId();
    const [inventory, watch] = await Promise.all([
      getInventory().catch(() => []),
      watchlistForSnapshot().catch(() => ({ pinned: [], rest: [] })),
    ]);
    const mine = inventory.map((i) => i.asin).filter((a): a is string => !!a);
    // Ordem de prioridade antes do teto (ADR-011): o que a usuária fixou nunca é
    // descartado, depois os produtos dela, e só então o resto da watchlist por
    // recência. Sem isso o corte por MAX_ASINS seria arbitrário e silencioso.
    const asins = [...new Set([...watch.pinned, ...mine, ...watch.rest])].slice(0, MAX_ASINS);
    const cortados = new Set([...watch.pinned, ...mine, ...watch.rest]).size - asins.length;
    // Só atualizamos identidade de quem está na watchlist: os produtos da conta têm
    // sua própria tela e não devem aparecer no histórico de pesquisa.
    const naWatchlist = new Set([...watch.pinned, ...watch.rest]);

    const captured: { asin: string; salesRank?: number; salesRankCategory?: string }[] = [];
    const identidades: SeenItem[] = [];
    const naoProcessados = await mapLimit(asins, CONCURRENCY, deadline, async (asin) => {
      try {
        const s = await fetchSnapshot(asin, marketplaceId);
        if (!s) return;
        if (s.rank != null) captured.push({ asin, salesRank: s.rank, salesRankCategory: s.category });
        if (naWatchlist.has(asin)) {
          identidades.push({ asin, title: s.title, brand: s.brand, imageUrl: s.imageUrl });
        }
      } catch {
        // ASIN que falhar é pulado — não derruba a passada.
      }
    });

    if (captured.length) await recordRanks(captured);
    // Sem termo de busca: atualiza título/foto sem mexer em last_seen_at nem ressuscitar
    // ASIN removido.
    if (identidades.length) await recordSeen(identidades).catch(() => {});
    // Cobertura parcial nunca é silenciosa: sem isso, "0 novos" e "faltou tempo" ficam
    // indistinguíveis no log e o histórico ganha buracos sem explicação.
    if (cortados > 0) {
      console.warn(`[rank-snapshot] teto de ${MAX_ASINS} ASINs atingido; ${cortados} ficaram de fora hoje.`);
    }
    if (naoProcessados > 0) {
      console.warn(`[rank-snapshot] orçamento de tempo esgotado; ${naoProcessados} ASIN(s) não foram fotografados.`);
    }
    return captured.length;
  });
}

export async function runScheduledRankSnapshot(limit = 5): Promise<number> {
  if (!hasDb()) return 0;
  // Ordem por quem está há mais tempo sem foto (nunca fotografado vem primeiro). A
  // ordem anterior, por `updated_at` do sync, era arbitrária: a conta com a maior
  // watchlist caía sempre em primeiro, consumia todo o tempo da rota no rate limit da
  // SP-API e as demais nunca eram alcançadas — ficavam dias sem nenhuma captura.
  const rows = await dbQuery<{ workspace_id: string; connection_id: string }>(
    `SELECT s.workspace_id, s.connection_id
       FROM workspace_marketplace_syncs s
       LEFT JOIN (
         SELECT workspace_id, max(captured_on) AS ultima
           FROM workspace_rank_history GROUP BY workspace_id
       ) h ON h.workspace_id = s.workspace_id
      WHERE s.provider = $1
      ORDER BY h.ultima ASC NULLS FIRST, s.updated_at DESC
      LIMIT $2`,
    [PROVIDER, limit]
  );

  // Teto por conta: garante que a segunda da fila ainda tenha tempo de rodar dentro do
  // maxDuration da rota. Quem não couber hoje passa a ser o primeiro da fila amanhã.
  const orcamentoPorConta = Math.floor(TOTAL_BUDGET_MS / Math.max(1, rows.length));
  const fimGeral = Date.now() + TOTAL_BUDGET_MS;

  let total = 0;
  let puladas = 0;
  for (const row of rows) {
    if (Date.now() >= fimGeral) {
      puladas++;
      continue;
    }
    const sellerId = row.connection_id.startsWith(CONNECTION_PREFIX)
      ? row.connection_id.slice(CONNECTION_PREFIX.length)
      : row.connection_id;
    const account = await getAccount(sellerId);
    if (!account?.refreshToken) continue;
    const deadline = Math.min(Date.now() + orcamentoPorConta, fimGeral);
    try {
      total += await runWithWorkspace(row.workspace_id, () =>
        snapshotOneAccount({ sellerId: account.sellerId, refreshToken: account.refreshToken }, deadline)
      );
    } catch {
      // best-effort: segue para a próxima conta.
    }
  }
  if (puladas > 0) console.warn(`[rank-snapshot] ${puladas} conta(s) ficaram para a próxima passada.`);
  return total;
}
