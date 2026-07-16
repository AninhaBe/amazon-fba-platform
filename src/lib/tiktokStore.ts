import fs from "fs/promises";
import path from "path";
import { dataFile } from "./dataDir";
import { hasDb, dbQuery } from "./db";

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
}

function rowToShop(r: Row): TiktokShop {
  return {
    shopId: r.shop_id,
    shopName: r.shop_name ?? undefined,
    shopCipher: r.shop_cipher ?? undefined,
    region: r.region ?? undefined,
    accessToken: r.access_token,
    refreshToken: r.refresh_token,
    accessExpiresAt: r.access_expires_at ? new Date(r.access_expires_at).toISOString() : undefined,
    refreshExpiresAt: r.refresh_expires_at ? new Date(r.refresh_expires_at).toISOString() : undefined,
    connectedAt: new Date(r.connected_at).toISOString(),
  };
}

async function readAll(): Promise<Record<string, TiktokShop>> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8"));
  } catch {
    return {};
  }
}

async function writeAll(data: Record<string, TiktokShop>): Promise<void> {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(data, null, 2), "utf8");
}

export async function getTiktokShops(): Promise<TiktokShop[]> {
  if (hasDb()) {
    const rows = await dbQuery<Row>(
      `SELECT shop_id, shop_name, shop_cipher, region, access_token, refresh_token,
              access_expires_at, refresh_expires_at, connected_at
         FROM tiktok_shops ORDER BY connected_at`
    );
    return rows.map(rowToShop);
  }
  return Object.values(await readAll());
}

export async function saveTiktokShop(
  s: Omit<TiktokShop, "connectedAt"> & { connectedAt?: string }
): Promise<TiktokShop> {
  if (hasDb()) {
    const rows = await dbQuery<Row>(
      `INSERT INTO tiktok_shops
         (shop_id, shop_name, shop_cipher, region, access_token, refresh_token,
          access_expires_at, refresh_expires_at, connected_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
       ON CONFLICT (shop_id) DO UPDATE SET
         shop_name          = COALESCE(EXCLUDED.shop_name, tiktok_shops.shop_name),
         shop_cipher        = COALESCE(EXCLUDED.shop_cipher, tiktok_shops.shop_cipher),
         region             = COALESCE(EXCLUDED.region, tiktok_shops.region),
         access_token       = EXCLUDED.access_token,
         refresh_token      = EXCLUDED.refresh_token,
         access_expires_at  = EXCLUDED.access_expires_at,
         refresh_expires_at = EXCLUDED.refresh_expires_at,
         connected_at       = now()
       RETURNING shop_id, shop_name, shop_cipher, region, access_token, refresh_token,
                 access_expires_at, refresh_expires_at, connected_at`,
      [
        s.shopId,
        s.shopName ?? null,
        s.shopCipher ?? null,
        s.region ?? null,
        s.accessToken,
        s.refreshToken,
        s.accessExpiresAt ?? null,
        s.refreshExpiresAt ?? null,
      ]
    );
    return rowToShop(rows[0]);
  }
  const all = await readAll();
  const merged: TiktokShop = { ...all[s.shopId], ...s, connectedAt: new Date().toISOString() };
  all[s.shopId] = merged;
  await writeAll(all);
  return merged;
}

export async function removeTiktokShop(shopId: string): Promise<void> {
  if (hasDb()) {
    await dbQuery(`DELETE FROM tiktok_shops WHERE shop_id = $1`, [shopId]);
    return;
  }
  const all = await readAll();
  delete all[shopId];
  await writeAll(all);
}
