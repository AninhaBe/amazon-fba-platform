import { inicioDoMesVigente } from "./inicioDoMes";

const DAY = 86_400_000;

/** Janela do cursor de pedidos (15 dias mantém a resposta pequena e o passo curto). */
export const TIKTOK_SYNC_WINDOW_DAYS = 15;

/**
 * Semente ÚNICA do estado de sync — usada pelo callback (tiktokStore) e pelo
 * ensureSyncRow (tiktokSync). Antes eram dois literais soltos que podiam
 * divergir em silêncio. O alvo de conta nova é o mês vigente (decisão da Ana,
 * 27/08/2026) — sem aprofundamento retroativo em background.
 */
export function tiktokSeedSyncWindow(nowMs: number): { targetFromMs: number; cursorFromMs: number } {
  const targetFromMs = inicioDoMesVigente(new Date(nowMs)).getTime();
  return {
    targetFromMs,
    cursorFromMs: Math.max(targetFromMs, nowMs - TIKTOK_SYNC_WINDOW_DAYS * DAY),
  };
}

export type TiktokOrderWindowAdvance =
  | { kind: "complete" }
  | { kind: "advance"; nextFromMs: number; nextToMs: number };

/**
 * Decide o próximo movimento da janela de pedidos ao fechar uma janela: anda
 * para trás até o alvo e conclui ao alcançá-lo.
 */
export function nextTiktokOrderWindow(input: {
  windowFromMs: number;
  targetFromMs: number;
  windowMs: number;
}): TiktokOrderWindowAdvance {
  if (input.windowFromMs > input.targetFromMs) {
    const nextToMs = input.windowFromMs;
    return {
      kind: "advance",
      nextToMs,
      nextFromMs: Math.max(input.targetFromMs, nextToMs - input.windowMs),
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

// TIKTOK_STATEMENT_MARK_SQL morreu com a ADR-026 R2: liquidação e evidência
// viraram colunas de workspace_channel_orders — estado do produto nunca mais
// vive dentro do raw.
