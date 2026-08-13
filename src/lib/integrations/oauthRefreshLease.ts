import crypto from "crypto";
import { dbQuery, dbTransaction, type DbQuery } from "../db";

const DOMAIN = "sellercore/oauth-refresh-lease/fingerprint/v1\0";

export type OAuthRefreshClock = {
  sleep(ms: number): Promise<void>;
  random(): number;
};

const systemClock: OAuthRefreshClock = {
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: Math.random,
};

export function oauthRefreshFingerprint(refreshToken: string, secret = process.env.OAUTH_REFRESH_FINGERPRINT_SECRET): Buffer {
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error("OAUTH_REFRESH_FINGERPRINT_SECRET deve ter pelo menos 32 bytes.");
  }
  const key = crypto.createHmac("sha256", secret).update(DOMAIN).digest();
  return crypto.createHmac("sha256", key).update(refreshToken).digest();
}

type ClaimRow = {
  acquired: boolean;
  lease_state: "claimed" | "in_flight" | "indeterminate";
  lease_remaining_ms: number | string;
};

export interface OAuthRefreshLeaseOptions<TFresh, TRemote> {
  workspaceId: string;
  provider: string;
  refreshToken: string;
  leaseMs: number;
  readFresh(): Promise<TFresh | null>;
  refresh(signal: AbortSignal): Promise<TRemote>;
  finalize(query: DbQuery, remote: TRemote): Promise<TFresh | null>;
  finalizeInvalidGrant?(query: DbQuery, error: unknown): Promise<TFresh | null>;
  isInvalidGrant?(error: unknown): boolean;
  /** True somente quando há prova de que o provedor não recebeu/consumiu o token. */
  isSafeToRelease?(error: unknown): boolean;
  clock?: OAuthRefreshClock;
  ownerToken?: string;
  fingerprintSecret?: string;
  query?: typeof dbQuery;
  transaction?: typeof dbTransaction;
}

export async function coordinateOAuthRefresh<TFresh, TRemote>(options: OAuthRefreshLeaseOptions<TFresh, TRemote>): Promise<TFresh> {
  const clock = options.clock ?? systemClock;
  const query = options.query ?? dbQuery;
  const transaction = options.transaction ?? dbTransaction;
  const fingerprint = oauthRefreshFingerprint(options.refreshToken, options.fingerprintSecret);
  const owner = options.ownerToken ?? crypto.randomUUID();
  if (options.leaseMs < 1_000) throw new RangeError("OAuth refresh lease deve durar ao menos 1 segundo.");

  for (;;) {
    const [claim] = await query<ClaimRow>(
      "SELECT * FROM oauth_refresh_try_claim($1,$2,$3,$4,$5)",
      [options.workspaceId, options.provider, fingerprint, owner, options.leaseMs]
    );
    if (!claim) throw new Error("Banco não retornou o estado do lease OAuth.");
    if (claim.acquired) break;

    const fresh = await options.readFresh();
    if (fresh !== null) return fresh;
    if (claim.lease_state === "indeterminate") {
      throw new Error("Refresh OAuth anterior ficou indeterminado; reconecte a integração antes de reutilizar a credencial.");
    }
    const remaining = Math.max(0, Number(claim.lease_remaining_ms));
    await clock.sleep(Math.max(1, Math.min(remaining || 1, 40 + Math.floor(clock.random() * 80))));
  }

  const [started] = await query<{ oauth_refresh_mark_in_flight: boolean }>(
    "SELECT oauth_refresh_mark_in_flight($1,$2,$3,$4)",
    [options.workspaceId, options.provider, fingerprint, owner]
  );
  if (!started?.oauth_refresh_mark_in_flight) {
    const fresh = await options.readFresh();
    if (fresh !== null) return fresh;
    throw new Error("Ownership do lease OAuth foi perdido antes do request; refresh não iniciado.");
  }

  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), Math.max(1, options.leaseMs - 500));
  try {
    const remote = await options.refresh(abort.signal);
    const finalized = await finalizeOwned(transaction, options, fingerprint, owner, (q) => options.finalize(q, remote));
    if (finalized !== null) return finalized;
  } catch (error) {
    if (options.isInvalidGrant?.(error) && options.finalizeInvalidGrant) {
      const result = await finalizeOwned(transaction, options, fingerprint, owner, (q) => options.finalizeInvalidGrant!(q, error));
      if (result !== null) return result;
      const fresh = await options.readFresh();
      if (fresh !== null) return fresh;
      throw error;
    }
    if (options.isSafeToRelease?.(error)) {
      await callLeaseBoolean(query, "oauth_refresh_release_owned", options, fingerprint, owner);
    } else {
      await callLeaseBoolean(query, "oauth_refresh_mark_indeterminate", options, fingerprint, owner);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const fresh = await options.readFresh();
  if (fresh !== null) return fresh;
  throw new Error("Resultado OAuth obsoleto descartado; a credencial mudou durante o refresh.");
}

async function finalizeOwned<TFresh, TRemote>(
  transaction: typeof dbTransaction,
  options: OAuthRefreshLeaseOptions<TFresh, TRemote>,
  fingerprint: Buffer,
  owner: string,
  body: (query: DbQuery) => Promise<TFresh | null>
): Promise<TFresh | null> {
  return transaction(async (query) => {
    await query("SELECT oauth_refresh_grant_xact_lock($1,$2,$3)", [options.workspaceId, options.provider, fingerprint]);
    const rows = await query<{ owner_token: string; state: string }>(
      `SELECT owner_token, state FROM workspace_oauth_refresh_leases
        WHERE workspace_id=$1 AND provider=$2 AND grant_fingerprint=$3 FOR UPDATE`,
      [options.workspaceId, options.provider, fingerprint]
    );
    if (rows.length !== 1 || rows[0].owner_token !== owner || rows[0].state !== "in_flight") return null;
    const result = await body(query);
    await callLeaseBoolean(query, "oauth_refresh_release_owned", options, fingerprint, owner);
    return result;
  });
}

async function callLeaseBoolean<TFresh, TRemote>(
  query: DbQuery,
  fn: "oauth_refresh_release_owned" | "oauth_refresh_mark_indeterminate",
  options: OAuthRefreshLeaseOptions<TFresh, TRemote>,
  fingerprint: Buffer,
  owner: string
): Promise<boolean> {
  const rows = await query<Record<string, boolean>>(`SELECT ${fn}($1,$2,$3,$4)`, [
    options.workspaceId, options.provider, fingerprint, owner,
  ]);
  return rows[0]?.[fn] === true;
}
