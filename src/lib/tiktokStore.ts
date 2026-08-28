import fs from "fs/promises";
import path from "path";
import { dataFile } from "./dataDir";
import { hasDb, dbQuery, dbTransaction } from "./db";
import { currentWorkspaceId } from "./workspaceScope";
import { protectSecret, revealSecret } from "./integrations/secrets";
import { epochToIso, refreshAccessToken } from "./tiktok";
import { TiktokConnectionError } from "./integrations/tiktokContract";
import { deduplicateTiktokRefresh, tiktokRefreshGrantKey } from "./integrations/tiktokRefreshControl";
import { coordinateOAuthRefresh, oauthRefreshFingerprint } from "./integrations/oauthRefreshLease";
import { updateTiktokShopTaxRate } from "./integrations/tiktokSettings";
import { assertGlobalTiktokShopOwnership } from "./integrations/tiktokOwnership";
import { tiktokSeedSyncWindow } from "./integrations/tiktokSyncControl";
export { deduplicateTiktokRefresh } from "./integrations/tiktokRefreshControl";
export { resolveTiktokShop, TiktokConnectionError } from "./integrations/tiktokContract";

// Lojas TikTok Shop conectadas (tokens + cipher). Postgres quando DATABASE_URL
// existe; senão, <DATA_DIR>/tiktok.json (dev local).

const FILE = dataFile("tiktok.json");

export interface TiktokShop {
  shopId: string;
  shopName?: string;
  shopCipher?: string;
  region?: string;
  accessToken: string;
  refreshToken: string;
  accessExpiresAt?: string;
  refreshExpiresAt?: string;
  connectedAt: string;
  taxRate?: number;
}

interface Row {
  shop_id: string;
  shop_name: string | null;
  shop_cipher: string | null;
  region: string | null;
  access_token: string;
  refresh_token: string;
  access_expires_at: Date | string | null;
  refresh_expires_at: Date | string | null;
  connected_at: Date | string;
  tax_rate?: string | number | null;
  ownership_count?: number;
}

function rowToShop(r: Row): TiktokShop {
  return {
    shopId: r.shop_id,
    shopName: r.shop_name ?? undefined,
    shopCipher: r.shop_cipher ?? undefined,
    region: r.region ?? undefined,
    accessToken: revealSecret(r.access_token) ?? "",
    refreshToken: revealSecret(r.refresh_token) ?? "",
    accessExpiresAt: r.access_expires_at ? new Date(r.access_expires_at).toISOString() : undefined,
    refreshExpiresAt: r.refresh_expires_at ? new Date(r.refresh_expires_at).toISOString() : undefined,
    connectedAt: new Date(r.connected_at).toISOString(),
    taxRate: r.tax_rate == null ? undefined : Number(r.tax_rate),
  };
}

type StoredShop = TiktokShop & { workspaceId?: string };

async function readAll(): Promise<Record<string, StoredShop>> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8"));
  } catch {
    return {};
  }
}

async function writeAll(data: Record<string, StoredShop>): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(data, null, 2), "utf8");
}

export async function getTiktokShops(): Promise<TiktokShop[]> {
  const workspaceId = currentWorkspaceId();
  if (hasDb()) {
    const rows = await dbQuery<Row>(
      `SELECT shop.shop_id, shop.shop_name, shop.shop_cipher, shop.region, shop.access_token, shop.refresh_token,
              shop.access_expires_at, shop.refresh_expires_at, shop.connected_at, shop.tax_rate,
              (SELECT COUNT(DISTINCT owner.workspace_id)::int FROM workspace_tiktok_shops owner
                WHERE owner.shop_id=shop.shop_id) AS ownership_count
         FROM workspace_tiktok_shops shop WHERE shop.workspace_id = $1 ORDER BY shop.shop_id`,
      [workspaceId]
    );
    if (rows.some((row) => (row.ownership_count ?? 0) !== 1)) {
      await assertGlobalTiktokShopOwnership(dbQuery, workspaceId, rows.map((row) => row.shop_id));
    }
    return rows.map(rowToShop);
  }
  return Object.values(await readAll())
    .filter((shop) => shop.workspaceId === workspaceId)
    .sort((a, b) => a.shopId.localeCompare(b.shopId));
}

