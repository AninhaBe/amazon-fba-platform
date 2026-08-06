import { dbQuery, hasDb } from "../db";
import { currentWorkspaceId } from "../workspaceScope";
import { canonicalBestEffort, saveCanonicalOrders, saveCanonicalProducts } from "./canonicalStore";
import {
  getShopeeEscrowDetail,
  getShopeeItemBaseInfo,
  getShopeeItemList,
  getShopeeOrderDetail,
  getShopeeOrderList,
  ORDER_DETAIL_BATCH,
  ORDER_WINDOW_DAYS,
} from "./shopee";
import {
  normalizeShopeeOrder,
  normalizeShopeeProduct,
  type ShopeeEscrowDetail,
  type ShopeeOrderDetail,
  type ShopeeProductItem,
} from "./shopeeCanonical";
import type { IntegrationConnection } from "./types";

// Sync da Shopee — mesma máquina de estados do Mercado Livre (lease + cursor por
// janela), adaptada aos limites da API dela (docs/api-shopee.md):
//   - get_order_list aceita no máximo 15 dias por chamada → a janela do cursor
//     é de 15 dias e caminha para trás até cobrir o histórico;
//   - get_order_detail aceita no máximo 50 order_sn por chamada;
//   - o escrow (taxas reais) só existe depois do pagamento, então ele é uma
//     conciliação complementar: não bloqueia a ingestão do pedido.

const PROVIDER = "shopee";
const DAY = 86_400_000;
const HISTORY_DAYS = 60;
const WINDOW_DAYS = ORDER_WINDOW_DAYS; // teto da própria API
const FRESH_FOR_MS = 10 * 60_000;
/** Pedidos por passo que buscam escrow — mantém o passo curto no cron. */
const ESCROW_BATCH_SIZE = 20;

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
  error: string | null;
  busy?: boolean;
}

function iso(value: Date | string | null): string | null {
  return value ? new Date(value).toISOString() : null;
}

function publicStatus(row?: SyncRow, busy = false): ShopeeSyncStatus {
  if (!row) {
    return { status: "unavailable", progress: 0, processedOrders: 0, coveredFrom: null, coveredTo: null, lastSuccessAt: null, error: null };
  }
  const targetFrom = new Date(row.target_from).getTime();
  const targetTo = new Date(row.target_to).getTime();
  const cursorFrom = new Date(row.cursor_from).getTime();
  const span = Math.max(1, targetTo - targetFrom);
  const progress = row.status === "complete"
    ? 100
    : Math.max(0, Math.min(99, Math.round(((targetTo - cursorFrom) / span) * 100)));
  return {
    status: row.status,
    progress,
    processedOrders: row.processed_orders,
    coveredFrom: iso(row.covered_from),
    coveredTo: iso(row.covered_to),
    lastSuccessAt: iso(row.last_success_at),
    error: row.last_error,
    busy: busy || undefined,
  };
}

