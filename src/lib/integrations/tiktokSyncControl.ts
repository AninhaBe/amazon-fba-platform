const DAY = 86_400_000;

/** Fase 1 do backfill: a janela que o vendedor vê primeiro, minutos após conectar. */
export const TIKTOK_RECENT_DAYS = 30;
/** Janela do cursor de pedidos (15 dias mantém a resposta pequena e o passo curto). */
export const TIKTOK_SYNC_WINDOW_DAYS = 15;

/**
 * Fase 2: alvo total do histórico. 60 dias até segunda ordem — a extensão para
 * 12 meses depende da decisão de custo do banco. `TIKTOK_HISTORY_DAYS` permite
 * mudar o alvo sem deploy de código.
 */
export function tiktokHistoryDays(raw: string | undefined = process.env.TIKTOK_HISTORY_DAYS): number {
  const dias = Number(raw ?? "");
  return Number.isFinite(dias) && dias >= TIKTOK_RECENT_DAYS ? dias : 60;
}

/**
 * Semente ÚNICA do estado de sync — usada pelo callback (tiktokStore) e pelo
 * ensureSyncRow (tiktokSync). Antes eram dois literais soltos de 60d/15d que
 * podiam divergir em silêncio.
 */
export function tiktokSeedSyncWindow(nowMs: number): { targetFromMs: number; cursorFromMs: number } {
  const targetFromMs = nowMs - Math.min(TIKTOK_RECENT_DAYS, tiktokHistoryDays()) * DAY;
  return {
    targetFromMs,
    cursorFromMs: Math.max(targetFromMs, nowMs - TIKTOK_SYNC_WINDOW_DAYS * DAY),
  };
}

export type TiktokOrderWindowAdvance =
  | { kind: "complete" }
  | { kind: "advance"; nextFromMs: number; nextToMs: number }
  | { kind: "extend"; targetFromMs: number; nextFromMs: number; nextToMs: number };

/**
 * Decide o próximo movimento da janela de pedidos ao fechar uma janela.
 * Fase 1 termina quando o cursor alcança o alvo imediato (30 dias); se o ponto
 * mais antigo já coberto ainda não alcança o histórico completo, o alvo é
 * estendido para trás ("extend") e o backfill continua nas mesmas janelas.
 * A extensão olha o ponto mais antigo COBERTO (não o alvo), então uma loja com
 * histórico completo nunca reabre por engano.
 */
export function nextTiktokOrderWindow(input: {
  windowFromMs: number;
  targetFromMs: number;
  coveredFromMs: number | null;
  historyFloorMs: number;
  windowMs: number;
  toleranceMs: number;
}): TiktokOrderWindowAdvance {
  if (input.windowFromMs > input.targetFromMs) {
    const nextToMs = input.windowFromMs;
    return {
      kind: "advance",
      nextToMs,
      nextFromMs: Math.max(input.targetFromMs, nextToMs - input.windowMs),
    };
  }
  const oldestCoveredMs = Math.min(input.windowFromMs, input.coveredFromMs ?? Number.POSITIVE_INFINITY);
  if (oldestCoveredMs > input.historyFloorMs + input.toleranceMs) {
    return {
      kind: "extend",
      targetFromMs: input.historyFloorMs,
      nextToMs: oldestCoveredMs,
      nextFromMs: Math.max(input.historyFloorMs, oldestCoveredMs - input.windowMs),
    };
  }
  return { kind: "complete" };
}

export interface LeaseFence {
  token: string;
  expiresAt: number;
}

/** Espelho puro da condicao usada nos UPDATEs SQL protegidos pelo lease. */
export function ownsLease(
  lease: LeaseFence | null,
  token: string | null,
  now: number
): boolean {
  return Boolean(lease && token && lease.token === token && lease.expiresAt > now);
}

/** Recusa ciclos da API sem perder o ultimo cursor persistivel. */
export function acceptPageToken(seen: ReadonlySet<string>, next: string | null): boolean {
  return next === null || !seen.has(next);
}

export function hasSyncBudget(deadline: number, now: number): boolean {
  return now < deadline;
}

export class TiktokLeaseLostError extends Error {
  constructor() { super("Lease TikTok perdido durante chamada externa."); this.name = "TiktokLeaseLostError"; }
}

export function requireTiktokLeaseRow(rows: readonly unknown[]): void {
  if (rows.length === 0) throw new TiktokLeaseLostError();
}

/** Mantém a verificação do fence dentro da mesma transação da mutação. */
export async function fencedTiktokMutation<Q, T>(
  transaction: (body: (query: Q) => Promise<T>) => Promise<T>,
  owns: (query: Q) => Promise<boolean>,
  write: (query: Q) => Promise<T>
): Promise<T> {
  return transaction(async (query) => {
    if (!await owns(query)) throw new TiktokLeaseLostError();
    return write(query);
  });
}

export async function fencedTiktokExternalRead<T>(
  assertOwnership: () => Promise<unknown>,
  read: () => Promise<T>
): Promise<T> {
  await assertOwnership();
  const result = await read();
  await assertOwnership();
  return result;
}

export function validateTiktokOrderBatch(
  requestedIds: string[],
  details: Array<{ id?: string | null }>
): void {
  const expected = requestedIds.map((id) => String(id).trim());
  const actual = details.map((order) => String(order.id ?? "").trim());
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  if (expected.some((id) => !id) || expectedSet.size !== expected.length
    || actual.some((id) => !id) || actualSet.size !== actual.length
    || expectedSet.size !== actualSet.size
    || [...expectedSet].some((id) => !actualSet.has(id))
    || [...actualSet].some((id) => !expectedSet.has(id))) {
    throw new Error("Resposta de detalhe de pedido TikTok parcial, duplicada ou inesperada; lote preservado.");
  }
}

/** Cria o namespace pai quando ausente e preserva outros metadados internos. */
export const TIKTOK_STATEMENT_MARK_SQL = `COALESCE(raw, '{}'::jsonb)
  || jsonb_build_object(
    '_sellercore',
    COALESCE(raw -> '_sellercore', '{}'::jsonb)
      || jsonb_build_object('statementSettled', true)
  )`;
