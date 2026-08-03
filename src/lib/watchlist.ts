import { dbQuery, hasDb } from "./db";
import { optionalWorkspaceId } from "./workspaceScope";

// Watchlist de pesquisa (ADR-011). `workspace_rank_history` guarda a série de números;
// aqui fica a identidade do ASIN (título, foto, de qual busca veio) e a intenção da
// usuária (fixado/removido) — que é o que define a prioridade da foto diária no cron.
//
// Os dois pontos de captura (busca e cron) já pagavam a chamada de API: aqui só
// persistimos o que já veio na resposta. Custo zero de API.

/** Janela lida do histórico. Cobre o corte de 30d mesmo com fotos esparsas. */
const HISTORY_DAYS = 90;
/** Pontos desenhados na curva. */
const SERIES_DAYS = 30;
/** ASIN da Amazon: 10 alfanuméricos. Valida entrada antes de tocar o banco. */
const ASIN_RE = /^[A-Z0-9]{10}$/;

export function isValidAsin(asin: string): boolean {
  return ASIN_RE.test(asin);
}

export interface SeenItem {
  asin: string;
  title?: string;
  brand?: string;
  imageUrl?: string;
}

/**
 * Registra/atualiza a identidade dos ASINs monitorados.
 *
 * **Monitorar é opt-in.** A busca NÃO adiciona nada sozinha: uma pesquisa devolve 20
 * resultados e, sem escolha explícita, a lista chegaria a milhares em poucos dias —
 * inflando a foto diária com produtos que ninguém quer acompanhar.
 *
 * `searchTerm` chega quando a pessoa marca o anúncio a partir de uma busca (guarda de
 * onde ele veio). O cron passa sem termo: atualiza identidade sem mexer em
 * `last_seen_at` nem ressuscitar quem foi removido.
 */
export async function recordSeen(items: SeenItem[], searchTerm?: string): Promise<void> {
  const ws = optionalWorkspaceId();
  if (!ws || !hasDb()) return;
  const valid = items.filter((i) => i.asin && isValidAsin(i.asin));
  if (!valid.length) return;

  const term = searchTerm?.trim() || null;
  await dbQuery(
    `INSERT INTO workspace_watchlist
       (workspace_id, asin, title, brand, image_url, last_search_term, first_seen_at, last_seen_at)
     SELECT $1, a, t, b, img, $6, now(), now()
       FROM unnest($2::text[], $3::text[], $4::text[], $5::text[]) AS s(a, t, b, img)
     ON CONFLICT (workspace_id, asin) DO UPDATE SET
       -- COALESCE na direção do dado novo: o que veio preenchido vence, mas uma
       -- resposta sem título nunca apaga o título que já tínhamos.
       title            = COALESCE(EXCLUDED.title, workspace_watchlist.title),
       brand            = COALESCE(EXCLUDED.brand, workspace_watchlist.brand),
       image_url        = COALESCE(EXCLUDED.image_url, workspace_watchlist.image_url),
       last_search_term = COALESCE(EXCLUDED.last_search_term, workspace_watchlist.last_search_term),
       last_seen_at     = CASE WHEN EXCLUDED.last_search_term IS NULL
                               THEN workspace_watchlist.last_seen_at ELSE now() END,
       removed_at       = CASE WHEN EXCLUDED.last_search_term IS NULL
                               THEN workspace_watchlist.removed_at ELSE NULL END`,
    [
      ws,
      valid.map((i) => i.asin),
      valid.map((i) => i.title ?? null),
      valid.map((i) => i.brand ?? null),
      valid.map((i) => i.imageUrl ?? null),
      term,
    ]
  );
}

export interface RankPoint {
  date: string; // YYYY-MM-DD
  rank: number;
}

export interface WatchlistEntry {
  asin: string;
  title?: string;
  brand?: string;
  imageUrl?: string;
  lastSearchTerm?: string;
  firstSeenAt: string;
  pinned: boolean;
  category?: string;
  currentRank?: number;
  currentDate?: string;
  /** Positivo = melhorou de posição. undefined = ainda sem foto naquele corte. */
  delta7?: number;
  delta30?: number;
  /**
   * Variação entre as duas últimas fotos, sejam quais forem as datas. Existe porque
   * os cortes de 7 e 30 dias são estritos: um ASIN fotografado em 01/08 e 03/08 tem
   * movimento real e ficava com as duas colunas vazias — a informação existia e não
   * aparecia em lugar nenhum.
   */
  deltaUltima?: number;
  ultimaDe?: string;
  /** Posição na foto anterior — deixa o tooltip dizer "#23.238 → #28.853". */
  ultimaRank?: number;
  series: RankPoint[];
}