export async function setTiktokShopTaxRate(shopId: string, taxRate: number | null): Promise<void> {
  const workspaceId = currentWorkspaceId();
  if (hasDb()) {
    if (!await updateTiktokShopTaxRate(dbQuery, workspaceId, shopId, taxRate)) {
      throw new Error("Loja TikTok Shop nao encontrada.");
    }
    return;
  }
  const all = await readAll();
  const key = `${workspaceId}:${shopId}`;
  if (!all[key]) throw new Error("Loja TikTok Shop nao encontrada.");
  if (taxRate === null) delete all[key].taxRate;
  else all[key] = { ...all[key], taxRate };
  await writeAll(all);
}

export async function saveTiktokShop(
  s: Omit<TiktokShop, "connectedAt"> & { connectedAt?: string }
): Promise<TiktokShop> {
  const workspaceId = currentWorkspaceId();
  if (hasDb()) {
    const rows = await dbTransaction(async (query) => {
      await assertGlobalTiktokShopOwnership(query, workspaceId, [s.shopId], true);
      return query<Row>(
      `INSERT INTO workspace_tiktok_shops
         (workspace_id, shop_id, shop_name, shop_cipher, region, access_token, refresh_token,
          access_expires_at, refresh_expires_at, connected_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
       ON CONFLICT (workspace_id, shop_id) DO UPDATE SET
         shop_name          = COALESCE(EXCLUDED.shop_name, workspace_tiktok_shops.shop_name),
         shop_cipher        = COALESCE(EXCLUDED.shop_cipher, workspace_tiktok_shops.shop_cipher),
         region             = COALESCE(EXCLUDED.region, workspace_tiktok_shops.region),
         access_token       = EXCLUDED.access_token,
         refresh_token      = EXCLUDED.refresh_token,
         access_expires_at  = EXCLUDED.access_expires_at,
         refresh_expires_at = EXCLUDED.refresh_expires_at,
         connected_at       = now()
       RETURNING shop_id, shop_name, shop_cipher, region, access_token, refresh_token,
                 access_expires_at, refresh_expires_at, connected_at`,
      [
        workspaceId,
        s.shopId,
        s.shopName ?? null,
        s.shopCipher ?? null,
        s.region ?? null,
        protectSecret(s.accessToken),
        protectSecret(s.refreshToken),
        s.accessExpiresAt ?? null,
        s.refreshExpiresAt ?? null,
      ]
      );
    });
    return rowToShop(rows[0]);
  }
  const all = await readAll();
  const key = `${workspaceId}:${s.shopId}`;
  const merged: StoredShop = { ...all[key], ...s, workspaceId, connectedAt: new Date().toISOString() };
  all[key] = merged;
  await writeAll(all);
  return merged;
}

