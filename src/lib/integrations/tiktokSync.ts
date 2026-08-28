import { dbQuery, dbTransaction, hasDb, type DbQuery } from "../db";
import { currentWorkspaceId } from "../workspaceScope";
import {
  getTiktokOrderDetail,
  getTiktokOrderList,
  getTiktokOrderStatement,
  getTiktokProducts,
  ORDER_DETAIL_BATCH,
  type TiktokShopRef,
} from "../tiktok";
import {
  getTiktokShops, refreshTiktokShopIfNeeded,
  TiktokConnectionError, type TiktokShop,
} from "../tiktokStore";
import { saveCanonicalOrders, saveCanonicalProducts } from "./canonicalStore";
import {
  normalizeTiktokOrder,
  normalizeTiktokProducts,
  tiktokStatementSettled,
  parseUnmappedStatuses,
  TIKTOK_UNMAPPED_STATUS_CODE,
  tiktokUnmappedOrderStatuses,
  TiktokUnmappedStatusError,
  validateTiktokOrderForSync,
  type TiktokOrder,
  type TiktokProduct,
  type TiktokStatement,
} from "./tiktokCanonical";
import { deriveTiktokSyncPhase, resolveTiktokShop, type TiktokSyncPhase } from "./tiktokContract";
import {
  acceptPageToken,
  fencedTiktokExternalRead,
  fencedTiktokMutation,
  hasSyncBudget,
  nextTiktokOrderWindow,
  requireTiktokLeaseRow,
  TiktokLeaseLostError,
  tiktokSeedSyncWindow,
  TIKTOK_SYNC_WINDOW_DAYS,
  validateTiktokOrderBatch,
} from "./tiktokSyncControl";
import { allocateTiktokFinancialQuota, type TiktokFinancialCandidate } from "./tiktokFinancialScheduler";

// Sync do TikTok Shop — mesma máquina de estados do Mercado Livre e da Shopee
// (lease + cursor por janela), adaptada ao que a API do TikTok impõe e ao que
// foi observado na loja real em 10/08/2026 (ver docs/tiktok-shop-integracao.md):
//
//   - `order/search` pagina por `page_token` e aceita janela por `create_time`;
//   - `order/detail` aceita vários `ids` por chamada (ORDER_DETAIL_BATCH);
//   - o extrato (`statement_transactions`) é POR PEDIDO e só existe depois do
//     settlement — como o escrow da Shopee, é conciliação complementar e não
//     pode travar a ingestão do pedido.
//
// ⚠️ O extrato devolve os valores que o TikTok cobra com sinal NEGATIVO; a
// inversão para a convenção canônica (positivo = debitado do vendedor) está em
// `canonicalTiktokFees`, com teste.

const PROVIDER = "tiktok_shop";
const DAY = 86_400_000;
// Alvo e janela moram em tiktokSyncControl — a MESMA semente vale para o
// callback (tiktokStore) e para o ensureSyncRow daqui.
const WINDOW_DAYS = TIKTOK_SYNC_WINDOW_DAYS;
const FRESH_FOR_MS = 10 * 60_000;
/** Pedidos por passo que buscam extrato — o extrato é uma chamada por pedido. */
const STATEMENT_BATCH_SIZE = 10;
const STATEMENT_BATCHES_PER_STEP = 10;
/** Limites defensivos: só marcamos cobertura quando a paginação termina. */
const MAX_PAGES_PER_WINDOW = 100;
const MAX_PRODUCT_PAGES = 100;

class SyncBudgetExhausted extends Error {}

function isTiktokReauthError(error: unknown): error is Error & { code: "REAUTH_REQUIRED" } {
  return error instanceof Error && (error as Error & { code?: string }).code === "REAUTH_REQUIRED";
}

/** `connection_id` canônico de uma loja TikTok. */
export { tiktokConnectionId } from "./tiktokContract";

interface SyncRow {
  status: "pending" | "syncing" | "complete" | "error";
  target_from: Date | string;
  target_to: Date | string;
  covered_from: Date | string | null;
  covered_to: Date | string | null;
  cursor_from: Date | string;
  cursor_to: Date | string;
  processed_orders: number;
  products_synced_at: Date | string | null;
  products_total: number;
  active_products: number;
  products_complete: boolean;
  lease_until: Date | string | null;
  cursor_token: string | null;
  last_error: string | null;
  last_success_at: Date | string | null;
  financial_backlog?: number;
}

export interface TiktokSyncStatus {
  status: "pending" | "syncing" | "complete" | "error" | "unavailable";
  progress: number;
  processedOrders: number;
  coveredFrom: string | null;
  coveredTo: string | null;
  productsSyncedAt: string | null;
  productsTotal: number;
  activeProducts: number;
  lastError: string | null;
  lastSuccessAt: string | null;
  busy?: boolean;
  phase: TiktokSyncPhase;
  ordersComplete: boolean;
  productsComplete: boolean;
  financialBacklog: number;
  error: TiktokSyncError | null;
}

export type TiktokSyncErrorCode = "SYNC_RETRYABLE" | "REAUTH_REQUIRED" | typeof TIKTOK_UNMAPPED_STATUS_CODE;

export interface TiktokSyncError {
  code: TiktokSyncErrorCode;
  message: string;
  retryable: boolean;
  /** Status que a API trouxe e o mapa não conhece, com quantos pedidos cada um. */
  unmappedStatuses?: Array<{ status: string; orders: number }>;
}

