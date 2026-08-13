import type { TiktokShop } from "../tiktokStore";

export type TiktokSyncPhase = "first_sync" | "partial" | "ready" | "retryable_error" | "reauth_required" | "unavailable";

export function deriveTiktokSyncPhase(input: {
  available: boolean;
  status?: "pending" | "syncing" | "complete" | "error";
  hasCoverage?: boolean;
  hasSuccess?: boolean;
  hasFinancialBacklog?: boolean;
}): TiktokSyncPhase {
  if (!input.available) return "unavailable";
  if (input.status === "error") return "retryable_error";
  if (input.status === "complete") return input.hasFinancialBacklog ? "partial" : "ready";
  return input.hasCoverage || input.hasSuccess ? "partial" : "first_sync";
}

export type TiktokConnectionErrorCode = "REAUTH_REQUIRED";

export class TiktokConnectionError extends Error {
  readonly code: TiktokConnectionErrorCode;

  constructor(code: TiktokConnectionErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "TiktokConnectionError";
  }
}

export const TIKTOK_PROVIDER = "tiktok_shop";

export function parseTiktokTaxRate(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) return null;
  return value;
}

export type TiktokTaxRateSetting =
  | { valid: true; value: number | null }
  | { valid: false };

/** `null` limpa a configuracao; strings/vazio/ausencia nunca sofrem coercao. */
export function parseTiktokTaxRateSetting(body: unknown): TiktokTaxRateSetting {
  if (!body || typeof body !== "object" || !("taxRate" in body)) return { valid: false };
  const value = (body as { taxRate?: unknown }).taxRate;
  if (value === null) return { valid: true, value: null };
  const parsed = parseTiktokTaxRate(value);
  return parsed == null ? { valid: false } : { valid: true, value: parsed };
}

export function tiktokCostId(connectionId: string, productId: string, sku: string | null): string {
  return `tiktok:${connectionId}:${sku ? `sku:${sku}` : `item:${productId}`}`;
}

export function tiktokConnectionId(shopId: string): string {
  return `${TIKTOK_PROVIDER}:${shopId}`;
}

export function parseTiktokConnectionId(value: string): { shopId: string } | null {
  const prefix = `${TIKTOK_PROVIDER}:`;
  if (!value.startsWith(prefix)) return null;
  const shopId = value.slice(prefix.length);
  return shopId && !shopId.includes(":") ? { shopId } : null;
}

export function resolveTiktokShop(shops: TiktokShop[], connectionId?: string | null): TiktokShop | undefined {
  if (connectionId) {
    const parsed = parseTiktokConnectionId(connectionId);
    return parsed ? shops.find((shop) => shop.shopId === parsed.shopId) : undefined;
  }
  return shops.length === 1 ? shops[0] : undefined;
}

export async function runTiktokCandidates<T, R>(
  candidates: T[], run: (candidate: T) => Promise<R>
): Promise<Array<R | { failed: true; reason: string }>> {
  return Promise.all(candidates.map(async (candidate) => {
    try { return await run(candidate); }
    catch (error) {
      return { failed: true as const, reason: error instanceof Error ? error.message : "Erro desconhecido" };
    }
  }));
}
