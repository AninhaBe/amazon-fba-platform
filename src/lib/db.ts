import { Pool } from "pg";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { assertFinancialLedgerContract, financialLedgerContractHash, FINANCIAL_LEDGER_CONTRACT_SQL } from "../../scripts/migration-contracts.mjs";
import { inspectFinancialLedgerContract } from "../../scripts/migration-safety.mjs";
import { urlDoPoolDaAplicacao } from "./databaseUrl";
import { ehFundo } from "./execucaoDeFundo";

// Camada Postgres (Supabase). Quando DATABASE_URL está definido, os dados que
// precisam persistir (contas conectadas + custos) vão para o banco; senão, os
// stores caem no arquivo JSON local (dev sem banco continua funcionando).

let pool: Pool | null = null;
/** Pool separado do trabalho de fundo — ver `execucaoDeFundo.ts` e ADR-030. */
let poolDeFundo: Pool | null = null;
let schemaReady: Promise<void> | null = null;
let financialLedgerSchemaReady: Promise<void> | null = null;

/** true quando há um banco configurado (produção/Render com Supabase). */
export function hasDb(): boolean {
  return !!process.env.DATABASE_URL;
}

/**
 * Teto de conexões do pool. Padrão da aplicação: 10 (2 na Vercel, onde cada
 * instância cria o seu). `DB_POOL_MAX` sobrescreve para baixo nos scripts.
 *
 * Valor inválido ou fora de 1..10 é IGNORADO em silêncio a favor do padrão —
 * um erro de digitação num script não pode virar autorização para abrir mais
 * conexões que a aplicação.
 */
function maximoDoPool(padrao: number, variavel = "DB_POOL_MAX"): number {
  const pedido = Number(process.env[variavel]);
  if (!Number.isInteger(pedido) || pedido < 1 || pedido > padrao) return padrao;
  return pedido;
}

/**
 * ⚠️ DOIS POOLS, e a assimetria e o ponto (ADR-030, incidente de 29/08/2026).
 *
 * USUARIO 8 / FUNDO 3. O fundo nao enxerga o pool do usuario, entao ele NAO
 * CONSEGUE tomar o ultimo slot de quem esta esperando a tela — a fome fica
 * impossivel por construcao e nao por sorte de escalonamento.
 *
 * Total 11 contra os 10 de antes: conservador de proposito, porque o teto de
 * conexoes do tenant no pooler nao e conhecido. Sobem por variavel, sem deploy.
 */
const MAX_USUARIO = process.env.VERCEL ? 2 : 8;
// 3 → 5 em 29/08/2026, junto com a migração dos oito `after()` para o fundo.
// A conta de 8+3 foi feita de madrugada supondo que fundo = cron. Agora o fundo
// carrega também o sync que a tela dispara e o webhook do ML, que antes corriam
// no pool do usuário. 8+5 = 13 contra os 15 do Supavisor, com 2 de margem para
// migration e sonda — mesma lógica conservadora, com o trabalho novo dentro.
//
// O risco desta escolha é fila NO FUNDO (ingestão atrasada), e ele é aceitável
// porque é VISÍVEL: a varredura de eventos velhos se anuncia no log quando
// começa a resgatar. Fila na tela é invisível e cai em cima da vendedora.
const MAX_FUNDO = process.env.VERCEL ? 1 : 5;