/**
 * Falha de status novo NÃO é "tentar de novo": repetir o ciclo devolve o mesmo
 * status e a mesma parada. Ela precisa chegar à tela com o NOME do status, para
 * virar uma linha no `MAPA_STATUS` — por isso ganha código próprio,
 * `retryable: false` e a lista já estruturada. A leitura do `last_error`
 * acontece aqui, no servidor: a tela recebe dado, não texto para reparsear.
 */
function syncError(lastError: string): TiktokSyncError {
  if (!lastError.startsWith(`${TIKTOK_UNMAPPED_STATUS_CODE}:`)) {
    return { code: "SYNC_RETRYABLE", message: lastError, retryable: true };
  }
  return {
    code: TIKTOK_UNMAPPED_STATUS_CODE,
    message: lastError,
    retryable: false,
    unmappedStatuses: parseUnmappedStatuses(lastError),
  };
}

function iso(value: Date | string | null): string | null {
  return value ? new Date(value).toISOString() : null;
}

function publicStatus(row?: SyncRow, busy = false): TiktokSyncStatus {
  if (!row) {
    return {
      status: "unavailable", progress: 0, processedOrders: 0,
      coveredFrom: null, coveredTo: null, productsSyncedAt: null,
      productsTotal: 0, activeProducts: 0, lastError: null, lastSuccessAt: null,
      phase: "unavailable", error: null,
      ordersComplete: false, productsComplete: false, financialBacklog: 0,
    };
  }
  const alvoDe = new Date(row.target_from).getTime();
  const alvoAte = new Date(row.target_to).getTime();
  const cobertoDe = row.covered_from ? new Date(row.covered_from).getTime() : alvoAte;
  const total = Math.max(1, alvoAte - alvoDe);
  const progresso = Math.min(1, Math.max(0, (alvoAte - cobertoDe) / total));
  const phase = deriveTiktokSyncPhase({
    available: true,
    status: row.status,
    hasCoverage: Boolean(row.covered_from),
    hasSuccess: Boolean(row.last_success_at),
    hasFinancialBacklog: (row.financial_backlog ?? 0) > 0,
  });
  return {
    status: busy ? "syncing" : row.status,
    progress: Number(progresso.toFixed(3)),
    processedOrders: row.processed_orders,
    coveredFrom: iso(row.covered_from),
    coveredTo: iso(row.covered_to),
    productsSyncedAt: iso(row.products_synced_at),
    productsTotal: row.products_total,
    activeProducts: row.active_products,
    lastError: row.last_error,
    lastSuccessAt: iso(row.last_success_at),
    busy,
    phase,
    ordersComplete: row.status === "complete" || (Boolean(row.covered_from) && !row.cursor_token
      && new Date(row.cursor_to).getTime() <= new Date(row.target_from).getTime()),
    productsComplete: row.products_complete,
    financialBacklog: row.financial_backlog ?? 0,
    error: row.status === "error" && row.last_error ? syncError(row.last_error) : null,
  };
}

function connectionErrorStatus(error: TiktokConnectionError): TiktokSyncStatus {
  return {
    ...publicStatus(),
    status: "error",
    phase: error.code === "REAUTH_REQUIRED" ? "reauth_required" : "retryable_error",
    lastError: error.message,
    error: { code: error.code, message: error.message, retryable: false },
  };
}

async function getSyncRow(connectionId: string): Promise<SyncRow | undefined> {
  const rows = await dbQuery<SyncRow>(
    `SELECT status, target_from, target_to, covered_from, covered_to, cursor_from, cursor_to,
            processed_orders, products_synced_at, products_total, active_products,
            products_complete, lease_until, cursor_token, last_error, last_success_at,
            (SELECT COUNT(*)::int FROM workspace_channel_orders o
              WHERE o.workspace_id = sync.workspace_id AND o.provider = sync.provider
                AND o.connection_id = sync.connection_id
                AND o.status IN ('paid', 'shipped', 'delivered')
                AND NOT (o.financial_settled
                  OR COALESCE((o.raw #>> '{_sellercore,statementSettled}')::boolean, false))) AS financial_backlog
       FROM workspace_marketplace_syncs sync
      WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3`,
    [currentWorkspaceId(), PROVIDER, connectionId]
  );
  return rows[0];
}

async function ensureSyncRow(connectionId: string): Promise<SyncRow> {
  const existente = await getSyncRow(connectionId);
  if (existente) return existente;
  const ate = new Date();
  // Conta nova importa o MÊS VIGENTE (decisão da Ana, 27/08/2026); a semente é
  // a mesma do callback (tiktokStore). Loja antiga não é tocada: o INSERT só
  // cria a linha quando ela não existe.
  const seed = tiktokSeedSyncWindow(ate.getTime());
  await dbQuery(
    `INSERT INTO workspace_marketplace_syncs
       (workspace_id, provider, connection_id, status, target_from, target_to,
        cursor_from, cursor_to, processed_orders)
     VALUES ($1, $2, $3, 'pending', $4, $5, $6, $5, 0)
     ON CONFLICT (workspace_id, provider, connection_id) DO NOTHING`,
    [
      currentWorkspaceId(), PROVIDER, connectionId,
      new Date(seed.targetFromMs).toISOString(), ate.toISOString(),
      new Date(seed.cursorFromMs).toISOString(),
    ]
  );
  return (await getSyncRow(connectionId))!;
}