async function getSyncRow(connectionId: string): Promise<SyncRow | undefined> {
  const rows = await dbQuery<SyncRow>(
    `SELECT status, target_from, target_to, covered_from, covered_to, cursor_from, cursor_to,
            processed_orders, products_synced_at, products_total, active_products,
            products_complete, lease_until, last_error, last_success_at
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
  const targetFrom = new Date(now.getTime() - HISTORY_DAYS * DAY);
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

async function syncProducts(connection: IntegrationConnection): Promise<void> {
  const collected: ShopeeProductItem[] = [];
  let offset = 0;
  // Teto de 10 páginas por passo: catálogo grande termina no passo seguinte.
  for (let page = 0; page < 10; page++) {
    const list = await getShopeeItemList(connection, { offset, pageSize: 50 });
    const ids = (list.item ?? []).map((item) => item.item_id);
    if (!ids.length) break;
    for (let index = 0; index < ids.length; index += ORDER_DETAIL_BATCH) {
      const info = await getShopeeItemBaseInfo(connection, ids.slice(index, index + ORDER_DETAIL_BATCH));
      collected.push(...((info.item_list ?? []) as ShopeeProductItem[]));
    }
    if (!list.has_next_page) break;
    offset = list.next_offset ?? offset + ids.length;
  }

  if (collected.length) {
    await canonicalBestEffort("shopee:products", async () => {
      await saveCanonicalProducts(
        { provider: "shopee", connectionId: connection.id },
        collected.map(normalizeShopeeProduct)
      );
    });
  }

  const active = collected.filter((item) => item.item_status === "NORMAL").length;
  await dbQuery(
    `UPDATE workspace_marketplace_syncs
        SET products_synced_at = now(), products_total = $4, active_products = $5,
            products_complete = true, updated_at = now()
      WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3`,
    [currentWorkspaceId(), PROVIDER, connection.id, collected.length, active]
  );
}

/** Busca o detalhe dos pedidos da janela e grava no canônico. */
async function saveOrderWindow(
  connection: IntegrationConnection,
  orderSns: string[]
): Promise<number> {
  if (!orderSns.length) return 0;
  let saved = 0;
  for (let index = 0; index < orderSns.length; index += ORDER_DETAIL_BATCH) {
    const batch = orderSns.slice(index, index + ORDER_DETAIL_BATCH);
    const detail = await getShopeeOrderDetail(connection, batch);
    const orders = (detail.order_list ?? []) as ShopeeOrderDetail[];
    if (!orders.length) continue;
    await canonicalBestEffort("shopee:orders", async () => {
      await saveCanonicalOrders(
        { provider: "shopee", connectionId: connection.id },
        orders.map((order) => normalizeShopeeOrder(order))
      );
    });
    saved += orders.length;
  }
  return saved;
}

/**
 * Conciliação do escrow: pedidos com receita mas ainda sem tarifa gravada.
 * Roda depois dos pedidos, em lotes pequenos — a tarifa chega atrasada por
 * natureza (só fecha após o pagamento) e não pode travar o faturamento.
 */
async function syncMissingEscrow(connection: IntegrationConnection): Promise<void> {
  const pending = await dbQuery<{ external_order_id: string }>(
    `SELECT o.external_order_id
       FROM workspace_channel_orders o
      WHERE o.workspace_id = $1 AND o.provider = $2 AND o.connection_id = $3
        AND o.status IN ('paid', 'shipped', 'delivered')
        AND NOT EXISTS (
          SELECT 1 FROM workspace_channel_order_fees f
           WHERE f.workspace_id = o.workspace_id AND f.provider = o.provider
             AND f.connection_id = o.connection_id AND f.external_order_id = o.external_order_id
        )
      ORDER BY o.occurred_at DESC
      LIMIT $4`,
    [currentWorkspaceId(), PROVIDER, connection.id, ESCROW_BATCH_SIZE]
  );

  for (const row of pending) {
    try {
      const escrow = (await getShopeeEscrowDetail(connection, row.external_order_id)) as ShopeeEscrowDetail;
      if (!escrow?.order_income) continue;
      const detail = await getShopeeOrderDetail(connection, [row.external_order_id]);
      const order = ((detail.order_list ?? []) as ShopeeOrderDetail[])[0];
      if (!order) continue;
      await canonicalBestEffort("shopee:escrow", async () => {
        await saveCanonicalOrders(
          { provider: "shopee", connectionId: connection.id },
          [normalizeShopeeOrder(order, { escrow })]
        );
      });
    } catch {
      // Escrow indisponível para este pedido (ainda não pago, ou erro pontual):
      // segue para o próximo — a próxima passagem tenta de novo.
    }
  }
}

export async function runShopeeSyncStep(
  connection: IntegrationConnection,
  prepareSync = true
): Promise<ShopeeSyncStatus> {
  if (!hasDb()) return publicStatus();
  if (prepareSync) await requestShopeeSync(connection.id);

  const leased = await dbQuery<SyncRow>(
    `UPDATE workspace_marketplace_syncs
        SET lease_until = now() + interval '5 minutes', status = 'syncing', updated_at = now()
      WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
        AND status <> 'complete' AND (lease_until IS NULL OR lease_until < now())
      RETURNING status, target_from, target_to, covered_from, covered_to, cursor_from, cursor_to,
                processed_orders, products_synced_at, products_total, active_products,
                products_complete, lease_until, last_error, last_success_at`,
    [currentWorkspaceId(), PROVIDER, connection.id]
  );
  const row = leased[0];
  if (!row) return publicStatus(await getSyncRow(connection.id), true);

  try {
    const productsDue = !row.products_synced_at
      || Date.now() - new Date(row.products_synced_at).getTime() > 6 * 60 * 60_000;
    if (productsDue) await syncProducts(connection);

    const from = new Date(row.cursor_from);
    const to = new Date(row.cursor_to);

    // A Shopee pagina por cursor opaco: percorremos a janela inteira aqui,
    // porque o cursor não é estável entre execuções como um offset.
    const orderSns: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const result = await getShopeeOrderList(connection, { from, to, cursor });
      orderSns.push(...(result.order_list ?? []).map((order) => order.order_sn));
      if (!result.more || !result.next_cursor) break;
      cursor = result.next_cursor;
    }

    const saved = await saveOrderWindow(connection, orderSns);
    const targetFrom = new Date(row.target_from);

    if (from.getTime() <= targetFrom.getTime()) {
      await dbQuery(
        `UPDATE workspace_marketplace_syncs
            SET status = 'complete', covered_from = COALESCE(covered_from, target_from),
                covered_to = target_to, processed_orders = processed_orders + $4,
                lease_until = NULL, last_error = NULL, last_success_at = now(), updated_at = now()
          WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3`,
        [currentWorkspaceId(), PROVIDER, connection.id, saved]
      );
    } else {
      const nextTo = from;
      const nextFrom = new Date(Math.max(targetFrom.getTime(), nextTo.getTime() - WINDOW_DAYS * DAY));
      await dbQuery(
        `UPDATE workspace_marketplace_syncs
            SET status = 'pending', covered_from = $4, covered_to = COALESCE(covered_to, target_to),
                cursor_from = $5, cursor_to = $6, processed_orders = processed_orders + $7,
                lease_until = NULL, last_error = NULL, last_success_at = now(), updated_at = now()
          WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3`,
        [currentWorkspaceId(), PROVIDER, connection.id, from, nextFrom, nextTo, saved]
      );
    }

    await syncMissingEscrow(connection);
  } catch (error) {
    await dbQuery(
      `UPDATE workspace_marketplace_syncs
          SET status = 'error', lease_until = NULL, last_error = $4, updated_at = now()
        WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3`,
      [
        currentWorkspaceId(),
        PROVIDER,
        connection.id,
        error instanceof Error ? error.message : "Falha ao sincronizar a Shopee.",
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
  let status = await runShopeeSyncStep(connection);
  while (
    (status.status === "pending" || status.status === "syncing")
    && !status.busy
    && Date.now() - startedAt < budgetMs
  ) {
    status = await runShopeeSyncStep(connection, false);
  }
  return status;
}
