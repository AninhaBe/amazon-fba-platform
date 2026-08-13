import crypto from "crypto";

const localSingleflightKey = crypto.randomBytes(32);

const refreshesInFlight = new Map<string, Promise<unknown>>();

export function tiktokRefreshGrantKey(workspaceId: string, refreshToken: string): string {
  return `${workspaceId}:${crypto.createHmac("sha256", localSingleflightKey).update(refreshToken).digest("hex")}`;
}

/** Deduplica uma rotação de credencial por workspace+loja no processo atual. */
export function deduplicateTiktokRefresh<T>(key: string, refresh: () => Promise<T>): Promise<T> {
  const existing = refreshesInFlight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const pending = refresh().finally(() => {
    if (refreshesInFlight.get(key) === pending) refreshesInFlight.delete(key);
  });
  refreshesInFlight.set(key, pending);
  return pending;
}

export async function persistTiktokAuthorizationAtomically<Q, S>(
  shops: readonly S[],
  transaction: (body: (query: Q) => Promise<void>) => Promise<void>,
  persist: (query: Q, shop: S) => Promise<void>
): Promise<void> {
  await transaction(async (query) => {
    for (const shop of shops) await persist(query, shop);
  });
}