export async function ensureTiktokSyncState(connectionId: string): Promise<TiktokSyncStatus> {
  if (!hasDb()) return publicStatus();
  return publicStatus(await ensureSyncRow(connectionId));
}

/** Reabre apenas a faixa recente quando um backfill concluído envelheceu. */
export async function requestTiktokSync(connectionId: string): Promise<TiktokSyncStatus> {
  const row = await ensureSyncRow(connectionId);
  const lastSuccess = row.last_success_at ? new Date(row.last_success_at).getTime() : 0;
  if (row.status === "complete" && Date.now() - lastSuccess > FRESH_FOR_MS) {
    const now = new Date();
    const coveredTo = row.covered_to ? new Date(row.covered_to) : new Date(row.target_to);
    const cursorFrom = new Date(Math.max(coveredTo.getTime() - DAY, now.getTime() - WINDOW_DAYS * DAY));
    await dbQuery(
      `UPDATE workspace_marketplace_syncs
          SET status = 'pending', target_to = $4, cursor_from = $5, cursor_to = $4,
              cursor_token = NULL, updated_at = now()
        WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3`,
      [currentWorkspaceId(), PROVIDER, connectionId, now, cursorFrom]
    );
    return publicStatus(await getSyncRow(connectionId));
  }
  return publicStatus(row);
}

/**
 * Reabre todo o intervalo já definido para a conexão sem apagar pedidos,
 * itens, fees ou produtos. Serve para reaplicar um normalizador corrigido aos
 * payloads reais; cada página confirmada substitui os registros por upsert e a
 * cobertura só volta a avançar depois da persistência bem-sucedida.
 */
export async function requestTiktokFullReprocess(connectionId: string): Promise<TiktokSyncStatus> {
  await ensureSyncRow(connectionId);
  const rows = await dbQuery(
    `UPDATE workspace_marketplace_syncs
        SET status='pending', covered_from=NULL, covered_to=NULL,
            cursor_from=GREATEST(target_from, target_to - interval '15 days'),
            cursor_to=target_to, cursor_token=NULL, processed_orders=0,
            products_synced_at=NULL, products_complete=false,
            last_error=NULL, lease_until=NULL, updated_at=now()
      WHERE workspace_id=$1 AND provider=$2 AND connection_id=$3
        AND (lease_until IS NULL OR lease_until < now())
      RETURNING 1`,
    [currentWorkspaceId(), PROVIDER, connectionId]
  );
  if (!rows.length) throw new Error("Sincronizacao TikTok ativa; reprocessamento nao iniciado.");
  return publicStatus(await getSyncRow(connectionId));
}

/** Referência de chamada da loja: token + cipher. */
function refDaLoja(loja: TiktokShop): TiktokShopRef {
  return { accessToken: loja.accessToken, shopCipher: loja.shopCipher };
}

async function withLeaseFence<T>(
  connectionId: string,
  ownershipToken: string,
  write: (query: DbQuery) => Promise<T>
): Promise<T> {
  return fencedTiktokMutation(dbTransaction, async (query) => {
    const owned = await query(
      `SELECT 1 FROM workspace_marketplace_syncs
        WHERE workspace_id=$1 AND provider=$2 AND connection_id=$3
          AND lease_until::text=$4 AND lease_until > clock_timestamp()
        FOR UPDATE`,
      [currentWorkspaceId(), PROVIDER, connectionId, ownershipToken]
    );
    return Boolean(owned[0]);
  }, write);
}

