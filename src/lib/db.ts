import { Pool } from "pg";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { assertFinancialLedgerContract, financialLedgerContractHash, FINANCIAL_LEDGER_CONTRACT_SQL } from "../../scripts/migration-contracts.mjs";
import { inspectFinancialLedgerContract } from "../../scripts/migration-safety.mjs";

// Camada Postgres (Supabase). Quando DATABASE_URL está definido, os dados que
// precisam persistir (contas conectadas + custos) vão para o banco; senão, os
// stores caem no arquivo JSON local (dev sem banco continua funcionando).

let pool: Pool | null = null;
let schemaReady: Promise<void> | null = null;
let financialLedgerSchemaReady: Promise<void> | null = null;

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
      // Cada instância serverless pode criar seu próprio pool. Mantê-lo pequeno
      // evita multiplicar conexões no Supavisor quando a Vercel escala a aplicação.
      max: process.env.VERCEL ? 2 : 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
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
    -- Estruturas multiusuário. As tabelas legadas acima são preservadas, mas não
    -- são mais consultadas: registros antigos ficam em quarentena até reconexão.
    CREATE TABLE IF NOT EXISTS workspace_accounts (
      workspace_id TEXT NOT NULL,
      seller_id     TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      name          TEXT,
      marketplace   TEXT,
      connected_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (workspace_id, seller_id)
    );
    CREATE TABLE IF NOT EXISTS workspace_product_costs (
      workspace_id TEXT NOT NULL,
      id         TEXT NOT NULL,
      sku        TEXT,
      asin       TEXT,
      title      TEXT,
      image_url  TEXT,
      cost       NUMERIC(12,2) NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      history    JSONB NOT NULL DEFAULT '[]'::jsonb,
      PRIMARY KEY (workspace_id, id)
    );
    CREATE TABLE IF NOT EXISTS workspace_integrations (
      workspace_id       TEXT NOT NULL,
      id                 TEXT NOT NULL,
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
      PRIMARY KEY (workspace_id, id),
      UNIQUE(workspace_id, provider, external_account_id)
    );
    CREATE TABLE IF NOT EXISTS workspace_tiktok_shops (
      workspace_id       TEXT NOT NULL,
      shop_id            TEXT NOT NULL,
      shop_name          TEXT,
      shop_cipher        TEXT,
      region             TEXT,
      access_token       TEXT NOT NULL,
      refresh_token      TEXT NOT NULL,
      access_expires_at  TIMESTAMPTZ,
      refresh_expires_at TIMESTAMPTZ,
      tax_rate           NUMERIC(5,2) CHECK (tax_rate >= 0 AND tax_rate <= 100),
      connected_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (workspace_id, shop_id)
    );
    CREATE TABLE IF NOT EXISTS workspace_marketplace_orders (
      workspace_id       TEXT NOT NULL,
      provider           TEXT NOT NULL,
      connection_id      TEXT NOT NULL,
      external_order_id  TEXT NOT NULL,
      status             TEXT NOT NULL,
      occurred_at        TIMESTAMPTZ NOT NULL,
      payload            JSONB NOT NULL,
      synced_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (workspace_id, provider, connection_id, external_order_id)
    );
    CREATE TABLE IF NOT EXISTS workspace_marketplace_shipments (
      workspace_id        TEXT NOT NULL,
      provider            TEXT NOT NULL,
      connection_id       TEXT NOT NULL,
      external_shipment_id TEXT NOT NULL,
      payload             JSONB NOT NULL,
      synced_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (workspace_id, provider, connection_id, external_shipment_id)
    );
    CREATE TABLE IF NOT EXISTS workspace_marketplace_products (
      workspace_id       TEXT NOT NULL,
      provider           TEXT NOT NULL,
      connection_id      TEXT NOT NULL,
      external_product_id TEXT NOT NULL,
      status             TEXT NOT NULL,
      payload            JSONB NOT NULL,
      synced_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (workspace_id, provider, connection_id, external_product_id)
    );
    CREATE TABLE IF NOT EXISTS workspace_marketplace_syncs (
      workspace_id       TEXT NOT NULL,
      provider           TEXT NOT NULL,
      connection_id      TEXT NOT NULL,
      status             TEXT NOT NULL DEFAULT 'pending',
      target_from        TIMESTAMPTZ NOT NULL,
      target_to          TIMESTAMPTZ NOT NULL,
      covered_from       TIMESTAMPTZ,
      covered_to         TIMESTAMPTZ,
      cursor_from        TIMESTAMPTZ NOT NULL,
      cursor_to          TIMESTAMPTZ NOT NULL,
      cursor_offset      INTEGER NOT NULL DEFAULT 0,
      processed_orders   INTEGER NOT NULL DEFAULT 0,
      products_synced_at TIMESTAMPTZ,
      products_total     INTEGER NOT NULL DEFAULT 0,
      active_products    INTEGER NOT NULL DEFAULT 0,
      products_complete  BOOLEAN NOT NULL DEFAULT false,
      lease_until        TIMESTAMPTZ,
      last_error         TEXT,
      last_success_at    TIMESTAMPTZ,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (workspace_id, provider, connection_id)
    );
    ALTER TABLE workspace_marketplace_syncs
      ADD COLUMN IF NOT EXISTS reverify_to TIMESTAMPTZ;
    CREATE TABLE IF NOT EXISTS workspace_marketplace_events (
      workspace_id  TEXT NOT NULL,
      provider      TEXT NOT NULL,
      event_key     TEXT NOT NULL,
      connection_id TEXT NOT NULL,
      topic         TEXT NOT NULL,
      resource      TEXT NOT NULL,
      payload       JSONB NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending',
      attempts      INTEGER NOT NULL DEFAULT 0,
      received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      processing_at TIMESTAMPTZ,
      processed_at  TIMESTAMPTZ,
      last_error    TEXT,
      PRIMARY KEY (workspace_id, provider, event_key)
    );
    ALTER TABLE workspace_marketplace_events
      ADD COLUMN IF NOT EXISTS processing_at TIMESTAMPTZ;
    CREATE TABLE IF NOT EXISTS workspace_marketplace_overview_snapshots (
      workspace_id  TEXT NOT NULL,
      provider      TEXT NOT NULL,
      connection_id TEXT NOT NULL,
      period_key    TEXT NOT NULL,
      payload       JSONB NOT NULL,
      generated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (workspace_id, provider, connection_id, period_key)
    );
    CREATE TABLE IF NOT EXISTS workspace_persistent_cache (
      workspace_id TEXT NOT NULL,
      cache_key    TEXT NOT NULL,
      payload      JSONB NOT NULL,
      cached_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (workspace_id, cache_key)
    );
    CREATE TABLE IF NOT EXISTS workspace_settings (
      workspace_id TEXT NOT NULL,
      key          TEXT NOT NULL,
      value        JSONB NOT NULL,
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (workspace_id, key)
    );
    CREATE TABLE IF NOT EXISTS workspace_insights (
      workspace_id   TEXT NOT NULL,
      id             TEXT NOT NULL,
      type           TEXT NOT NULL,
      provider       TEXT NOT NULL,
      entity_ref     TEXT,
      severity       INTEGER NOT NULL DEFAULT 0,
      title          TEXT NOT NULL,
      evidence       JSONB NOT NULL DEFAULT '{}'::jsonb,
      impact         JSONB NOT NULL DEFAULT '{}'::jsonb,
      recommendation TEXT,
      action_href    TEXT,
      status         TEXT NOT NULL DEFAULT 'novo',
      detected_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      snoozed_until  TIMESTAMPTZ,
      PRIMARY KEY (workspace_id, id)
    );
    CREATE TABLE IF NOT EXISTS workspace_rank_history (
      workspace_id TEXT NOT NULL,
      asin         TEXT NOT NULL,
      captured_on  DATE NOT NULL DEFAULT CURRENT_DATE,
      rank         INTEGER NOT NULL,
      category     TEXT,
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (workspace_id, asin, captured_on)
    );
    CREATE INDEX IF NOT EXISTS workspace_rank_history_idx
      ON workspace_rank_history(workspace_id, asin, captured_on DESC);
    -- ADR-011: identidade dos ASINs acompanhados. workspace_rank_history guarda só a
    -- série de números; aqui fica o "quem é quem" (título, foto, de qual busca veio)
    -- e a intenção da usuária (fixado/removido), que define a prioridade da foto diária.
    CREATE TABLE IF NOT EXISTS workspace_watchlist (
      workspace_id     TEXT NOT NULL,
      asin             TEXT NOT NULL,
      title            TEXT,
      brand            TEXT,
      image_url        TEXT,
      last_search_term TEXT,
      first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      pinned           BOOLEAN NOT NULL DEFAULT false,
      -- Soft delete: sair da lista interrompe a captura, mas nunca destrói a série já
      -- coletada — se o ASIN voltar, o histórico volta junto.
      removed_at       TIMESTAMPTZ,
      PRIMARY KEY (workspace_id, asin)
    );
    CREATE INDEX IF NOT EXISTS workspace_watchlist_active_idx
      ON workspace_watchlist(workspace_id, pinned DESC, last_seen_at DESC)
      WHERE removed_at IS NULL;
    -- NÃO semear a watchlist a partir de workspace_rank_history.
    --
    -- Existiu aqui um INSERT ... SELECT que copiava todo ASIN do histórico de ranking
    -- para a watchlist, como backfill da ADR-011. Ele rodava a cada boot do processo.
    -- Depois que monitorar virou **opt-in**, isso passou a ser um bug grave: a busca
    -- continua gravando o rank de todos os resultados (custo zero, dá um primeiro
    -- ponto a quem for monitorado depois), então a semente readicionaria à watchlist
    -- justamente o que a pessoa nunca escolheu — e o que ela removesse voltaria no
    -- próximo restart. O backfill já cumpriu seu papel e foi removido.
    -- ADR-010: foto diária da oferta. workspace_channel_products guarda só o estado
    -- atual (é sobrescrito a cada sync); aqui fica a série temporal que permite
    -- explicar "parou de vender porque o estoque zerou anteontem".
    CREATE TABLE IF NOT EXISTS workspace_channel_offer_history (
      workspace_id        TEXT NOT NULL,
      provider            TEXT NOT NULL,
      connection_id       TEXT NOT NULL,
      external_product_id TEXT NOT NULL,
      captured_on         DATE NOT NULL DEFAULT CURRENT_DATE,
      sku                 TEXT,
      -- Colunas nullable de propósito: cada canal entrega um subconjunto. NULL sempre
      -- significa "não coletado", nunca zero/inativo. Ex.: na Amazon o v1 vem do FBA
      -- Inventory, que dá estoque mas não preço nem status do anúncio.
      status              TEXT,
      price               NUMERIC(14,2),
      currency            TEXT,
      available_qty       INTEGER,
      -- NULL = não coletado/não se aplica ao canal. Nunca interpretar como "não é sua".
      buy_box_owned       BOOLEAN,
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (workspace_id, provider, connection_id, external_product_id, captured_on)
    );
    CREATE INDEX IF NOT EXISTS workspace_channel_offer_history_idx
      ON workspace_channel_offer_history(workspace_id, provider, external_product_id, captured_on DESC);
    CREATE TABLE IF NOT EXISTS workspace_marketplace_materialization_leases (
      workspace_id  TEXT NOT NULL,
      provider      TEXT NOT NULL,
      connection_id TEXT NOT NULL,
      lease_until   TIMESTAMPTZ,
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (workspace_id, provider, connection_id)
    );
    CREATE INDEX IF NOT EXISTS workspace_accounts_owner_idx ON workspace_accounts(workspace_id);
    CREATE INDEX IF NOT EXISTS workspace_costs_owner_idx ON workspace_product_costs(workspace_id);
    CREATE INDEX IF NOT EXISTS workspace_integrations_owner_idx ON workspace_integrations(workspace_id);
    CREATE INDEX IF NOT EXISTS workspace_marketplace_orders_period_idx
      ON workspace_marketplace_orders(workspace_id, provider, connection_id, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS workspace_marketplace_orders_shipment_idx
      ON workspace_marketplace_orders(workspace_id, provider, connection_id, ((payload #>> '{shipping,id}')))
      WHERE status = 'paid' AND payload #>> '{shipping,id}' IS NOT NULL;
    CREATE INDEX IF NOT EXISTS workspace_marketplace_products_status_idx
      ON workspace_marketplace_products(workspace_id, provider, connection_id, status);
    CREATE INDEX IF NOT EXISTS workspace_marketplace_events_pending_idx
      ON workspace_marketplace_events(workspace_id, provider, status, received_at);
    CREATE INDEX IF NOT EXISTS workspace_marketplace_overview_snapshots_age_idx
      ON workspace_marketplace_overview_snapshots(workspace_id, provider, connection_id, generated_at DESC);
    CREATE INDEX IF NOT EXISTS workspace_persistent_cache_age_idx
      ON workspace_persistent_cache(workspace_id, cached_at DESC);
  `);
}

// Mantido temporariamente apenas para tornar explícito no diff o bootstrap antigo;
// não é chamado. Remoção mecânica pode ser feita após separar o worktree concorrente.
void createSchema;

/** Garante que as tabelas existam (idempotente, roda uma vez por processo). */
function ensureSchema(): Promise<void> {
  // Runtime, sync e health nunca corrigem schema. DDL pertence exclusivamente ao
  // runner fail-closed; ausência vira BLOCKED em vez de mutação implícita.
  if (!schemaReady) schemaReady = getPool().query(`
    SELECT
      to_regclass(current_schema() || '.workspace_integrations') IS NOT NULL AS integrations,
      to_regclass(current_schema() || '.workspace_marketplace_syncs') IS NOT NULL AS syncs,
      to_regclass(current_schema() || '.schema_migrations') IS NOT NULL AS ledger
  `).then(({ rows }) => {
    if (!rows[0]?.integrations || !rows[0]?.syncs || !rows[0]?.ledger) {
      throw new Error("SCHEMA_BLOCKED: schema ausente/incompleto; gere um plano e aplique pelo runner autorizado.");
    }
  });
  return schemaReady;
}

/** Certifica a 0005 somente para fluxos que dependem do ledger financeiro. */
export function ensureFinancialLedgerSchema(): Promise<void> {
  if (!financialLedgerSchemaReady) financialLedgerSchemaReady = ensureSchema().then(async () => {
    const migrationSql = await readFile(path.join(process.cwd(), "migrations", "0005_workspace_financial_ledger.sql"), "utf8");
    const contract = await inspectFinancialLedgerContract((sql: string) => getPool().query(sql), FINANCIAL_LEDGER_CONTRACT_SQL);
    try { assertFinancialLedgerContract(contract, financialLedgerContractHash(migrationSql)); }
    catch { throw new Error("SCHEMA_BLOCKED: contrato semantico 0005 ausente, divergente ou inseguro."); }
  });
  return financialLedgerSchemaReady;
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

export type DbQuery = <R = Record<string, unknown>>(
  text: string,
  params?: unknown[]
) => Promise<R[]>;

/** Executa todas as escritas na mesma transação e conexão. */
export async function dbTransaction<T>(
  fn: (query: DbQuery) => Promise<T>
): Promise<T> {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(async <R>(text: string, params: unknown[] = []) => {
      const response = await client.query(text, params);
      return response.rows as R[];
    });
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Serializa e executa toda a seção crítica na mesma sessão/transação. */
export async function withDbTransactionAdvisoryLock<T>(
  key: string,
  fn: (query: DbQuery) => Promise<T>
): Promise<T> {
  return dbTransaction(async (query) => {
    await query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
    return fn(query);
  });
}
