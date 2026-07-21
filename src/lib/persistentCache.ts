import fs from "fs/promises";
import path from "path";
import { dataFile } from "./dataDir";
import { dbQuery, hasDb } from "./db";
import { optionalWorkspaceId } from "./workspaceScope";

// Em produção, o cache fica no PostgreSQL e sobrevive ao desligamento da
// instância gratuita. O arquivo local permanece apenas como fallback de dev.

interface CacheRow<T> {
  payload: T;
  cached_at: Date | string;
}

function file(key: string): string {
  const scopedKey = `${optionalWorkspaceId() ?? "public"}_${key}`;
  return dataFile("cache", `${scopedKey.replace(/[^a-z0-9_-]/gi, "_")}.json`);
}

export async function readCache<T>(key: string): Promise<{ at: number; value: T } | null> {
  const workspaceId = optionalWorkspaceId();
  if (hasDb() && workspaceId) {
    const rows = await dbQuery<CacheRow<T>>(
      `SELECT payload, cached_at
         FROM workspace_persistent_cache
        WHERE workspace_id = $1 AND cache_key = $2`,
      [workspaceId, key]
    );
    const row = rows[0];
    return row ? { at: new Date(row.cached_at).getTime(), value: row.payload } : null;
  }

  try {
    return JSON.parse(await fs.readFile(file(key), "utf8"));
  } catch {
    return null;
  }
}

export async function writeCache<T>(key: string, value: T): Promise<void> {
  const workspaceId = optionalWorkspaceId();
  if (hasDb() && workspaceId) {
    await dbQuery(
      `INSERT INTO workspace_persistent_cache (workspace_id, cache_key, payload, cached_at)
       VALUES ($1, $2, $3::jsonb, now())
       ON CONFLICT (workspace_id, cache_key) DO UPDATE SET
         payload = EXCLUDED.payload,
         cached_at = now()`,
      [workspaceId, key, JSON.stringify(value)]
    );
    return;
  }

  const f = file(key);
  await fs.mkdir(path.dirname(f), { recursive: true });
  await fs.writeFile(f, JSON.stringify({ at: Date.now(), value }), "utf8");
}