async function syncProducts(
  loja: TiktokShop,
  connectionId: string,
  assertOwnership: () => Promise<string>,
  deadline: number
): Promise<void> {
  const shop = refDaLoja(loja);
  const coletados: TiktokProduct[] = [];
  let pageToken: string | undefined;
  let terminou = false;
  for (let pagina = 0; pagina < MAX_PRODUCT_PAGES; pagina++) {
    if (!hasSyncBudget(deadline, Date.now())) throw new SyncBudgetExhausted();
    const lista = await fencedTiktokExternalRead(
      assertOwnership,
      () => getTiktokProducts(shop, { pageToken })
    );
    coletados.push(...(lista.items as TiktokProduct[]));
    pageToken = lista.nextPageToken;
    if (!pageToken) {
      terminou = true;
      break;
    }
  }
  if (!terminou) throw new Error("Catálogo TikTok excedeu o limite seguro de paginação.");

  const ofertas: ReturnType<typeof normalizeTiktokProducts> = [];
  let produtosIncompletos = 0;
  for (const produto of coletados) {
    try {
      ofertas.push(...normalizeTiktokProducts(produto));
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      // Rascunhos/itens fora de venda podem vir sem preço ou estoque. Eles não
      // viram oferta canônica (null não pode ser fabricado como zero), mas uma
      // linha incompleta também não deve descartar todo o catálogo válido.
      produtosIncompletos++;
    }
  }
  if (produtosIncompletos > 0) {
    console.warn("Produtos TikTok incompletos foram excluídos do snapshot canônico", {
      count: produtosIncompletos,
    });
  }
  // A ausência só é evidência depois que TODAS as páginas chegaram.
  // Em erro/timeout saímos antes deste ponto e preservamos o último snapshot
  // válido. Não apagamos: fechamos ofertas antigas para manter histórico.
  const ids = ofertas.map((offer) => offer.externalProductId);
  const ownershipToken = await assertOwnership();
  // Snapshot, reconciliação e checkpoint formam uma unidade cercada pelo lease.
  await withLeaseFence(connectionId, ownershipToken, async (query) => {
    await saveCanonicalProducts({ provider: PROVIDER, connectionId }, ofertas, query);
    await query(
      // Só remarca quem ainda não está fechado (ADR-022). Sem a última linha, todo
      // produto já encerrado era reescrito a cada ciclo — era o resíduo de churn
      // que sobrou em workspace_channel_products depois das duas primeiras rodadas.
      // (O equivalente na Shopee se limita sozinho: lá o filtro é
      //  `synced_at < sweepStartedAt`, que deixa de casar após a primeira passada.)
      `UPDATE workspace_channel_products
          SET status='closed', provider_status='NOT_PRESENT_IN_COMPLETE_SNAPSHOT',
              available_qty=0, synced_at=now()
        WHERE workspace_id=$1 AND provider=$2 AND connection_id=$3
          AND NOT (external_product_id = ANY($4::text[]))
          AND (status, provider_status, available_qty)
                IS DISTINCT FROM ('closed', 'NOT_PRESENT_IN_COMPLETE_SNAPSHOT', 0)`,
      [currentWorkspaceId(), PROVIDER, connectionId, ids]
    );

    // `status: "ACTIVATE"` é o publicado; o resto é rascunho, suspenso ou removido.
    const ativos = ofertas.filter((offer) => offer.status === "active").length;
    const checkpoint = await query(
      `UPDATE workspace_marketplace_syncs
        SET products_synced_at = now(), products_total = $4, active_products = $5,
            products_complete = true, updated_at = now()
      WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
        AND lease_until::text = $6 AND lease_until > clock_timestamp()
      RETURNING 1`,
      [currentWorkspaceId(), PROVIDER, connectionId, ofertas.length, ativos, ownershipToken]
    );
    // `now()` fica congelado no inicio da transacao no PostgreSQL. A checagem
    // com `clock_timestamp()` precisa acontecer depois das escritas para que
    // uma expiracao durante o snapshot rejeite o checkpoint e reverta tudo.
    requireTiktokLeaseRow(checkpoint);
  });
}

/** Detalhe dos pedidos da janela → canônico. Devolve quantos gravou. */
async function saveOrderWindow(
  loja: TiktokShop,
  connectionId: string,
  ids: string[],
  assertOwnership: () => Promise<string>
): Promise<number> {
  if (!ids.length) return 0;
  const shop = refDaLoja(loja);
  let gravados = 0;
  for (let i = 0; i < ids.length; i += ORDER_DETAIL_BATCH) {
    const lote = ids.slice(i, i + ORDER_DETAIL_BATCH);
    const pedidos = (await fencedTiktokExternalRead(
      assertOwnership,
      () => getTiktokOrderDetail(shop, lote)
    )) as TiktokOrder[];
    validateTiktokOrderBatch(lote, pedidos);
    // Status fora do `MAPA_STATUS` para a ingestão de propósito — inventar um
    // canônico corromperia faturamento e cobertura. O que não pode acontecer é
    // parar em silêncio: falhamos UMA vez, nomeando cada status novo e quantos
    // pedidos o trouxeram, para que a mensagem chegue ao `last_error` e à tela
    // em vez de virar "falha temporária" repetida a cada ciclo do cron.
    const statusNovos = tiktokUnmappedOrderStatuses(pedidos);
    if (statusNovos.length) throw new TiktokUnmappedStatusError(statusNovos);
    for (const pedido of pedidos) validateTiktokOrderForSync(pedido);
    const token = await assertOwnership();
    await withLeaseFence(connectionId, token, async (query) => {
      await saveCanonicalOrders(
        { provider: PROVIDER, connectionId },
        pedidos.map((pedido) => normalizeTiktokOrder(pedido)), query
      );
      // A inicialização `statementSettled:false` no raw morreu com a ADR-026
      // R2: a coluna `financial_settled` nasce false por DEFAULT — pedido novo
      // já vem "não liquidado" sem nenhuma escrita extra (e sem o churn que
      // essa marcação causava antes do filtro da ADR-022).
    });
    gravados += pedidos.length;
  }
  return gravados;
}

/**
 * Conciliação do extrato: pedidos com receita e ainda sem tarifa gravada.
 * Roda depois dos pedidos, em lote pequeno — a tarifa só fecha no settlement e
 * não pode travar o faturamento.
 */
