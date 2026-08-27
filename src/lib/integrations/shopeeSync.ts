import { dbQuery, dbTransaction, hasDb } from "../db";
import { currentWorkspaceId } from "../workspaceScope";
import { saveCanonicalOrders, saveCanonicalProducts } from "./canonicalStore";
import type { CanonicalProduct } from "./canonical";
import {
  getShopeeEscrowDetail,
  getShopeeItemBaseInfo,
  getShopeeItemList,
  getShopeeModelList,
  getShopeeOrderDetail,
  getShopeeOrderList,
  ORDER_DETAIL_BATCH,
  ORDER_WINDOW_DAYS,
  ShopeeApiError,
} from "./shopee";
import {
  normalizeShopeeOrder,
  normalizeShopeeProduct,
  ShopeeItemForaDoSnapshot,
  type ShopeeEscrowDetail,
  type ShopeeModel,
  type ShopeeOrderDetail,
  type ShopeeProductItem,
} from "./shopeeCanonical";
import type { IntegrationConnection } from "./types";
import { isShopeeDemoConnection } from "./shopeeConnection";
import {
  createShopeeCatalogCheckpoint,
  decodeShopeeCatalogCheckpoint,
  encodeShopeeCatalogCheckpoint,
  runShopeeCatalogPageBudget,
  collectShopeeOrderSns,
  type ShopeeCatalogCheckpoint,
} from "./shopeePagination";
import { isChannelAuthExpired } from "./authErrors";
import {
  decodeShopeeSyncFailure,
  encodeShopeeSyncFailure,
  fencedShopeeExternalRead,
  nextShopeeEscrowOffset,
  nextShopeeOrderWindow,
  SHOPEE_ESCROW_MARK_SQL,
  validateShopeeCatalogSnapshot,
  validateShopeeOrderBatch,
  type ShopeeFailurePhase,
} from "./shopeeSyncControl";
import { withShopeeSyncWriteFence } from "./shopeeWriteFence";

// Sync da Shopee — mesma máquina de estados do Mercado Livre (lease + cursor por
// janela), adaptada aos limites da API dela (docs/api-shopee.md):
//   - get_order_list aceita no máximo 15 dias por chamada → a janela do cursor
//     é de 15 dias e caminha para trás até cobrir o histórico;
//   - get_order_detail aceita no máximo 50 order_sn por chamada;
//   - o escrow (taxas reais) só existe depois do pagamento, então ele é uma
//     conciliação complementar: não bloqueia a ingestão do pedido.

const PROVIDER = "shopee";
const DAY = 86_400_000;
/** Fase 1 do backfill: a janela que o vendedor vê primeiro, minutos após conectar. */
const RECENT_DAYS = 30;
/**
 * Fase 2: alvo total do histórico. 60 dias até segunda ordem — a extensão para
 * 12 meses depende da decisão de custo do banco (Supabase acima do teto).
 * `SHOPEE_HISTORY_DAYS` permite mudar o alvo sem deploy de código; ao subir o
 * valor, conexões já completas aprofundam o histórico no ciclo seguinte.
 */
const HISTORY_DAYS = historyDaysConfigurados();
const WINDOW_DAYS = ORDER_WINDOW_DAYS; // teto da própria API

function historyDaysConfigurados(): number {
  const dias = Number(process.env.SHOPEE_HISTORY_DAYS ?? "");
  return Number.isFinite(dias) && dias >= RECENT_DAYS ? dias : 60;
}
const FRESH_FOR_MS = 10 * 60_000;
/** Pedidos por passo que buscam escrow — mantém o passo curto no cron. */
const ESCROW_BATCH_SIZE = 20;
const CATALOG_PAGES_PER_STEP = 8;
const CATALOG_STEP_BUDGET_MS = 12_000;

class ShopeeLeaseLostError extends Error {}

interface SyncRow {
  status: "pending" | "syncing" | "complete" | "error";
  target_from: Date | string;
  target_to: Date | string;
  covered_from: Date | string | null;
  covered_to: Date | string | null;
  cursor_from: Date | string;
  cursor_to: Date | string;
  processed_orders: number;
  cursor_offset: number;
  cursor_token: string | null;
  products_synced_at: Date | string | null;
  products_total: number;
  active_products: number;
  products_complete: boolean;
  lease_until: Date | string | null;
  last_error: string | null;
  last_success_at: Date | string | null;
}

