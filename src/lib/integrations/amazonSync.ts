import { dbQuery, hasDb } from "../db";
import { currentWorkspaceId } from "../workspaceScope";
import { runWithAccount, type AccountCtx } from "../accountContext";
import { getOrders, getOrderItems } from "../orders";
import { normalizeAmazonOrderHeader, normalizeAmazonOrderItems } from "./amazonCanonical";
import {
  applyCanonicalOrderItems,
  saveCanonicalOrderHeaders,
  type OrderItemsApplication,
} from "./canonicalStore";

// Sincronização da Amazon para o modelo canônico (fase 5, etapa Orders —
// docs/canonical-schema.md). Mesmo desenho do Mercado Livre: janela de
// importação com lease em workspace_marketplace_syncs, avançando do presente
// para o passado; o NextToken da SP-API fica em cursor_token. Os itens de cada
// pedido são conciliados aos poucos (getOrderItems é por pedido e
// rate-limitado), priorizando os pedidos mais recentes. Fees (Finances API)
// ficam para a próxima etapa — a ausência delas é o que marca o pedido como
// "não processado" na cobertura de lucro.

const PROVIDER = "amazon";
const DAY = 86_400_000;
const HISTORY_DAYS = 366;
const WINDOW_DAYS = 7;
const PAGE_SIZE = 100;
const ITEM_BATCH_SIZE = 10;
const FRESH_FOR_MS = 6 * 60 * 60_000;

export function amazonConnectionId(sellerId: string): string {
  return `amazon:${sellerId}`;
}

interface SyncRow {
  status: "pending" | "syncing" | "complete" | "error";
  target_from: Date | string;
  target_to: Date | string;
  covered_from: Date | string | null;
  covered_to: Date | string | null;
  cursor_from: Date | string;
  cursor_to: Date | string;
  cursor_token: string | null;
  processed_orders: number;
  last_error: string | null;
  last_success_at: Date | string | null;
}

const SYNC_COLUMNS = `status, target_from, target_to, covered_from, covered_to, cursor_from,
                      cursor_to, cursor_token, processed_orders, last_error, last_success_at`;

