import { Pool } from "pg";

// Camada Postgres (Supabase). Quando DATABASE_URL está definido, os dados que
// precisam persistir (contas conectadas + custos) vão para o banco; senão, os
// stores caem no arquivo JSON local (dev sem banco continua funcionando).

let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;

/** true quando há um banco configurado (produção/Render com Supabase). */
export function hasDb(): boolean {
  return !!process.env.DATABASE_URL;
}

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Supabase exige SSL. rejectUnauthorized:false evita erro de CA no Render.
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return pool;
}

async function createSchema(): Promise<void> {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS accounts (
      seller_id     TEXT PRIMARY KEY,
      refresh_token TEXT NOT NULL,
      name          TEXT,
      marketplace   TEXT,
      connected_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS product_costs (
      id         TEXT PRIMARY KEY,
      sku        TEXT,
      asin       TEXT,
      title      TEXT,
      image_url  TEXT,
      cost       NUMERIC(12,2) NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      history    JSONB NOT NULL DEFAULT '[]'::jsonb
    );
    CREATE TABLE IF NOT EXISTS tiktok_shops (
      shop_id            TEXT PRIMARY KEY,
      shop_name          TEXT,
      shop_cipher        TEXT,
      region             TEXT,
      access_token       TEXT NOT NULL,
      refresh_token      TEXT NOT NULL,
      access_expires_at  TIMESTAMPTZ,
      refresh_expires_at TIMESTAMPTZ,
      connected_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS integrations (
      id                 TEXT PRIMARY KEY,
      provider           TEXT NOT NULL,
      external_account_id TEXT NOT NULL,
      display_name       TEXT,
      mode               TEXT NOT NULL DEFAULT 'local',
      region             TEXT,
      access_token       TEXT,
      refresh_token      TEXT,
      access_expires_at  TIMESTAMPTZ,
      refresh_expires_at TIMESTAMPTZ,
      scopes             JSONB NOT NULL DEFAULT '[]'::jsonb,
      metadata           JSONB NOT NULL DEFAULT '{}'::jsonb,
      status             TEXT NOT NULL DEFAULT 'connected',
      connected_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(provider, external_account_id)
    );
  `);
}

/** Garante que as tabelas existam (idempotente, roda uma vez por processo). */
function ensureSchema(): Promise<void> {
  if (!schemaReady) schemaReady = createSchema();
  return schemaReady;
}

/** Executa uma query e retorna as linhas (cria o schema na primeira chamada). */
export async function dbQuery<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  await ensureSchema();
  const res = await getPool().query(text, params);
  return res.rows as T[];
}