interface WatchRow {
  asin: string;
  title: string | null;
  brand: string | null;
  image_url: string | null;
  last_search_term: string | null;
  first_seen_at: Date;
  pinned: boolean;
}

/**
 * Variação estrita: só existe quando há foto **em ou antes** do corte. Um delta de 3
 * dias exibido na coluna "7 dias" seria mentira escaneável — melhor não mostrar nada.
 */
function deltaAt(series: RankPoint[], cutoff: string): number | undefined {
  if (series.length < 2) return undefined;
  const current = series[series.length - 1];
  // series vem em ordem crescente de data: o último ponto <= cutoff é a referência.
  let ref: RankPoint | undefined;
  for (const p of series) {
    if (p.date <= cutoff) ref = p;
    else break;
  }
  if (!ref || ref.date === current.date) return undefined;
  return ref.rank - current.rank;
}

export async function listWatchlist(): Promise<WatchlistEntry[]> {
  const ws = optionalWorkspaceId();
  if (!ws || !hasDb()) return [];

  const rows = await dbQuery<WatchRow>(
    `SELECT asin, title, brand, image_url, last_search_term, first_seen_at, pinned
       FROM workspace_watchlist
      WHERE workspace_id = $1 AND removed_at IS NULL
      ORDER BY pinned DESC, last_seen_at DESC`,
    [ws]
  );
  if (!rows.length) return [];

  const asins = rows.map((r) => r.asin);
  // Os cortes vêm do banco (mesma referência do CURRENT_DATE que grava captured_on),
  // para não escorregar por fuso entre a aplicação e o Postgres.
  const [{ cut7, cut30, window_start }] = await dbQuery<{ cut7: string; cut30: string; window_start: string }>(
    `SELECT (CURRENT_DATE - 7)::text  AS cut7,
            (CURRENT_DATE - 30)::text AS cut30,
            (CURRENT_DATE - $1::int)::text AS window_start`,
    [HISTORY_DAYS]
  );

  const history = await dbQuery<{ asin: string; captured_on: string; rank: number; category: string | null }>(
    `SELECT asin, captured_on::text AS captured_on, rank, category
       FROM workspace_rank_history
      WHERE workspace_id = $1 AND asin = ANY($2::text[]) AND captured_on >= $3::date
      ORDER BY asin, captured_on ASC`,
    [ws, asins, window_start]
  );

  const byAsin = new Map<string, { captured_on: string; rank: number; category: string | null }[]>();
  for (const h of history) {
    const arr = byAsin.get(h.asin) ?? [];
    arr.push(h);
    byAsin.set(h.asin, arr);
  }

  return rows.map((r) => {
    const points = byAsin.get(r.asin) ?? [];
    const full: RankPoint[] = points.map((p) => ({ date: p.captured_on, rank: p.rank }));
    const current = points[points.length - 1];
    return {
      asin: r.asin,
      title: r.title ?? undefined,
      brand: r.brand ?? undefined,
      imageUrl: r.image_url ?? undefined,
      lastSearchTerm: r.last_search_term ?? undefined,
      firstSeenAt: r.first_seen_at.toISOString(),
      pinned: r.pinned,
      category: current?.category ?? undefined,
      currentRank: current?.rank,
      currentDate: current?.captured_on,
      delta7: deltaAt(full, cut7),
      delta30: deltaAt(full, cut30),
      // Duas últimas fotos, sem exigir corte — é o que sempre tem dado quando há série.
      deltaUltima: full.length >= 2 ? full[full.length - 2].rank - full[full.length - 1].rank : undefined,
      ultimaDe: full.length >= 2 ? full[full.length - 2].date : undefined,
      ultimaRank: full.length >= 2 ? full[full.length - 2].rank : undefined,
      // A curva mostra os últimos 30 dias; a janela maior existe só para os cortes.
      series: full.filter((p) => p.date >= cut30).slice(-SERIES_DAYS),
    };
  });
}

/** Termos já pesquisados, do mais recente para o mais antigo. */
export async function listSearchTerms(limit = 12): Promise<string[]> {
  const ws = optionalWorkspaceId();
  if (!ws || !hasDb()) return [];
  const rows = await dbQuery<{ term: string }>(
    `SELECT last_search_term AS term
       FROM workspace_watchlist
      WHERE workspace_id = $1 AND removed_at IS NULL AND last_search_term IS NOT NULL
      GROUP BY last_search_term
      ORDER BY max(last_seen_at) DESC
      LIMIT $2`,
    [ws, limit]
  );
  return rows.map((r) => r.term);
}

