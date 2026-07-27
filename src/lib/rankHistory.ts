import { dbQuery } from "./db";
import { optionalWorkspaceId } from "./workspaceScope";

// Histórico de ranking (ADR-009). A Amazon não guarda o passado, então capturamos
// snapshots ao longo do tempo. A captura na busca é de graça: o rank já vem na
// resposta da Catalog API — aqui só persistimos, 1 linha por dia por ASIN.

interface RankItem {
  asin: string;
  salesRank?: number;
  salesRankCategory?: string;
}

export async function recordRanks(items: RankItem[]): Promise<void> {
  const ws = optionalWorkspaceId();
  if (!ws) return;
  const withRank = items.filter((i) => i.asin && typeof i.salesRank === "number");
  if (!withRank.length) return;
  // Uma única query (unnest) faz o upsert de todos os resultados da página.
  await dbQuery(
    `INSERT INTO workspace_rank_history (workspace_id, asin, captured_on, rank, category, updated_at)
     SELECT $1, a, CURRENT_DATE, r, c, now()
       FROM unnest($2::text[], $3::int[], $4::text[]) AS t(a, r, c)
     ON CONFLICT (workspace_id, asin, captured_on)
     DO UPDATE SET rank = EXCLUDED.rank, category = EXCLUDED.category, updated_at = now()`,
    [ws, withRank.map((i) => i.asin), withRank.map((i) => i.salesRank), withRank.map((i) => i.salesRankCategory ?? null)]
  );
}

export interface RankDelta {
  asin: string;
  current: number;
  currentDate: string;
  previous?: number;
  previousDate?: string;
  delta?: number; // previous − current (positivo = melhorou de posição / subiu)
}

// Variação por ASIN: rank mais recente vs. a foto anterior (dia diferente). Para a
// exibição futura das setinhas ↑/↓ na /pesquisa.
export async function getRankDeltas(asins: string[]): Promise<Record<string, RankDelta>> {
  const ws = optionalWorkspaceId();
  const unique = [...new Set(asins.filter(Boolean))];
  if (!ws || !unique.length) return {};
  const rows = await dbQuery<{ asin: string; captured_on: string; rank: number }>(
    `SELECT asin, captured_on, rank FROM workspace_rank_history
      WHERE workspace_id=$1 AND asin = ANY($2::text[])
      ORDER BY asin, captured_on DESC`,
    [ws, unique]
  );
  const byAsin = new Map<string, { captured_on: string; rank: number }[]>();
  for (const r of rows) {
    const arr = byAsin.get(r.asin) ?? [];
    arr.push(r);
    byAsin.set(r.asin, arr);
  }
  const out: Record<string, RankDelta> = {};
  for (const [asin, series] of byAsin) {
    const current = series[0];
    const prev = series.find((s) => s.captured_on !== current.captured_on);
    out[asin] = {
      asin,
      current: current.rank,
      currentDate: current.captured_on,
      previous: prev?.rank,
      previousDate: prev?.captured_on,
      delta: prev ? prev.rank - current.rank : undefined,
    };
  }
  return out;
}