export interface ShopeeSyncStatus {
  status: "pending" | "syncing" | "complete" | "error" | "unavailable";
  progress: number;
  processedOrders: number;
  coveredFrom: string | null;
  coveredTo: string | null;
  lastSuccessAt: string | null;
  phase: "idle" | "syncing" | "ready" | ShopeeFailurePhase;
  error: { code: string; message: string; retryable: boolean } | null;
  busy?: boolean;
}

function iso(value: Date | string | null): string | null {
  return value ? new Date(value).toISOString() : null;
}

function publicStatus(row?: SyncRow, busy = false): ShopeeSyncStatus {
  if (!row) {
    return { status: "unavailable", phase: "idle", progress: 0, processedOrders: 0, coveredFrom: null, coveredTo: null, lastSuccessAt: null, error: null };
  }
  const targetFrom = new Date(row.target_from).getTime();
  const targetTo = new Date(row.target_to).getTime();
  const cursorFrom = new Date(row.cursor_from).getTime();
  const span = Math.max(1, targetTo - targetFrom);
  const progress = row.status === "complete"
    ? 100
    : Math.max(0, Math.min(99, Math.round(((targetTo - cursorFrom) / span) * 100)));
  const failure = decodeShopeeSyncFailure(row.last_error);
  const phase = row.status === "error"
    ? failure.phase
    : row.status === "complete" ? "ready" : row.status === "syncing" ? "syncing" : "idle";
  return {
    status: row.status,
    phase,
    progress,
    processedOrders: row.processed_orders,
    coveredFrom: iso(row.covered_from),
    coveredTo: iso(row.covered_to),
    lastSuccessAt: iso(row.last_success_at),
    error: row.last_error ? {
      code: failure.phase === "reauth_required" ? "REAUTH_REQUIRED" : failure.phase === "terminal_error" ? "TERMINAL_ERROR" : "SYNC_FAILED",
      message: failure.message ?? "Falha ao sincronizar a Shopee.",
      retryable: failure.phase === "retryable_error",
    } : null,
    busy: busy || undefined,
  };
}

async function getSyncRow(connectionId: string): Promise<SyncRow | undefined> {
  const rows = await dbQuery<SyncRow>(
    `SELECT status, target_from, target_to, covered_from, covered_to, cursor_from, cursor_to,
            processed_orders, cursor_offset, products_synced_at, products_total, active_products,
            products_complete, lease_until, cursor_token, last_error, last_success_at
       FROM workspace_marketplace_syncs
      WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3`,
    [currentWorkspaceId(), PROVIDER, connectionId]
  );
  return rows[0];
}

async function ensureSyncRow(connectionId: string): Promise<SyncRow> {
  const existing = await getSyncRow(connectionId);
  if (existing) return existing;
  const now = new Date();
  // O alvo nasce curto (fase 1) para o dashboard encher em minutos; ao fechá-lo,
  // o passo estende o alvo até HISTORY_DAYS e segue em background (fase 2).
  const targetFrom = new Date(now.getTime() - Math.min(RECENT_DAYS, HISTORY_DAYS) * DAY);
  const cursorFrom = new Date(Math.max(targetFrom.getTime(), now.getTime() - WINDOW_DAYS * DAY));
  await dbQuery(
    `INSERT INTO workspace_marketplace_syncs
       (workspace_id, provider, connection_id, status, target_from, target_to, cursor_from, cursor_to)
     VALUES ($1,$2,$3,'pending',$4,$5,$6,$5)
     ON CONFLICT (workspace_id, provider, connection_id) DO NOTHING`,
    [currentWorkspaceId(), PROVIDER, connectionId, targetFrom, now, cursorFrom]
  );
  const created = await getSyncRow(connectionId);
  if (!created) throw new Error("Não foi possível iniciar a sincronização da Shopee.");
  return created;
}

export async function ensureShopeeSyncState(connectionId: string): Promise<ShopeeSyncStatus> {
  if (!hasDb()) return publicStatus();
  return publicStatus(await ensureSyncRow(connectionId));
}

