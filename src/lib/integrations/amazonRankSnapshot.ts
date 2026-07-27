import { dbQuery, hasDb } from "../db";
import { runWithWorkspace, optionalWorkspaceId } from "../workspaceScope";
import { runWithAccount, type AccountCtx } from "../accountContext";
import { getAccount } from "../accountStore";
import { getInventory } from "../inventory";
import { spapiFetch, defaultMarketplaceId } from "../spapi";
import { recordRanks } from "../rankHistory";

// Foto diária de ranking (ADR-009). Para cada conta ativa, fotografa o rank de
// (1) todos os produtos da conta (FBA) + (2) a auto-watchlist (ASINs que já entraram
// no histórico via busca). Assim o histórico engrossa sozinho, sem depender de a
// usuária buscar. Best-effort: falha nunca derruba o cron.

const PROVIDER = "amazon";
const CONNECTION_PREFIX = "amazon:";
const MAX_ASINS = 150; // teto por conta/dia (rate limit da SP-API)
const CONCURRENCY = 3;

interface RankNode {
  title?: string;
  rank: number;
}

// Foto enxuta: só salesRanks (nada de imagem/dimensão). Mesma seleção do que a
// /pesquisa mostra (grupo amplo com fallback pra classificação).
async function fetchRank(asin: string, marketplaceId: string): Promise<{ rank: number; category?: string } | null> {
  const data = await spapiFetch<{ salesRanks?: { classificationRanks?: RankNode[]; displayGroupRanks?: RankNode[] }[] }>(
    `/catalog/2022-04-01/items/${encodeURIComponent(asin)}`,
    { query: { marketplaceIds: marketplaceId, includedData: "salesRanks" } }
  );
  const ranks = data.salesRanks?.[0];
  const best = ranks?.displayGroupRanks?.[0] ?? ranks?.classificationRanks?.[0];
  return best ? { rank: best.rank, category: best.title } : null;
}

async function mapLimit<T>(items: T[], limit: number, fn: (t: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}

async function watchlistAsins(): Promise<string[]> {
  const ws = optionalWorkspaceId();
  if (!ws) return [];
  const rows = await dbQuery<{ asin: string }>(
    `SELECT DISTINCT asin FROM workspace_rank_history WHERE workspace_id = $1`,
    [ws]
  );
  return rows.map((r) => r.asin);
}

async function snapshotOneAccount(account: AccountCtx): Promise<number> {
  return runWithAccount(account, async () => {
    const marketplaceId = defaultMarketplaceId();
    const [inventory, watch] = await Promise.all([
      getInventory().catch(() => []),
      watchlistAsins().catch(() => []),
    ]);
    const mine = inventory.map((i) => i.asin).filter((a): a is string => !!a);
    const asins = [...new Set([...mine, ...watch])].slice(0, MAX_ASINS);

    const captured: { asin: string; salesRank?: number; salesRankCategory?: string }[] = [];
    await mapLimit(asins, CONCURRENCY, async (asin) => {
      try {
        const r = await fetchRank(asin, marketplaceId);
        if (r) captured.push({ asin, salesRank: r.rank, salesRankCategory: r.category });
      } catch {
        // ASIN que falhar é pulado — não derruba a passada.
      }
    });

    if (captured.length) await recordRanks(captured);
    return captured.length;
  });
}

export async function runScheduledRankSnapshot(limit = 5): Promise<number> {
  if (!hasDb()) return 0;
  const rows = await dbQuery<{ workspace_id: string; connection_id: string }>(
    `SELECT workspace_id, connection_id
       FROM workspace_marketplace_syncs
      WHERE provider = $1
      ORDER BY updated_at DESC
      LIMIT $2`,
    [PROVIDER, limit]
  );

  let total = 0;
  for (const row of rows) {
    const sellerId = row.connection_id.startsWith(CONNECTION_PREFIX)
      ? row.connection_id.slice(CONNECTION_PREFIX.length)
      : row.connection_id;
    const account = await getAccount(sellerId);
    if (!account?.refreshToken) continue;
    try {
      total += await runWithWorkspace(row.workspace_id, () =>
        snapshotOneAccount({ sellerId: account.sellerId, refreshToken: account.refreshToken })
      );
    } catch {
      // best-effort: segue para a próxima conta.
    }
  }
  return total;
}