/** Persiste todas as lojas de um grant OAuth e seus checkpoints como uma unidade. */
export async function saveTiktokAuthorization(
  shops: Array<Omit<TiktokShop, "connectedAt"> & { connectedAt?: string }>
): Promise<void> {
  const workspaceId = currentWorkspaceId();
  const now = new Date();
  // Semente única com o tiktokSync: conta nova importa o mês vigente.
  const seed = tiktokSeedSyncWindow(now.getTime());
  const targetFrom = new Date(seed.targetFromMs).toISOString();
  const cursorFrom = new Date(seed.cursorFromMs).toISOString();
  if (hasDb()) {
    await dbTransaction(async (query) => {
      await assertGlobalTiktokShopOwnership(query, workspaceId, shops.map((shop) => shop.shopId), true);
      const previous = await query<{ refresh_token: string }>(
        `SELECT DISTINCT refresh_token FROM workspace_tiktok_shops
          WHERE workspace_id=$1 AND shop_id=ANY($2::text[])`,
        [workspaceId, shops.map((shop) => shop.shopId)]
      );
      const fingerprints = new Map<string, Buffer>();
      for (const row of previous) {
        const token = revealSecret(row.refresh_token);
        if (token) fingerprints.set(oauthRefreshFingerprint(token).toString("hex"), oauthRefreshFingerprint(token));
      }
      for (const shop of shops) {
        const fingerprint = oauthRefreshFingerprint(shop.refreshToken);
        fingerprints.set(fingerprint.toString("hex"), fingerprint);
      }
      for (const fingerprint of [...fingerprints.values()].sort(Buffer.compare)) {
        await query("SELECT oauth_refresh_grant_xact_lock($1,'tiktok_shop',$2)", [workspaceId, fingerprint]);
      }
      // O callback relê depois do lock: um finalize que venceu a corrida não pode
      // ser sobrescrito a partir de um snapshot anterior à seção crítica.
      await query(`SELECT shop_id FROM workspace_tiktok_shops
        WHERE workspace_id=$1 AND shop_id=ANY($2::text[]) FOR UPDATE`,
        [workspaceId, shops.map((shop) => shop.shopId)]);
      for (const shop of shops) {
        await query(
          `INSERT INTO workspace_tiktok_shops
             (workspace_id, shop_id, shop_name, shop_cipher, region, access_token, refresh_token,
              access_expires_at, refresh_expires_at, connected_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
           ON CONFLICT (workspace_id, shop_id) DO UPDATE SET
             shop_name=EXCLUDED.shop_name, shop_cipher=EXCLUDED.shop_cipher, region=EXCLUDED.region,
             access_token=EXCLUDED.access_token, refresh_token=EXCLUDED.refresh_token,
             access_expires_at=EXCLUDED.access_expires_at, refresh_expires_at=EXCLUDED.refresh_expires_at,
             connected_at=now()`,
          [workspaceId, shop.shopId, shop.shopName ?? null, shop.shopCipher ?? null, shop.region ?? null,
            protectSecret(shop.accessToken), protectSecret(shop.refreshToken), shop.accessExpiresAt ?? null,
            shop.refreshExpiresAt ?? null]
        );
        await query(
          `INSERT INTO workspace_marketplace_syncs
             (workspace_id,provider,connection_id,status,target_from,target_to,cursor_from,cursor_to,processed_orders)
           VALUES ($1,'tiktok_shop',$2,'pending',$3,$4,$5,$4,0)
           ON CONFLICT (workspace_id,provider,connection_id) DO NOTHING`,
          [workspaceId, `tiktok_shop:${shop.shopId}`, targetFrom, now.toISOString(), cursorFrom]
        );
      }
    });
    return;
  }
  const all = await readAll();
  for (const shop of shops) {
    all[`${workspaceId}:${shop.shopId}`] = { ...shop, workspaceId, connectedAt: now.toISOString() };
  }
  await writeAll(all);
}

/**
 * Renova o access token somente quando ele estiver perto de vencer. A data de
 * conexão permanece intacta: refresh técnico não é uma nova autorização.
 */