/** Reabre a janela recente quando os dados já estão velhos. */
export async function requestShopeeSync(connectionId: string): Promise<ShopeeSyncStatus> {
  const row = await ensureSyncRow(connectionId);
  const lastSuccess = row.last_success_at ? new Date(row.last_success_at).getTime() : 0;
  if (row.status === "complete" && Date.now() - lastSuccess > FRESH_FOR_MS) {
    const now = new Date();
    const coveredTo = row.covered_to ? new Date(row.covered_to) : new Date(row.target_to);
    const cursorFrom = new Date(Math.max(coveredTo.getTime() - DAY, now.getTime() - WINDOW_DAYS * DAY));
    await dbQuery(
      `UPDATE workspace_marketplace_syncs
          SET status = 'pending', target_to = $4, cursor_from = $5, cursor_to = $4, updated_at = now()
        WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3`,
      [currentWorkspaceId(), PROVIDER, connectionId, now, cursorFrom]
    );
    return publicStatus(await getSyncRow(connectionId));
  }
  return publicStatus(row);
}

async function initializeCatalogCheckpoint(
  connectionId: string,
  assertOwnership: () => Promise<string>
): Promise<ShopeeCatalogCheckpoint> {
  const token = await assertOwnership();
  const [clock] = await dbQuery<{ started_at: Date | string }>("SELECT clock_timestamp() AS started_at");
  if (!clock) throw new Error("Não foi possível iniciar o sweep do catálogo Shopee.");
  const checkpoint = createShopeeCatalogCheckpoint(new Date(clock.started_at).toISOString());
  const initialized = await dbQuery(
    `UPDATE workspace_marketplace_syncs
        SET cursor_token=$5, products_complete=false, updated_at=now()
      WHERE workspace_id=$1 AND provider=$2 AND connection_id=$3
        AND lease_until::text=$4 AND lease_until>clock_timestamp() AND cursor_token IS NULL
      RETURNING connection_id`,
    [currentWorkspaceId(), PROVIDER, connectionId, token, encodeShopeeCatalogCheckpoint(checkpoint)]
  );
  if (!initialized[0]) throw new Error("Lease Shopee perdido ao iniciar o sweep do catálogo.");
  return checkpoint;
}

/**
 * Persiste um lote e seu checkpoint na mesma transação. O corte temporal do
 * sweep permite acumular milhares de itens sem guardar uma lista crescente no
 * cursor; workers vencidos não conseguem escrever nem avançar o checkpoint.
 */