async function getSyncRow(connectionId: string): Promise<SyncRow | undefined> {
  const rows = await dbQuery<SyncRow>(
    `SELECT ${SYNC_COLUMNS} FROM workspace_marketplace_syncs
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
  if (!created) throw new Error("Não foi possível iniciar a sincronização da Amazon.");
  return created;
}

async function requestAmazonSync(connectionId: string): Promise<SyncRow> {
  const row = await ensureSyncRow(connectionId);
  const lastSuccess = row.last_success_at ? new Date(row.last_success_at).getTime() : 0;
  if (row.status === "complete" && Date.now() - lastSuccess > FRESH_FOR_MS) {
    const now = new Date();
    const coveredTo = row.covered_to ? new Date(row.covered_to) : new Date(row.target_to);
    await dbQuery(
      `UPDATE workspace_marketplace_syncs
          SET status = 'pending', target_from = $5, target_to = $4, cursor_from = $5, cursor_to = $4,
              cursor_token = NULL, cursor_offset = 0, last_error = NULL, updated_at = now()
        WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3`,
      [currentWorkspaceId(), PROVIDER, connectionId, now, coveredTo]
    );
  }
  return (await getSyncRow(connectionId))!;
}

// Conciliação de itens: pedidos com receita e sem linhas, mais recentes antes.
async function syncMissingOrderItems(connectionId: string): Promise<void> {
  const rows = await dbQuery<{ external_order_id: string }>(
    `SELECT o.external_order_id FROM workspace_channel_orders o
      WHERE o.workspace_id = $1 AND o.provider = $2 AND o.connection_id = $3
        AND o.status IN ('paid', 'shipped', 'delivered')
        AND NOT EXISTS (
          SELECT 1 FROM workspace_channel_order_items i
           WHERE i.workspace_id = o.workspace_id AND i.provider = o.provider
             AND i.connection_id = o.connection_id AND i.external_order_id = o.external_order_id
        )
      ORDER BY o.occurred_at DESC
      LIMIT $4`,
    [currentWorkspaceId(), PROVIDER, connectionId, ITEM_BATCH_SIZE]
  );
  const applications: OrderItemsApplication[] = [];
  for (const row of rows) {
    try {
      const normalized = normalizeAmazonOrderItems(await getOrderItems(row.external_order_id));
      if (normalized.items.length) {
        applications.push({
          externalOrderId: row.external_order_id,
          items: normalized.items,
          gross: normalized.gross,
          buyerShipping: normalized.buyerShipping,
        });
      }
    } catch {
      // Rate limit ou pedido indisponível: a próxima passada tenta de novo.
      break;
    }
  }
  await applyCanonicalOrderItems({ provider: PROVIDER, connectionId }, applications);
}

export async function runAmazonSyncStep(account: AccountCtx): Promise<void> {
  if (!hasDb()) return;
  const connectionId = amazonConnectionId(account.sellerId);
  await requestAmazonSync(connectionId);
  const leased = await dbQuery<SyncRow>(
    `UPDATE workspace_marketplace_syncs
        SET lease_until = now() + interval '5 minutes', status = 'syncing', updated_at = now()
      WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
        AND status <> 'complete' AND (lease_until IS NULL OR lease_until < now())
      RETURNING ${SYNC_COLUMNS}`,
    [currentWorkspaceId(), PROVIDER, connectionId]
  );
  const row = leased[0];
  if (!row) {
    // Sem trabalho de janela (completo ou outro processo na frente): a
    // conciliação de itens ainda pode avançar.
    await runWithAccount(account, () => syncMissingOrderItems(connectionId));
    return;
  }

  try {
    const from = new Date(row.cursor_from);
    const to = new Date(row.cursor_to);
    const page = await runWithAccount(account, () => getOrders({
      createdAfter: from.toISOString(),
      createdBefore: to.toISOString(),
      maxResults: PAGE_SIZE,
      nextToken: row.cursor_token ?? undefined,
    }));
    await saveCanonicalOrderHeaders(
      { provider: PROVIDER, connectionId, storeRaw: true },
      page.orders.map(normalizeAmazonOrderHeader)
    );

    const targetFrom = new Date(row.target_from);
    if (page.nextToken) {
      await dbQuery(
        `UPDATE workspace_marketplace_syncs
            SET status = 'pending', cursor_token = $4, processed_orders = processed_orders + $5,
                lease_until = NULL, last_error = NULL, last_success_at = now(), updated_at = now()
          WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3`,
        [currentWorkspaceId(), PROVIDER, connectionId, page.nextToken, page.orders.length]
      );
    } else if (from.getTime() <= targetFrom.getTime()) {
      await dbQuery(
        `UPDATE workspace_marketplace_syncs
            SET status = 'complete', covered_from = COALESCE(covered_from, target_from), covered_to = target_to,
                processed_orders = processed_orders + $4, cursor_token = NULL,
                lease_until = NULL, last_error = NULL, last_success_at = now(), updated_at = now()
          WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3`,
        [currentWorkspaceId(), PROVIDER, connectionId, page.orders.length]
      );
    } else {
      const nextTo = from;
      const nextFrom = new Date(Math.max(targetFrom.getTime(), nextTo.getTime() - WINDOW_DAYS * DAY));
      await dbQuery(
        `UPDATE workspace_marketplace_syncs
            SET status = 'pending', covered_from = $4, covered_to = COALESCE(covered_to, target_to),
                cursor_from = $5, cursor_to = $6, cursor_token = NULL,
                processed_orders = processed_orders + $7,
                lease_until = NULL, last_error = NULL, last_success_at = now(), updated_at = now()
          WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3`,
        [currentWorkspaceId(), PROVIDER, connectionId, from, nextFrom, nextTo, page.orders.length]
      );
    }
    await runWithAccount(account, () => syncMissingOrderItems(connectionId));
  } catch (error) {
    await dbQuery(
      `UPDATE workspace_marketplace_syncs
          SET status = 'error', lease_until = NULL, last_error = $4, updated_at = now()
        WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3`,
      [currentWorkspaceId(), PROVIDER, connectionId, error instanceof Error ? error.message : "Falha ao sincronizar Amazon."]
    );
  }
}

export async function runAmazonSyncBatch(account: AccountCtx, maxSteps = 4): Promise<void> {
  if (!hasDb()) return;
  for (let step = 0; step < maxSteps; step += 1) {
    const row = await getSyncRow(amazonConnectionId(account.sellerId));
    if (row && (row.status === "complete" || row.status === "error")) {
      if (step === 0) await runAmazonSyncStep(account); // ainda concilia itens
      break;
    }
    await runAmazonSyncStep(account);
  }
}