async function syncMissingStatements(
  loja: TiktokShop,
  connectionId: string,
  assertOwnership: () => Promise<string>,
  deadline: number
): Promise<number> {
  if (!hasSyncBudget(deadline, Date.now())) return 0;
  const [countRow] = await dbQuery<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM workspace_channel_orders o
      WHERE o.workspace_id=$1 AND o.provider=$2 AND o.connection_id=$3
        AND o.status IN ('paid','shipped','delivered')
        AND NOT (o.financial_settled
          OR COALESCE((o.raw #>> '{_sellercore,statementSettled}')::boolean, false))`,
    [currentWorkspaceId(), PROVIDER, connectionId]
  );
  const total = countRow?.total ?? 0;
  if (!total) return 0;
  // Prioriza os pedidos mais antigos: settlement é tardio, então eles são os
  // candidatos com maior chance de já possuir extrato. Ao marcar cada sucesso
  // como liquidado, a fila avança deterministicamente sem depender de um offset
  // temporal sobre milhares de pedidos (que fazia o cron quase nunca convergir).
  const candidates = await dbQuery<{ external_order_id: string; occurred_at: string; last_attempt_at: string | null; last_outcome: "pending" | "retryable_error" | null }>(
    `WITH candidates AS (
      -- Colunas primeiro (ADR-026 R2); o fallback ao raw cobre linhas antigas
      -- até o backfill concluir.
      SELECT o.external_order_id, o.occurred_at,
            COALESCE(o.settlement_attempt_at,
              NULLIF(o.raw #>> '{_sellercore,statementLastAttemptAt}', '')::timestamptz) AS last_attempt_at,
            COALESCE(o.settlement_outcome,
              NULLIF(o.raw #>> '{_sellercore,statementLastOutcome}', '')) AS last_outcome,
            ROW_NUMBER() OVER (PARTITION BY o.occurred_at >= now() - interval '30 days'
              ORDER BY COALESCE(o.settlement_attempt_at,
                NULLIF(o.raw #>> '{_sellercore,statementLastAttemptAt}', '')::timestamptz) ASC NULLS FIRST,
                       o.occurred_at ASC, o.external_order_id) AS class_rank
       FROM workspace_channel_orders o
      WHERE o.workspace_id = $1 AND o.provider = $2 AND o.connection_id = $3
        AND o.status IN ('paid', 'shipped', 'delivered')
        AND NOT (o.financial_settled
          OR COALESCE((o.raw #>> '{_sellercore,statementSettled}')::boolean, false))
        AND (COALESCE(o.settlement_attempt_at,
              NULLIF(o.raw #>> '{_sellercore,statementLastAttemptAt}', '')::timestamptz) IS NULL
          OR COALESCE(o.settlement_attempt_at,
              NULLIF(o.raw #>> '{_sellercore,statementLastAttemptAt}', '')::timestamptz)
             + CASE WHEN COALESCE(o.settlement_outcome,
                      o.raw #>> '{_sellercore,statementLastOutcome}') = 'pending'
                    THEN interval '6 hours' ELSE interval '15 minutes' END <= now())
    ) SELECT external_order_id, occurred_at, last_attempt_at, last_outcome
        FROM candidates WHERE class_rank <= 100`,
    [currentWorkspaceId(), PROVIDER, connectionId]
  );
  const pendentes = allocateTiktokFinancialQuota(candidates.map((row): TiktokFinancialCandidate => ({
    orderId: row.external_order_id, occurredAt: new Date(row.occurred_at).toISOString(),
    lastAttemptAt: row.last_attempt_at ? new Date(row.last_attempt_at).toISOString() : null,
    lastOutcome: row.last_outcome,
  })), STATEMENT_BATCH_SIZE).map((item) => ({ external_order_id: item.orderId }));
  if (!pendentes.length) return 0;

  const shop = refDaLoja(loja);
  let attempted = 0;
  for (const linha of pendentes) {
    if (!hasSyncBudget(deadline, Date.now())) break;
    attempted++;
    try {
      const bruto = await fencedTiktokExternalRead(
        assertOwnership,
        () => getTiktokOrderStatement(shop, linha.external_order_id)
      );
      // A resposta traz o extrato do pedido; alguns retornos embrulham em lista.
      const statement = ((bruto as { statement_transactions?: TiktokStatement[] })
        ?.statement_transactions?.[0] ?? bruto) as TiktokStatement | null;
      if (!tiktokStatementSettled(statement)) {
        // O parser antigo persistia zeros do placeholder pré-settlement como
        // fees. Uma resposta real bem-sucedida e ainda não liquidada permite
        // remover somente essas linhas sem evidência; falhas de rede não tocam
        // no dado existente.
        const token = await assertOwnership();
        await withLeaseFence(connectionId, token, async (query) => {
          await query(
          `DELETE FROM workspace_channel_order_fees f
            WHERE f.workspace_id=$1 AND f.provider=$2 AND f.connection_id=$3
              AND f.external_order_id=$4
              AND f.provider_fee_code IN ('fee_and_tax_amount','shipping_cost_amount')
              AND NOT EXISTS (SELECT 1 FROM workspace_channel_orders o
                WHERE o.workspace_id=f.workspace_id AND o.provider=f.provider
                  AND o.connection_id=f.connection_id AND o.external_order_id=f.external_order_id
                  AND (o.financial_settled
                    OR COALESCE((o.raw #>> '{_sellercore,statementSettled}')::boolean,false)))`,
          [currentWorkspaceId(), PROVIDER, connectionId, linha.external_order_id]
          );
          await markStatementAttempt(query, connectionId, linha.external_order_id, "pending");
        });
        continue;
      }
      const settledStatement = statement!;
      const detalhes = (await fencedTiktokExternalRead(
        assertOwnership,
        () => getTiktokOrderDetail(shop, [linha.external_order_id])
      )) as TiktokOrder[];
      validateTiktokOrderBatch([linha.external_order_id], detalhes);
      const [pedido] = detalhes;
      const token = await assertOwnership();
      // Conclusão do produto em COLUNAS (ADR-026 R2): o raw fica imutável, só
      // com o que o TikTok mandou. O canonicalStore segue removendo
      // `_sellercore` de todo raw de entrada — o marketplace nunca injeta nada.
      await withLeaseFence(connectionId, token, async (query) => {
        await saveCanonicalOrders(
          { provider: PROVIDER, connectionId },
          [normalizeTiktokOrder(pedido, { statement })], query
        );
        await query(
        `UPDATE workspace_channel_orders
            SET financial_settled = true,
                evidence_fees = $5, evidence_seller_shipping = $6,
                -- O endpoint atual não separa estas categorias. Ausência de
                -- evidência permanece desconhecida, mesmo com extrato liquidado.
                -- ⚠️ CONDIÇÃO DA R2-b (revisão do Delta, 28/08/2026): antes de
                -- extinguir o raw/fallback, estas três trocam para preservar o
                -- valor existente (evidence_ads = workspace_channel_orders.evidence_ads,
                -- etc.) — 219 pedidos têm true de um escritor antigo, e o
                -- rebaixamento true→false precisa ser impossível por construção.
                evidence_ads = false, evidence_taxes_withheld = false, evidence_refunds = false,
                synced_at = now()
          WHERE workspace_id=$1 AND provider=$2 AND connection_id=$3 AND external_order_id=$4
            -- ADR-022: não regrava linha que já está idêntica.
            AND (financial_settled, evidence_fees, evidence_seller_shipping,
                 evidence_ads, evidence_taxes_withheld, evidence_refunds)
                IS DISTINCT FROM (true, $5, $6, false, false, false)`,
        [currentWorkspaceId(), PROVIDER, connectionId, linha.external_order_id,
          Object.hasOwn(settledStatement, "fee_and_tax_amount"),
          Object.hasOwn(settledStatement, "shipping_cost_amount")]
        );
        await markStatementAttempt(query, connectionId, linha.external_order_id, "settled");
      });
    } catch (error) {
      if (error instanceof TiktokLeaseLostError || isTiktokReauthError(error)) throw error;
      // Extrato ainda indisponível (sem settlement) ou erro pontual: a próxima
      // passagem tenta de novo. Não gravar nada é melhor que gravar tarifa zero.
      console.warn("Falha ao conciliar extrato TikTok; nova tentativa será feita", {
        reason: error instanceof Error ? error.message : "Erro desconhecido",
      });
      const token = await assertOwnership();
      await withLeaseFence(connectionId, token, (query) =>
        markStatementAttempt(query, connectionId, linha.external_order_id, "retryable_error")
      );
      if (error instanceof Error && (error as Error & { code?: string }).code === "RATE_LIMITED") {
        throw new SyncBudgetExhausted();
      }
    }
  }
  return attempted;
}

async function markStatementAttempt(
  query: DbQuery,
  connectionId: string,
  orderId: string,
  outcome: "pending" | "settled" | "retryable_error"
): Promise<void> {
  // Contabilidade de tentativa em coluna (ADR-026 R2) — o raw não é tocado.
  await query(
    `UPDATE workspace_channel_orders
        SET settlement_attempt_at = clock_timestamp(), settlement_outcome = $5
      WHERE workspace_id=$1 AND provider=$2 AND connection_id=$3 AND external_order_id=$4`,
    [currentWorkspaceId(), PROVIDER, connectionId, orderId, outcome]
  );
}

async function reconcileStatementBatches(
  loja: TiktokShop,
  connectionId: string,
  assertOwnership: () => Promise<string>,
  deadline: number
): Promise<void> {
  for (let batch = 0; batch < STATEMENT_BATCHES_PER_STEP && hasSyncBudget(deadline, Date.now()); batch++) {
    const attempted = await syncMissingStatements(loja, connectionId, assertOwnership, deadline);
    if (attempted < STATEMENT_BATCH_SIZE) break;
  }
}

/** Um passo do sync: produtos (uma vez), janela de pedidos, extratos pendentes. */
export async function runTiktokSyncStep(
  connectionId: string,
  prepareSync = true,
  deadline = Number.POSITIVE_INFINITY
): Promise<TiktokSyncStatus> {
  if (!hasDb()) return publicStatus();

  const lojas = await getTiktokShops();
  const loja: TiktokShop | undefined = resolveTiktokShop(lojas, connectionId);
  if (!loja) return publicStatus();
  if (prepareSync) await requestTiktokSync(connectionId);
  const workspaceId = currentWorkspaceId();

  // Lease: impede dois passos concorrentes sobre a mesma loja.
  const arrendado = await dbQuery<SyncRow & { ownership_token: string }>(
    `UPDATE workspace_marketplace_syncs
        SET lease_until = now() + interval '5 minutes', status = 'syncing', updated_at = now()
      WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
        AND (status <> 'complete' OR EXISTS (
          SELECT 1 FROM workspace_channel_orders o
           WHERE o.workspace_id=$1 AND o.provider=$2 AND o.connection_id=$3
             AND o.status IN ('paid','shipped','delivered')
             AND COALESCE((o.raw #>> '{_sellercore,statementSettled}')::boolean,false)=false
        ))
        AND (lease_until IS NULL OR lease_until < now())
      RETURNING status, target_from, target_to, covered_from, covered_to, cursor_from, cursor_to,
                processed_orders, products_synced_at, products_total, active_products,
                products_complete, lease_until, cursor_token, last_error, last_success_at,
                lease_until::text AS ownership_token`,
    [workspaceId, PROVIDER, connectionId]
  );
  const linha = arrendado[0];
  if (!linha) return publicStatus(await getSyncRow(connectionId), true);
  let ownershipToken = linha.ownership_token;

  // `lease_until` funciona tambem como fencing token sem alterar o schema. Cada
  // renovacao troca o valor atomicamente; quem reteve o token anterior deixa de
  // poder fazer checkpoint, concluir cobertura ou liberar o lease novo.
  const assertOwnership = async (): Promise<string> => {
    const renewed = await dbQuery<{ ownership_token: string }>(
      `UPDATE workspace_marketplace_syncs
          SET lease_until = now() + interval '5 minutes', updated_at = now()
        WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
          AND lease_until::text = $4 AND lease_until > now()
        RETURNING lease_until::text AS ownership_token`,
      [workspaceId, PROVIDER, connectionId, ownershipToken]
    );
    if (!renewed[0]) throw new TiktokLeaseLostError();
    ownershipToken = renewed[0].ownership_token;
    return ownershipToken;
  };

  const releaseForResume = async (lastError: string | null): Promise<boolean> => {
    const released = await dbQuery(
      `UPDATE workspace_marketplace_syncs
          SET status = 'pending', last_error = $5, lease_until = NULL, updated_at = now()
        WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
          AND lease_until::text = $4`,
      [workspaceId, PROVIDER, connectionId, ownershipToken, lastError]
    );
    return released.length > 0;
  };

  try {
    const lojaAtual = await fencedTiktokExternalRead(
      assertOwnership,
      () => refreshTiktokShopIfNeeded(loja)
    );
    // Financeiro precisa de uma fatia garantida do orçamento. Catálogo e
    // paginação de pedidos podem consumir a passada inteira em lojas grandes;
    // quando a conciliação ficava somente no fim, o backlog nunca recebia uma
    // chamada apesar de o cron executar com sucesso.
    //
    // ⚠️ Mas ela NÃO pode derrubar a passada. `syncMissingStatements` converte
    // `RATE_LIMITED` em `SyncBudgetExhausted`, e como esta chamada é a primeira
    // do `try`, um rate limit no extrato abortava tudo **antes de paginar um
    // único pedido** — sem gravar erro, porque `SyncBudgetExhausted` é tratado
    // como fim normal de orçamento. A loja `7494291387899806731` ficou de
    // 11/08 a 14/08/2026 sem nenhum pedido novo por causa disso, com o cron
    // "executando com sucesso" de hora em hora.
    //
    // Pedido é o artefato primário e tem checkpoint por página; extrato é
    // retomável e tem scheduler próprio depois desta função. Então o extrato
    // cede a vez, nunca o contrário.
    try {
      await reconcileStatementBatches(lojaAtual, connectionId, assertOwnership, deadline);
    } catch (erroExtrato) {
      if (!(erroExtrato instanceof SyncBudgetExhausted)) throw erroExtrato;
      // Segue para os pedidos. Se o orçamento acabou de verdade, o próprio laço
      // de paginação para na primeira checagem de `hasSyncBudget`.
    }
    const ordersComplete = Boolean(linha.covered_from)
      && !linha.cursor_token
      && new Date(linha.cursor_to).getTime() <= new Date(linha.target_from).getTime();
    if (ordersComplete) {
      const token = await assertOwnership();
      const released = await dbQuery(
        `UPDATE workspace_marketplace_syncs SET status='complete', last_error=NULL,
            last_success_at=now(), lease_until=NULL, updated_at=now()
          WHERE workspace_id=$1 AND provider=$2 AND connection_id=$3 AND lease_until::text=$4
          RETURNING 1`,
        [workspaceId, PROVIDER, connectionId, token]
      );
      requireTiktokLeaseRow(released);
      return publicStatus(await getSyncRow(connectionId));
    }
    if (!linha.products_synced_at || Date.now() - new Date(linha.products_synced_at).getTime() > FRESH_FOR_MS) {
      await syncProducts(lojaAtual, connectionId, assertOwnership, deadline);
    }

    const cursorAte = new Date(linha.cursor_to).getTime();
    const cursorDe = new Date(linha.cursor_from).getTime();
    const alvoDe = new Date(linha.target_from).getTime();
    const shop = refDaLoja(lojaAtual);

    let pageToken: string | undefined = linha.cursor_token ?? undefined;
    const seenTokens = new Set<string>();
    if (pageToken) seenTokens.add(pageToken);
    let paginacaoConcluida = false;
    for (let pagina = 0; pagina < MAX_PAGES_PER_WINDOW; pagina++) {
      if (!hasSyncBudget(deadline, Date.now())) {
        await releaseForResume(null);
        return publicStatus(await getSyncRow(connectionId));
      }
      const lista = await fencedTiktokExternalRead(
        assertOwnership,
        () => getTiktokOrderList(shop, {
          createTimeGe: Math.floor(cursorDe / 1000),
          createTimeLt: Math.floor(cursorAte / 1000),
          pageToken,
        })
      );
      await saveOrderWindow(lojaAtual, connectionId, lista.items.map((o) => o.id), assertOwnership);
      pageToken = lista.nextPageToken;
      if (!acceptPageToken(seenTokens, pageToken ?? null)) {
        throw new Error("TikTok repetiu o page_token; paginacao interrompida com cursor preservado.");
      }
      if (pageToken) seenTokens.add(pageToken);
      const checkpoint = await dbQuery<{ ownership_token: string }>(
        `UPDATE workspace_marketplace_syncs
            SET cursor_token = $5, processed_orders = processed_orders + $6,
                last_error = NULL, last_success_at = now(),
                lease_until = now() + interval '5 minutes', updated_at = now()
          WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
            AND lease_until::text = $4 AND lease_until > now()
          RETURNING lease_until::text AS ownership_token`,
        [workspaceId, PROVIDER, connectionId, ownershipToken, pageToken ?? null, lista.items.length]
      );
      if (!checkpoint[0]) throw new TiktokLeaseLostError();
      ownershipToken = checkpoint[0].ownership_token;
      if (!pageToken) {
        paginacaoConcluida = true;
        break;
      }
    }
    if (!paginacaoConcluida) {
      throw new Error("Janela de pedidos TikTok excedeu o limite seguro de paginação.");
    }

    // Janela coberta: anda o cursor para trás; sem mais histórico, conclui.
    const decisaoJanela = nextTiktokOrderWindow({
      windowFromMs: cursorDe,
      targetFromMs: alvoDe,
      windowMs: WINDOW_DAYS * DAY,
    });
    const novoAte = decisaoJanela.kind === "complete" ? cursorDe : decisaoJanela.nextToMs;
    const novoDe = decisaoJanela.kind === "complete"
      ? Math.max(alvoDe, cursorDe - WINDOW_DAYS * DAY)
      : decisaoJanela.nextFromMs;

    // Ainda sob o lease: falha inequívoca de autorização precisa marcar a
    // conexão como reauth_required, não desaparecer como erro financeiro.
    await reconcileStatementBatches(lojaAtual, connectionId, assertOwnership, deadline);

    await assertOwnership();
    const completed = await dbQuery(
      `UPDATE workspace_marketplace_syncs
          SET covered_from = LEAST(COALESCE(covered_from, $4), $4),
              covered_to   = GREATEST(COALESCE(covered_to, $5), $5),
              cursor_from = $6, cursor_to = $7,
              cursor_token = NULL,
              status = $8, last_error = NULL, last_success_at = now(),
              lease_until = NULL, updated_at = now()
        WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
          AND lease_until::text = $9
        RETURNING 1`,
      [
        workspaceId, PROVIDER, connectionId,
        new Date(cursorDe).toISOString(),
        new Date(cursorAte).toISOString(),
        new Date(novoDe).toISOString(), new Date(novoAte).toISOString(),
        decisaoJanela.kind === "complete" ? "complete" : "pending", ownershipToken,
      ]
    );
    requireTiktokLeaseRow(completed);
    return publicStatus(await getSyncRow(connectionId));
  } catch (erro) {
    if (erro instanceof TiktokLeaseLostError) throw erro;
    if (erro instanceof SyncBudgetExhausted) {
      await releaseForResume(null);
      return publicStatus(await getSyncRow(connectionId));
    }
    if (isTiktokReauthError(erro) && !(erro instanceof TiktokConnectionError)) {
      // Um access token recusado não prova que o grant foi revogado. Tente o
      // refresh normal primeiro; se funcionar, preserve o cursor e retome no
      // próximo passo com a credencial já persistida.
      try {
        await refreshTiktokShopIfNeeded(loja, Number.POSITIVE_INFINITY);
        await releaseForResume(null);
        return publicStatus(await getSyncRow(connectionId));
      } catch (refreshError) {
        erro = refreshError;
      }
    }
    if (erro instanceof TiktokConnectionError || isTiktokReauthError(erro)) {
      await dbQuery(
        `UPDATE workspace_marketplace_syncs SET status = 'error', last_error = $5, lease_until = NULL, updated_at = now()
          WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3 AND lease_until::text = $4`,
        [workspaceId, PROVIDER, connectionId, ownershipToken, erro.message]
      );
      return connectionErrorStatus(
        erro instanceof TiktokConnectionError
          ? erro
          : new TiktokConnectionError("REAUTH_REQUIRED", (erro as Error).message)
      );
    }
    await dbQuery(
      `UPDATE workspace_marketplace_syncs
          SET status = 'error', last_error = $5, lease_until = NULL, updated_at = now()
        WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3 AND lease_until::text = $4`,
      [workspaceId, PROVIDER, connectionId, ownershipToken, erro instanceof Error ? erro.message : String(erro)]
    );
    return publicStatus(await getSyncRow(connectionId));
  }
}

/** Executa passos até completar ou esgotar o orçamento do cron. */
export async function runTiktokSyncBatch(
  connectionId: string,
  budgetMs = 20_000
): Promise<TiktokSyncStatus> {
  const startedAt = Date.now();
  const deadline = startedAt + budgetMs;
  let status = await runTiktokSyncStep(connectionId, true, deadline);
  while (
    (status.status === "pending" || status.status === "syncing")
    && !status.busy
    && Date.now() - startedAt < budgetMs
  ) {
    status = await runTiktokSyncStep(connectionId, false, deadline);
  }
  return status;
}