async function persistCatalogPage(input: {
  connection: IntegrationConnection;
  products: ShopeeProductItem[];
  /** Variações por `item_id`, para item cujo preço mora nos models. */
  modelsByItem?: Map<string, ShopeeModel[]>;
  checkpoint: ShopeeCatalogCheckpoint;
  nextCheckpoint: ShopeeCatalogCheckpoint | null;
  ownershipToken: string;
}): Promise<void> {
  const workspaceId = currentWorkspaceId();
  const expectedCursor = encodeShopeeCatalogCheckpoint(input.checkpoint);
  const nextCursor = input.nextCheckpoint ? encodeShopeeCatalogCheckpoint(input.nextCheckpoint) : null;
  // ITEM ESTRANHO NÃO DERRUBA O CANAL (27/08/2026).
  //
  // Antes, `normalizeShopeeProduct` lançava e a exceção subia pela varredura
  // inteira: um item com variação (`price_info` ausente no item) zerou a
  // primeira sincronização da loja real — 0 pedidos, 0 produtos, `covered_to`
  // nulo. Corrigido o preço, a MESMA parada voltou algumas horas depois por
  // outro motivo: `item_status=SHOPEE_DELETE`, valor que a Shopee não
  // documenta. Dois sintomas, um defeito só — o ESCOPO era o canal quando
  // deveria ser o item.
  //
  // A recusa a fabricar dado continua inteira: o que não dá para afirmar fica
  // de fora e é contado, com o valor cru que a Shopee mandou, para a tela poder
  // dizer quantos são e por quê. Erro que não é `ShopeeItemForaDoSnapshot`
  // (defeito nosso, lease perdido, resposta incoerente) continua subindo.
  const normalized: CanonicalProduct[] = [];
  const foraDoSnapshot: string[] = [];
  for (const product of input.products) {
    try {
      normalized.push(normalizeShopeeProduct(product, input.modelsByItem?.get(String(product.item_id))));
    } catch (error) {
      if (!(error instanceof ShopeeItemForaDoSnapshot)) throw error;
      foraDoSnapshot.push(`${error.itemId} (${error.valorCru})`);
    }
  }
  if (foraDoSnapshot.length) {
    // Conta no checkpoint (o alarme do agendador já lê isso) sem interromper.
    console.warn(
      `[shopee] ${foraDoSnapshot.length} item(ns) fora do snapshot, com o valor cru da Shopee: ${foraDoSnapshot.join(", ")}`
    );
  }

  await dbTransaction(async (query) => {
    const owner = await query(
      `SELECT 1 FROM workspace_marketplace_syncs
        WHERE workspace_id=$1 AND provider=$2 AND connection_id=$3
          AND lease_until::text=$4 AND lease_until>clock_timestamp() AND cursor_token=$5
        FOR UPDATE`,
      [workspaceId, PROVIDER, input.connection.id, input.ownershipToken, expectedCursor]
    );
    if (!owner[0]) throw new Error("Lease Shopee perdido antes de persistir página do catálogo.");

    if (normalized.length) {
      await saveCanonicalProducts(
        { provider: PROVIDER, connectionId: input.connection.id },
        normalized,
        query
      );
    }

    if (input.nextCheckpoint) {
      const advanced = await query(
        `UPDATE workspace_marketplace_syncs
            SET cursor_token=$5, products_complete=false, updated_at=now()
          WHERE workspace_id=$1 AND provider=$2 AND connection_id=$3
            AND lease_until::text=$4 AND lease_until>clock_timestamp() AND cursor_token=$6
          RETURNING connection_id`,
        [workspaceId, PROVIDER, input.connection.id, input.ownershipToken, nextCursor, expectedCursor]
      );
      if (!advanced[0]) throw new Error("Lease Shopee perdido ao avançar checkpoint do catálogo.");
      return;
    }

    const [totals] = await query<{ total: number; active: number }>(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status='active')::int AS active
         FROM workspace_channel_products
        WHERE workspace_id=$1 AND provider=$2 AND connection_id=$3
          AND synced_at >= $4::timestamptz`,
      [workspaceId, PROVIDER, input.connection.id, input.checkpoint.sweepStartedAt]
    );
    await query(
      `UPDATE workspace_channel_products
          SET status='closed', provider_status='NOT_PRESENT_IN_COMPLETE_SNAPSHOT',
              available_qty=0, synced_at=now()
        WHERE workspace_id=$1 AND provider=$2 AND connection_id=$3
          AND synced_at < $4::timestamptz`,
      [workspaceId, PROVIDER, input.connection.id, input.checkpoint.sweepStartedAt]
    );
    const completed = await query(
      `UPDATE workspace_marketplace_syncs
          SET products_synced_at=now(), products_total=$5, active_products=$6,
              products_complete=true, cursor_token=NULL, updated_at=now()
        WHERE workspace_id=$1 AND provider=$2 AND connection_id=$3
          AND lease_until::text=$4 AND lease_until>clock_timestamp() AND cursor_token=$7
        RETURNING connection_id`,
      [
        workspaceId,
        PROVIDER,
        input.connection.id,
        input.ownershipToken,
        totals?.total ?? 0,
        totals?.active ?? 0,
        expectedCursor,
      ]
    );
    if (!completed[0]) throw new Error("Lease Shopee perdido durante a reconciliação final do catálogo.");
  });
}

async function syncProductsStep(
  connection: IntegrationConnection,
  cursorToken: string | null,
  assertOwnership: () => Promise<string>,
  budgetMs: number
): Promise<void> {
  const checkpoint = cursorToken
    ? decodeShopeeCatalogCheckpoint(cursorToken)
    : await initializeCatalogCheckpoint(connection.id, assertOwnership);

  await runShopeeCatalogPageBudget({
    checkpoint,
    maxPages: CATALOG_PAGES_PER_STEP,
    budgetMs,
    fetchPage: (status, offset) => fencedShopeeExternalRead(
      assertOwnership,
      () => getShopeeItemList(connection, { offset, pageSize: 50, status })
    ),
    processPage: async ({ ids, currentCheckpoint, nextCheckpoint }) => {
      const info = ids.length
        ? await fencedShopeeExternalRead(
          assertOwnership,
          () => getShopeeItemBaseInfo(connection, ids)
        )
        : { item_list: [] };
      const products = (info.item_list ?? []) as ShopeeProductItem[];
      validateShopeeCatalogSnapshot(ids, products);
      // Só o item COM variação precisa da segunda chamada; item simples já veio
      // resolvido. Falha de uma variação não derruba a página: o item cai no
      // caminho "sem preço" e vira pendência.
      const modelsByItem = new Map<string, ShopeeModel[]>();
      for (const product of products) {
        if (!product.has_model) continue;
        try {
          const lista = await fencedShopeeExternalRead(
            assertOwnership,
            () => getShopeeModelList(connection, Number(product.item_id))
          );
          modelsByItem.set(String(product.item_id), (lista.model ?? []) as ShopeeModel[]);
        } catch (error) {
          console.warn(`[shopee] variações indisponíveis para ${product.item_id}:`, error instanceof Error ? error.message : error);
        }
      }
      const ownershipToken = await assertOwnership();
      await persistCatalogPage({
        connection,
        products,
        modelsByItem,
        checkpoint: currentCheckpoint,
        nextCheckpoint,
        ownershipToken,
      });
    },
  });

  const token = await assertOwnership();
  const released = await dbQuery(
    `UPDATE workspace_marketplace_syncs
        SET status='pending', lease_until=NULL, last_error=NULL, updated_at=now()
      WHERE workspace_id=$1 AND provider=$2 AND connection_id=$3
        AND lease_until::text=$4 AND lease_until>clock_timestamp()
      RETURNING connection_id`,
    [currentWorkspaceId(), PROVIDER, connection.id, token]
  );
  if (!released[0]) throw new Error("Lease Shopee perdido ao encerrar etapa do catálogo.");
}

/** Busca o detalhe dos pedidos da janela e grava no canônico. */
async function saveOrderWindow(
  connection: IntegrationConnection,
  orderSns: string[],
  assertOwnership: () => Promise<string>
): Promise<number> {
  const uniqueOrderSns = [...new Set(orderSns)];
  if (!uniqueOrderSns.length) return 0;
  let saved = 0;
  for (let index = 0; index < uniqueOrderSns.length; index += ORDER_DETAIL_BATCH) {
    const batch = uniqueOrderSns.slice(index, index + ORDER_DETAIL_BATCH);
    const detail = await fencedShopeeExternalRead(
      assertOwnership,
      () => getShopeeOrderDetail(connection, batch)
    );
    const orders = (detail.order_list ?? []) as ShopeeOrderDetail[];
    validateShopeeOrderBatch(batch, orders);
    const normalized = orders.map((order) => normalizeShopeeOrder(order));
    const ownershipToken = await assertOwnership();
    const fenced = await withShopeeSyncWriteFence(
      dbTransaction,
      currentWorkspaceId(),
      connection.id,
      ownershipToken,
      (query) => saveCanonicalOrders(
        { provider: "shopee", connectionId: connection.id },
        normalized,
        query,
      ),
    );
    if (!fenced.owned) throw new Error("Lease Shopee perdido antes de persistir pedidos.");
    saved += orders.length;
  }
  return saved;
}

/**
 * Conciliação do escrow: pedidos com receita mas ainda sem tarifa gravada.
 * Roda depois dos pedidos, em lotes pequenos — a tarifa chega atrasada por
 * natureza (só fecha após o pagamento) e não pode travar o faturamento.
 */
async function syncMissingEscrow(
  connection: IntegrationConnection,
  cursorOffset: number,
  assertOwnership: () => Promise<string>
): Promise<{ attempted: number; failed: number; nextOffset: number }> {
  const [countRow] = await dbQuery<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM workspace_channel_orders o
      WHERE o.workspace_id=$1 AND o.provider=$2 AND o.connection_id=$3
        AND o.status IN ('paid','shipped','delivered')
        AND COALESCE(o.raw #>> '{_sellercore,shopeeEscrowSettled}', 'false') <> 'true'`,
    [currentWorkspaceId(), PROVIDER, connection.id]
  );
  const total = countRow?.total ?? 0;
  if (!total) return { attempted: 0, failed: 0, nextOffset: 0 };
  const offset = cursorOffset % total;
  const pending = await dbQuery<{ external_order_id: string }>(
    `SELECT o.external_order_id
       FROM workspace_channel_orders o
      WHERE o.workspace_id = $1 AND o.provider = $2 AND o.connection_id = $3
        AND o.status IN ('paid', 'shipped', 'delivered')
        AND COALESCE(o.raw #>> '{_sellercore,shopeeEscrowSettled}', 'false') <> 'true'
      ORDER BY o.occurred_at, o.external_order_id
      LIMIT $4 OFFSET $5`,
    [currentWorkspaceId(), PROVIDER, connection.id, ESCROW_BATCH_SIZE, offset]
  );

  let failed = 0;
  for (const row of pending) {
    try {
      const escrow = (await fencedShopeeExternalRead(
        assertOwnership,
        () => getShopeeEscrowDetail(connection, row.external_order_id)
      )) as ShopeeEscrowDetail;
      if (!escrow?.order_income) continue;
      const detail = await fencedShopeeExternalRead(
        assertOwnership,
        () => getShopeeOrderDetail(connection, [row.external_order_id])
      );
      const order = ((detail.order_list ?? []) as ShopeeOrderDetail[])[0];
      if (!order) continue;
      // Aqui não é best-effort: o marcador explícito só pode ser gravado se as
      // linhas financeiras tiverem sido persistidas atomicamente com sucesso.
      const ownershipToken = await assertOwnership();
      const fenced = await withShopeeSyncWriteFence(
        dbTransaction,
        currentWorkspaceId(),
        connection.id,
        ownershipToken,
        async (query) => {
          await saveCanonicalOrders(
            { provider: "shopee", connectionId: connection.id },
            [normalizeShopeeOrder(order, { escrow })],
            query,
          );
          await query(
            `UPDATE workspace_channel_orders
                SET raw = ${SHOPEE_ESCROW_MARK_SQL}
                  || jsonb_build_object('_sellercore', ((${SHOPEE_ESCROW_MARK_SQL}) -> '_sellercore')
                    || jsonb_build_object('financialEvidence', $5::jsonb)),
                    synced_at = now()
              WHERE workspace_id=$1 AND provider=$2 AND connection_id=$3 AND external_order_id=$4`,
            [currentWorkspaceId(), PROVIDER, connection.id, row.external_order_id, JSON.stringify({
              fees: ["commission_fee", "service_fee", "seller_transaction_fee"].every((field) => Object.hasOwn(escrow.order_income!, field)),
              sellerShipping: ["actual_shipping_fee", "reverse_shipping_fee"].every((field) => Object.hasOwn(escrow.order_income!, field)),
              ads: ["campaign_fee", "order_ams_commission_fee"].every((field) => Object.hasOwn(escrow.order_income!, field)),
              taxesWithheld: ["escrow_tax", "final_escrow_product_gst"].every((field) => Object.hasOwn(escrow.order_income!, field)),
              refunds: Object.hasOwn(escrow.order_income!, "seller_return_refund"),
            })],
          );
        },
      );
      if (!fenced.owned) throw new ShopeeLeaseLostError("Lease Shopee perdido antes de persistir escrow.");
    } catch (error) {
      if (error instanceof ShopeeLeaseLostError) throw error;
      // Escrow indisponível para este pedido (ainda não pago, ou erro pontual):
      // segue para o próximo — a próxima passagem tenta de novo.
      failed++;
    }
  }
  return { attempted: pending.length, failed, nextOffset: nextShopeeEscrowOffset(offset, pending.length, total) };
}

export async function runShopeeSyncStep(
  connection: IntegrationConnection,
  prepareSync = true,
  catalogBudgetMs = CATALOG_STEP_BUDGET_MS
): Promise<ShopeeSyncStatus> {
  if (isShopeeDemoConnection(connection)) return publicStatus();
  if (!hasDb()) return publicStatus();
  if (prepareSync) await requestShopeeSync(connection.id);

  const workspaceId = currentWorkspaceId();
  const leased = await dbQuery<SyncRow & { ownership_token: string }>(
    `UPDATE workspace_marketplace_syncs
        SET lease_until = now() + interval '5 minutes', status = 'syncing', updated_at = now()
      WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
        AND status <> 'complete' AND (lease_until IS NULL OR lease_until < now())
      RETURNING status, target_from, target_to, covered_from, covered_to, cursor_from, cursor_to,
                processed_orders, products_synced_at, products_total, active_products,
                products_complete, lease_until, cursor_offset, cursor_token, last_error, last_success_at,
                lease_until::text AS ownership_token`,
    [workspaceId, PROVIDER, connection.id]
  );
  const row = leased[0];
  if (!row) return publicStatus(await getSyncRow(connection.id), true);
  let ownershipToken = row.ownership_token;

  const assertOwnership = async (): Promise<string> => {
    const renewed = await dbQuery<{ ownership_token: string }>(
      `UPDATE workspace_marketplace_syncs
          SET lease_until=now() + interval '5 minutes', updated_at=now()
        WHERE workspace_id=$1 AND provider=$2 AND connection_id=$3
          AND lease_until::text=$4 AND lease_until > now()
        RETURNING lease_until::text AS ownership_token`,
      [workspaceId, PROVIDER, connection.id, ownershipToken]
    );
    if (!renewed[0]) throw new ShopeeLeaseLostError("Lease Shopee perdido; worker expirado não pode gravar checkpoint.");
    ownershipToken = renewed[0].ownership_token;
    return ownershipToken;
  };

  try {
    // Primeira sincronização (nenhuma janela de pedidos fechada ainda): os
    // pedidos recentes passam na frente do sweep de catálogo, para o dashboard
    // mostrar venda em minutos. Um sweep já iniciado (cursor_token) não é
    // interrompido — retomabilidade vale mais que a ordem.
    const primeiraJanelaPendente = !row.covered_from && !row.cursor_token;
    const productsDue = Boolean(row.cursor_token) || !row.products_synced_at
      || Date.now() - new Date(row.products_synced_at).getTime() > 6 * 60 * 60_000;
    if (productsDue && !primeiraJanelaPendente) {
      await syncProductsStep(connection, row.cursor_token, assertOwnership, catalogBudgetMs);
      return publicStatus(await getSyncRow(connection.id));
    }

    const from = new Date(row.cursor_from);
    const to = new Date(row.cursor_to);

    // A Shopee pagina por cursor opaco: percorremos a janela inteira aqui,
    // porque o cursor não é estável entre execuções como um offset.
    const orderSns = await collectShopeeOrderSns(
      async (cursor) => {
        return fencedShopeeExternalRead(
          assertOwnership,
          () => getShopeeOrderList(connection, { from, to, cursor })
        );
      }
    );

    const saved = await saveOrderWindow(connection, orderSns, assertOwnership);
    const targetFrom = new Date(row.target_from);
    await assertOwnership();

    const move = nextShopeeOrderWindow({
      windowFromMs: from.getTime(),
      targetFromMs: targetFrom.getTime(),
      historyFloorMs: Date.now() - HISTORY_DAYS * DAY,
      windowMs: WINDOW_DAYS * DAY,
      toleranceMs: DAY,
    });
    if (move.kind === "complete") {
      await dbQuery(
        `UPDATE workspace_marketplace_syncs
            SET status = 'complete', covered_from = COALESCE(covered_from, target_from),
                covered_to = target_to, processed_orders = processed_orders + $4,
                lease_until = NULL, last_error = NULL, last_success_at = now(), updated_at = now()
          WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
            AND lease_until::text = $5 AND lease_until > now()`,
        [workspaceId, PROVIDER, connection.id, saved, ownershipToken]
      );
    } else if (move.kind === "extend") {
      // Fase 2: o alvo imediato (30 dias) fechou; estende o alvo até o
      // histórico completo e continua o backfill nas mesmas janelas.
      await dbQuery(
        `UPDATE workspace_marketplace_syncs
            SET status = 'pending', target_from = $4, covered_from = $5,
                covered_to = COALESCE(covered_to, target_to),
                cursor_from = $6, cursor_to = $7, processed_orders = processed_orders + $8,
                lease_until = NULL, last_error = NULL, last_success_at = now(), updated_at = now()
          WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
            AND lease_until::text = $9 AND lease_until > now()`,
        [workspaceId, PROVIDER, connection.id, new Date(move.targetFromMs), from,
          new Date(move.nextFromMs), new Date(move.nextToMs), saved, ownershipToken]
      );
    } else {
      await dbQuery(
        `UPDATE workspace_marketplace_syncs
            SET status = 'pending', covered_from = $4, covered_to = COALESCE(covered_to, target_to),
                cursor_from = $5, cursor_to = $6, processed_orders = processed_orders + $7,
                lease_until = NULL, last_error = NULL, last_success_at = now(), updated_at = now()
          WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
            AND lease_until::text = $8 AND lease_until > now()`,
        [workspaceId, PROVIDER, connection.id, from, new Date(move.nextFromMs), new Date(move.nextToMs), saved, ownershipToken]
      );
    }

    // As escritas acima liberam o lease; readquire apenas se ainda somos o único
    // worker elegível. A conciliação roda sob um novo token cercado.
    const reacquired = await dbQuery<{ ownership_token: string }>(
      `UPDATE workspace_marketplace_syncs SET lease_until=now()+interval '5 minutes', updated_at=now()
        WHERE workspace_id=$1 AND provider=$2 AND connection_id=$3 AND lease_until IS NULL
        RETURNING lease_until::text AS ownership_token`,
      [workspaceId, PROVIDER, connection.id]
    );
    if (!reacquired[0]) return publicStatus(await getSyncRow(connection.id), true);
    ownershipToken = reacquired[0].ownership_token;
    const escrow = await syncMissingEscrow(connection, row.cursor_offset ?? 0, assertOwnership);
    await assertOwnership();
    const warning = escrow.failed > 0
      ? `Conciliação Shopee parcial: ${escrow.failed} de ${escrow.attempted} escrow(s) falharam e serão tentados novamente.`
      : null;
    await dbQuery(
      `UPDATE workspace_marketplace_syncs
          SET cursor_offset=$5, last_error=$6, lease_until=NULL, updated_at=now()
        WHERE workspace_id=$1 AND provider=$2 AND connection_id=$3
          AND lease_until::text=$4 AND lease_until > now()`,
      [workspaceId, PROVIDER, connection.id, ownershipToken, escrow.nextOffset, warning]
    );
  } catch (error) {
    const phase: ShopeeFailurePhase = isChannelAuthExpired(error)
      ? "reauth_required"
      : error instanceof ShopeeApiError && ["error_permission", "no_permission", "error_param"].includes(error.code)
        ? "terminal_error"
        : "retryable_error";
    const message = error instanceof Error ? error.message : "Falha ao sincronizar a Shopee.";
    await dbQuery(
      `UPDATE workspace_marketplace_syncs
          SET status = 'error', lease_until = NULL, last_error = $4, updated_at = now()
        WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
          AND lease_until::text = $5`,
      [
        currentWorkspaceId(),
        PROVIDER,
        connection.id,
        encodeShopeeSyncFailure(phase, message),
        ownershipToken,
      ]
    );
  }

  return publicStatus(await getSyncRow(connection.id));
}

/** Executa passos até completar ou esgotar o orçamento de tempo do cron. */
export async function runShopeeSyncBatch(
  connection: IntegrationConnection,
  budgetMs = 20_000
): Promise<ShopeeSyncStatus> {
  const startedAt = Date.now();
  let status = await runShopeeSyncStep(
    connection,
    true,
    Math.max(1, Math.min(CATALOG_STEP_BUDGET_MS, budgetMs))
  );
  while (
    (status.status === "pending" || status.status === "syncing")
    && !status.busy
    && Date.now() - startedAt < budgetMs
  ) {
    const remainingMs = Math.max(1, budgetMs - (Date.now() - startedAt));
    status = await runShopeeSyncStep(
      connection,
      false,
      Math.min(CATALOG_STEP_BUDGET_MS, remainingMs)
    );
  }
  return status;
}