export async function refreshTiktokShopIfNeeded(
  shop: TiktokShop,
  minValidityMs = 5 * 60_000
): Promise<TiktokShop> {
  const workspaceId = currentWorkspaceId();
  if (hasDb()) await assertGlobalTiktokShopOwnership(dbQuery, workspaceId, [shop.shopId]);
  const expiresAt = shop.accessExpiresAt ? new Date(shop.accessExpiresAt).getTime() : 0;
  if (!expiresAt || expiresAt - Date.now() > minValidityMs) return shop;

  const refreshExpiresAt = shop.refreshExpiresAt ? new Date(shop.refreshExpiresAt).getTime() : 0;
  if (refreshExpiresAt && refreshExpiresAt <= Date.now()) {
    throw new TiktokConnectionError("REAUTH_REQUIRED", "A autorização da TikTok Shop expirou. Reconecte a loja.");
  }
  if (!shop.refreshToken) {
    throw new TiktokConnectionError("REAUTH_REQUIRED", "A TikTok Shop não forneceu refresh token. Reconecte a loja.");
  }

  const previousRefreshToken = shop.refreshToken;
  const grantKey = tiktokRefreshGrantKey(workspaceId, previousRefreshToken);
  const rotateGrant = async () => {
    // Outra chamada pode ter renovado enquanto esta aguardava a deduplicação.
    const rows = hasDb() ? await dbQuery<Row>(
      `SELECT shop_id, shop_name, shop_cipher, region, access_token, refresh_token,
              access_expires_at, refresh_expires_at, connected_at
         FROM workspace_tiktok_shops WHERE workspace_id = $1 ORDER BY shop_id`,
      [workspaceId]
    ) : [];
    const workspaceShops = hasDb() ? rows.map(rowToShop) : await getTiktokShops();
    const currentShop = workspaceShops.find((candidate) => candidate.shopId === shop.shopId);
    if (!currentShop) {
      throw new TiktokConnectionError("REAUTH_REQUIRED", "A loja TikTok não está mais conectada.");
    }
    // O grant mudou enquanto aguardávamos o lock: callback/reautorização venceu.
    if (currentShop.refreshToken !== previousRefreshToken) return currentShop;
    const grantShops = workspaceShops.filter((candidate) => candidate.refreshToken === previousRefreshToken);
    const latest = grantShops.find((candidate) => candidate.shopId === shop.shopId) ?? shop;
    const latestExpiry = latest.accessExpiresAt ? new Date(latest.accessExpiresAt).getTime() : 0;
    if (latestExpiry && latestExpiry - Date.now() > minValidityMs) return latest;

    if (hasDb()) {
      const initialIds = grantShops.map((candidate) => candidate.shopId).sort();
      return coordinateOAuthRefresh({
        workspaceId, provider: "tiktok_shop", refreshToken: previousRefreshToken, leaseMs: 35_000,
        readFresh: async () => {
          const reread = await dbQuery<Row>(`SELECT shop_id, shop_name, shop_cipher, region, access_token, refresh_token,
            access_expires_at, refresh_expires_at, connected_at FROM workspace_tiktok_shops
            WHERE workspace_id=$1 AND shop_id=$2`, [workspaceId, shop.shopId]);
          if (!reread[0]) throw new TiktokConnectionError("REAUTH_REQUIRED", "A loja TikTok não está mais conectada.");
          const value = rowToShop(reread[0]);
          if (value.refreshToken !== previousRefreshToken) return value;
          const expiry = value.accessExpiresAt ? new Date(value.accessExpiresAt).getTime() : 0;
          return expiry && expiry - Date.now() > minValidityMs ? value : null;
        },
        refresh: (signal) => refreshAccessToken(previousRefreshToken, signal),
        isInvalidGrant: (error) => error instanceof Error && (error as Error & { code?: string }).code === "REAUTH_REQUIRED",
        // Depois de in_flight, a implementação HTTP não consegue provar que uma
        // falha aconteceu antes de o provedor receber o refresh token.
        isSafeToRelease: () => false,
        finalizeInvalidGrant: async (query) => {
          await assertGlobalTiktokShopOwnership(query, workspaceId, initialIds, true);
          const locked = await query<Row>(`SELECT shop_id, shop_name, shop_cipher, region, access_token, refresh_token,
            access_expires_at, refresh_expires_at, connected_at FROM workspace_tiktok_shops
            WHERE workspace_id=$1 ORDER BY shop_id FOR UPDATE`, [workspaceId]);
          const grant = locked.filter((row) => revealSecret(row.refresh_token) === previousRefreshToken);
          const ids = grant.map((row) => row.shop_id).sort();
          if (ids.length !== initialIds.length || ids.some((id, index) => id !== initialIds[index])) return null;
          for (const row of grant) await query(`DELETE FROM workspace_tiktok_shops
            WHERE workspace_id=$1 AND shop_id=$2 AND refresh_token=$3`, [workspaceId, row.shop_id, row.refresh_token]);
          return null;
        },
        finalize: async (query, token) => {
          await assertGlobalTiktokShopOwnership(query, workspaceId, initialIds, true);
          const locked = await query<Row>(`SELECT shop_id, shop_name, shop_cipher, region, access_token, refresh_token,
            access_expires_at, refresh_expires_at, connected_at FROM workspace_tiktok_shops
            WHERE workspace_id=$1 ORDER BY shop_id FOR UPDATE`, [workspaceId]);
          const grant = locked.filter((row) => revealSecret(row.refresh_token) === previousRefreshToken);
          const ids = grant.map((row) => row.shop_id).sort();
          const selected = locked.find((row) => row.shop_id === shop.shopId);
          if (!selected) return null;
          if (revealSecret(selected.refresh_token) !== previousRefreshToken) return rowToShop(selected);
          if (ids.length !== initialIds.length || ids.some((id, index) => id !== initialIds[index])) return null;
          const accessToken = token.access_token;
          const refreshToken = token.refresh_token || previousRefreshToken;
          const accessExpiresAt = epochToIso(token.access_token_expire_in);
          const refreshExpiresAt = epochToIso(token.refresh_token_expire_in) ?? latest.refreshExpiresAt;
          let changed = 0;
          for (const row of grant) {
            const result = await query<{ shop_id: string }>(`UPDATE workspace_tiktok_shops SET
              access_token=$4, refresh_token=$5, access_expires_at=$6, refresh_expires_at=$7
              WHERE workspace_id=$1 AND shop_id=$2 AND refresh_token=$3 RETURNING shop_id`,
              [workspaceId, row.shop_id, row.refresh_token, protectSecret(accessToken), protectSecret(refreshToken), accessExpiresAt ?? null, refreshExpiresAt ?? null]);
            changed += result.length;
          }
          if (changed !== grant.length) return null;
          return { ...rowToShop(selected), accessToken, refreshToken, accessExpiresAt, refreshExpiresAt };
        },
      });
    }

    let token: Awaited<ReturnType<typeof refreshAccessToken>>;
    try {
      token = await refreshAccessToken(latest.refreshToken);
    } catch (error) {
      const reread = await getTiktokShops();
      const current = reread.find((candidate) => candidate.shopId === shop.shopId);
      if (current && current.refreshToken !== previousRefreshToken) return current;
      throw error;
    }
    const updated: TiktokShop = {
      ...latest,
      accessToken: token.access_token,
      refreshToken: token.refresh_token || latest.refreshToken,
      accessExpiresAt: epochToIso(token.access_token_expire_in),
      refreshExpiresAt: epochToIso(token.refresh_token_expire_in) ?? latest.refreshExpiresAt,
    };

    const all = await readAll();
    for (const grantShop of grantShops) {
      const key = `${workspaceId}:${grantShop.shopId}`;
      all[key] = { ...all[key], ...updated, shopId: grantShop.shopId, shopName: grantShop.shopName,
        shopCipher: grantShop.shopCipher, region: grantShop.region, workspaceId, connectedAt: grantShop.connectedAt };
    }
    await writeAll(all);
    return updated;
  };
  return deduplicateTiktokRefresh(grantKey, rotateGrant);
}

/** Uma rotação de refresh token por loja de cada vez, inclusive para chamadas
 * concorrentes no mesmo processo. A promise é removida também quando falha. */

export async function removeTiktokShop(shopId: string): Promise<void> {
  const workspaceId = currentWorkspaceId();
  if (hasDb()) {
    await dbQuery(`DELETE FROM workspace_tiktok_shops WHERE workspace_id = $1 AND shop_id = $2`, [workspaceId, shopId]);
    return;
  }
  const all = await readAll();
  delete all[`${workspaceId}:${shopId}`];
  await writeAll(all);
}
