export function ownsShopeeLease(
  lease: { token: string; expiresAt: number } | null,
  token: string | null,
  now: number
): boolean {
  return Boolean(lease && token && lease.token === token && lease.expiresAt > now);
}

export function nextShopeeEscrowOffset(offset: number, attempted: number, total: number): number {
  if (total <= 0) return 0;
  return (Math.max(0, offset) + Math.max(0, attempted)) % total;
}

export function shopeeEscrowSettled(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const metadata = (raw as { _sellercore?: unknown })._sellercore;
  return Boolean(metadata && typeof metadata === "object"
    && (metadata as { shopeeEscrowSettled?: unknown }).shopeeEscrowSettled === true);
}

export type ShopeeFailurePhase = "retryable_error" | "reauth_required" | "terminal_error";
const FAILURE_PREFIX: Record<Exclude<ShopeeFailurePhase, "retryable_error">, string> = {
  reauth_required: "[REAUTH_REQUIRED] ",
  terminal_error: "[TERMINAL_ERROR] ",
};

export function encodeShopeeSyncFailure(phase: ShopeeFailurePhase, message: string): string {
  return phase === "retryable_error" ? message : `${FAILURE_PREFIX[phase]}${message}`;
}

export function decodeShopeeSyncFailure(value: string | null): { phase: ShopeeFailurePhase; message: string | null } {
  if (!value) return { phase: "retryable_error", message: null };
  if (value.startsWith(FAILURE_PREFIX.reauth_required)) {
    return { phase: "reauth_required", message: value.slice(FAILURE_PREFIX.reauth_required.length) };
  }
  if (value.startsWith(FAILURE_PREFIX.terminal_error)) {
    return { phase: "terminal_error", message: value.slice(FAILURE_PREFIX.terminal_error.length) };
  }
  return { phase: "retryable_error", message: value };
}

export interface ShopeeCatalogIdentity { item_id?: number | string | null }
export interface ShopeeOrderIdentity { order_sn?: string | null }

/**
 * Um sweep só é reconciliável quando a lista e o detalhe formam uma bijeção.
 * Duplicatas, IDs ausentes ou inesperados tornam o snapshot ambíguo e impedem
 * tombstones, mesmo que a API tenha respondido HTTP 200.
 */
export function validateShopeeCatalogSnapshot(
  listedIds: Array<number | string>,
  details: ShopeeCatalogIdentity[]
): string[] {
  const listed = listedIds.map(String);
  const listedSet = new Set(listed);
  if (listedSet.size !== listed.length) throw new Error("Lista Shopee contém IDs duplicados; snapshot parcial preservado.");

  const returned = details.map((item) => String(item.item_id ?? "").trim());
  if (returned.some((id) => !id)) throw new Error("Shopee retornou produto sem item_id; snapshot parcial preservado.");
  const returnedSet = new Set(returned);
  if (returnedSet.size !== returned.length) throw new Error("Shopee retornou detalhes duplicados; snapshot parcial preservado.");
  if (returnedSet.size !== listedSet.size
    || [...listedSet].some((id) => !returnedSet.has(id))
    || [...returnedSet].some((id) => !listedSet.has(id))) {
    throw new Error("Shopee retornou detalhes parciais ou inesperados; catálogo anterior preservado.");
  }
  return returned;
}

export function validateShopeeOrderBatch(
  requestedIds: string[],
  details: ShopeeOrderIdentity[]
): void {
  validateIdentityBijection(requestedIds, details.map((item) => item.order_sn), "pedido Shopee");
}

function validateIdentityBijection(
  expectedValues: Array<string | number>,
  actualValues: Array<string | number | null | undefined>,
  label: string
): void {
  const expected = expectedValues.map((value) => String(value).trim());
  const actual = actualValues.map((value) => String(value ?? "").trim());
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  if (expected.some((id) => !id) || expectedSet.size !== expected.length
    || actual.some((id) => !id) || actualSet.size !== actual.length
    || expectedSet.size !== actualSet.size
    || [...expectedSet].some((id) => !actualSet.has(id))
    || [...actualSet].some((id) => !expectedSet.has(id))) {
    throw new Error(`Resposta de detalhe de ${label} parcial, duplicada ou inesperada; lote preservado.`);
  }
}

export type ShopeeOrderWindowAdvance =
  | { kind: "complete" }
  | { kind: "advance"; nextFromMs: number; nextToMs: number };

/**
 * Decide o próximo movimento da janela de pedidos ao fim de um passo: anda
 * para trás até o alvo e conclui ao alcançá-lo. O alvo de conta nova é o mês
 * vigente (ver `inicioDoMes.ts`) — sem aprofundamento retroativo além dele
 * (decisão da Ana, 27/08/2026).
 */
export function nextShopeeOrderWindow(input: {
  windowFromMs: number;
  targetFromMs: number;
  windowMs: number;
}): ShopeeOrderWindowAdvance {
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

/** Cerca toda leitura externa: lease válido antes e ainda válido ao voltar. */
export async function fencedShopeeExternalRead<T>(
  assertOwnership: () => Promise<unknown>,
  read: () => Promise<T>
): Promise<T> {
  await assertOwnership();
  const result = await read();
  await assertOwnership();
  return result;
}

/** Merge cria tanto o namespace pai quanto a flag e preserva outros metadados internos. */
export const SHOPEE_ESCROW_MARK_SQL = `
  COALESCE(raw, '{}'::jsonb)
  || jsonb_build_object(
       '_sellercore',
       COALESCE(raw -> '_sellercore', '{}'::jsonb)
       || jsonb_build_object('shopeeEscrowSettled', true)
     )
`.trim();