/**
 * Dentre estes ASINs, quais merecem uma foto nova agora: a de hoje não existe ou tem
 * mais de `minutos` de idade. É o freio da atualização ao vivo — abrir a página cinco
 * vezes seguidas gera uma chamada à Amazon, não cinco.
 */
export async function asinsDesatualizados(asins: string[], minutos: number): Promise<string[]> {
  const ws = optionalWorkspaceId();
  const unique = [...new Set(asins.filter(isValidAsin))];
  if (!ws || !hasDb() || !unique.length) return [];
  const rows = await dbQuery<{ asin: string }>(
    `SELECT asin FROM workspace_rank_history
      WHERE workspace_id = $1 AND asin = ANY($2::text[])
        AND captured_on = CURRENT_DATE
        AND updated_at > now() - make_interval(mins => $3)`,
    [ws, unique, minutos]
  );
  const frescos = new Set(rows.map((r) => r.asin));
  return unique.filter((a) => !frescos.has(a));
}

/** Quais destes ASINs já estão sendo monitorados — para a busca marcar o botão. */
export async function listMonitored(asins: string[]): Promise<Set<string>> {
  const ws = optionalWorkspaceId();
  const unique = [...new Set(asins.filter(isValidAsin))];
  if (!ws || !hasDb() || !unique.length) return new Set();
  const rows = await dbQuery<{ asin: string }>(
    `SELECT asin FROM workspace_watchlist
      WHERE workspace_id = $1 AND asin = ANY($2::text[]) AND removed_at IS NULL`,
    [ws, unique]
  );
  return new Set(rows.map((r) => r.asin));
}

/** Corta texto vindo do cliente antes de gravar — nada de campo sem limite no banco. */
function limita(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s ? s.slice(0, max) : undefined;
}

/** Passa a monitorar um anúncio. Chamado pelo botão da busca. */
export async function monitorar(
  asin: string,
  dados: { title?: unknown; brand?: unknown; imageUrl?: unknown; searchTerm?: unknown }
): Promise<void> {
  if (!isValidAsin(asin)) return;
  await recordSeen(
    [
      {
        asin,
        title: limita(dados.title, 400),
        brand: limita(dados.brand, 120),
        imageUrl: limita(dados.imageUrl, 600),
      },
    ],
    limita(dados.searchTerm, 120)
  );
}

export async function setPinned(asin: string, pinned: boolean): Promise<void> {
  const ws = optionalWorkspaceId();
  if (!ws || !hasDb() || !isValidAsin(asin)) return;
  await dbQuery(`UPDATE workspace_watchlist SET pinned = $3 WHERE workspace_id = $1 AND asin = $2`, [ws, asin, pinned]);
}

export async function setRemoved(asin: string, removed: boolean): Promise<void> {
  const ws = optionalWorkspaceId();
  if (!ws || !hasDb() || !isValidAsin(asin)) return;
  await dbQuery(
    `UPDATE workspace_watchlist
        SET removed_at = CASE WHEN $3::boolean THEN now() ELSE NULL END,
            -- Remover também desfixa: senão o ASIN volta furando a fila da foto diária.
            pinned = CASE WHEN $3::boolean THEN false ELSE pinned END
      WHERE workspace_id = $1 AND asin = $2`,
    [ws, asin, removed]
  );
}

/**
 * ASINs a fotografar hoje, já na ordem de prioridade (fixados primeiro). O cron
 * intercala os produtos da própria conta antes de aplicar o teto.
 */
export async function watchlistForSnapshot(): Promise<{ pinned: string[]; rest: string[] }> {
  const ws = optionalWorkspaceId();
  if (!ws || !hasDb()) return { pinned: [], rest: [] };
  const rows = await dbQuery<{ asin: string; pinned: boolean }>(
    `SELECT asin, pinned
       FROM workspace_watchlist
      WHERE workspace_id = $1 AND removed_at IS NULL
      ORDER BY pinned DESC, last_seen_at DESC`,
    [ws]
  );
  return {
    pinned: rows.filter((r) => r.pinned).map((r) => r.asin),
    rest: rows.filter((r) => !r.pinned).map((r) => r.asin),
  };
}