/** Alvo em localhost = banco descartável (CI ou desenvolvimento), que não fala SSL. */
function hostLocal(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return ["localhost", "127.0.0.1", "::1"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

function criarPool(max: number): Pool {
  return new Pool({
      // Modo `transaction` (porta 6543) quando o destino é o pooler do Supabase.
      // No modo `session` o `pool_size: 15` é teto de CLIENTES e já não cabia o
      // `max` daqui. Ver `databaseUrl.ts` e ADR-028.
      connectionString: urlDoPoolDaAplicacao(process.env.DATABASE_URL),
      // Supabase exige SSL. rejectUnauthorized:false evita erro de CA no Render.
      //
      // ⚠️ Postgres LOCAL não fala SSL e responde "The server does not support
      // SSL connections" (visto ao montar o portão do CI em 30/08/2026). Alvo
      // local é sempre banco descartável — contêiner do CI ou Postgres de
      // desenvolvimento —, nunca dado de vendedora, então desligar aí não afrouxa
      // nada: os alvos reais deste projeto (Supabase) não são locais e continuam
      // exigindo SSL por este mesmo `if`.
      ssl: hostLocal(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false },
      // Cada instância serverless pode criar seu próprio pool. Mantê-lo pequeno
      // evita multiplicar conexões no Supavisor quando a Vercel escala a aplicação.
      //
      // 5 → 10 em 28/08/2026, MEDIDO e não no chute: a conexão real do Mercado
      // Livre da vendedora passou 8h em `error` com "timeout exceeded when
      // trying to connect" — que é o erro DESTE pool quando
      // `connectionTimeoutMillis` estoura, não do marketplace. O servidor tinha
      // folga (17 conexões de 60 no Postgres, só 1 ativa), então a contenção
      // era aqui: o cron dispara os quatro canais em paralelo e cada passo de
      // sync abre várias queries — não cabe em 5 slots. 10 continua conservador
      // (bem abaixo do teto do servidor) e é reversível numa linha.
      // `DB_POOL_MAX` existe para os SCRIPTS: regra de higiene de 28/08/2026 —
      // script local contra produção não abre pool de 10. Foram duas sondas
      // minhas com `max: 10` que derrubaram uma na outra com EMAXCONNSESSION.
      // A aplicação não define a variável; quem define é o script, no topo dele.
      // ⚠️ TETO DE TEMPO POR CONSULTA (29/08/2026). Duas indisponibilidades em
      // 45 minutos, de fontes DIFERENTES — uma escrita de sync de 9 min e uma
      // agregação de métricas de 112s com sete cópias empilhadas —, o mesmo
      // mecanismo nas duas: em modo `transaction` a consulta prende o slot do
      // pooler pela sua duração inteira, e sem teto ela prende para sempre.
      //
      // 120s é conservador de propósito: já vimos etapa de sync legítima levar
      // 68s, e matar trabalho bom para consertar trabalho ruim trocaria um
      // incidente barulhento por um silencioso, que é pior.
      //
      // Vem de variável para dar para afrouxar ou apertar SEM DEPLOY — num
      // incidente, esperar 4 minutos de build é o que não se tem.
      //
      // NÃO se aplica às migrations: `migrate-cli.mjs` abre a própria conexão e
      // DDL longa é legítima lá.
      statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS || 120_000),
      max,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
}

function getPool(): Pool {
  if (ehFundo()) {
    if (!poolDeFundo) poolDeFundo = criarPool(maximoDoPool(MAX_FUNDO, "DB_POOL_MAX_FUNDO"));
    return poolDeFundo;
  }
  if (!pool) pool = criarPool(maximoDoPool(MAX_USUARIO, "DB_POOL_MAX"));
  return pool;
}

/**
 * CONTABILIDADE DE CHECKOUTS — medição, não comportamento.
 *
 * ⚠️ Por que existe (29/08/2026): uma carga do dashboard custava 28 idas ao
 * pool. Com 8 slots de usuário, isso são QUATRO ONDAS DE ESPERA antes de a tela
 * ficar pronta — e enquanto for assim, qualquer trabalho de fundo empurra a
 * vendedora para o timeout. Contar em produção é a única forma de saber se uma
 * mudança realmente reduziu o número, em vez de só parecer mais rápida num teste.
 *
 * Cada `dbQuery` é um checkout: `pool.query` pega uma conexão, roda e devolve.
 * `dbTransaction` é UM checkout, não importa quantas consultas rode dentro.
 *
 * A trilha (o texto da consulta) só é guardada com `DB_TRACE=1`, e é limitada:
 * medição não pode virar vazamento de memória nem despejar SQL em log de produção.
 */
let checkouts = 0;
const TRILHA_MAXIMA = 500;
const trilha: Array<{ sql: string; ms: number }> = [];

function anotarCheckout(text: string, ms: number): void {
  checkouts += 1;
  if (process.env.DB_TRACE !== "1" || trilha.length >= TRILHA_MAXIMA) return;
  trilha.push({ sql: text.replace(/\s+/g, " ").trim().slice(0, 120), ms });
}

/** Quantos checkouts aconteceram até agora neste processo. */
export function checkoutsDoPool(): number {
  return checkouts;
}

/** Trilha das consultas desde o último `zerarContabilidade` (só com `DB_TRACE=1`). */
export function trilhaDeConsultas(): ReadonlyArray<{ sql: string; ms: number }> {
  return trilha;
}

export function zerarContabilidade(): void {
  checkouts = 0;
  trilha.length = 0;
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
      orders_report_at   TIMESTAMPTZ,
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

/**
 * O BOOTSTRAP ANTIGO, e por que ele voltou a ter dono (30/08/2026).
 *
 * ⚠️ Ele deixou de ser código morto quando o projeto ganhou portão automático.
 * Descoberto ao montar o CI: **as tabelas base — `workspace_marketplace_syncs`,
 * `workspace_integrations`, `accounts` e companhia — NÃO são criadas por
 * migration nenhuma.** Elas nasceram deste `createSchema`, antes das migrations
 * versionadas existirem, e as migrations partem do princípio de que já estão lá:
 * a 0002 é um `ALTER TABLE workspace_marketplace_syncs`, que falha em banco
 * novo.
 *
 * Consequência que ninguém tinha medido: **o repositório não conseguia
 * reconstruir o próprio schema do zero.** O schema completo só existia em
 * produção, como resíduo de uma versão deste arquivo que já não roda. Nenhum
 * ambiente novo — CI, staging, a máquina de quem entra no time — subia sem
 * copiar produção.
 *
 * ⚠️ ISTO NÃO ABRE A PORTA QUE A ADR FECHOU. "Runtime, sync e health nunca
 * corrigem schema" continua valendo, e é por isso que a guarda de host mora
 * DENTRO da função em vez de na chamada: em produção o host não é local e ela
 * lança, então nem um erro de configuração consegue transformar isto em DDL
 * implícito no caminho de uma requisição. Alvo descartável, e só ele.
 */
export async function criarSchemaBaseParaTesteLocal(): Promise<void> {
  const alvo = process.env.DATABASE_URL;
  if (!alvo) throw new Error("BLOCKED: sem DATABASE_URL para criar schema base.");
  const host = new URL(alvo).hostname;
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error(`BLOCKED: schema base só é criado em banco descartável; "${host}" não é local.`);
  }
  await createSchema();
}

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
  const comecou = performance.now();
  const res = await getPool().query(text, params);
  anotarCheckout(text, performance.now() - comecou);
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
  const comecou = performance.now();
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
    // Uma transação inteira é UM checkout — é isso que disputa slot no pool.
    anotarCheckout("BEGIN ... COMMIT", performance.now() - comecou);
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
