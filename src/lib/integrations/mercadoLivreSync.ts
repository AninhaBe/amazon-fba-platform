import { dbQuery, hasDb } from "../db";
import { currentWorkspaceId } from "../workspaceScope";
import type { IntegrationConnection } from "./types";
import {
  getMercadoLivreProducts,
  mercadoLivreFetch,
  type MercadoLivreOrder,
  type MercadoLivreOverviewSource,
  type MercadoLivrePeriod,
  type MercadoLivreShipmentCosts,
} from "./mercadoLivre";

const PROVIDER = "mercado_livre";
const DAY = 86_400_000;
// Um dia extra cobre o início do dia no filtro personalizado de 365 dias.
const HISTORY_DAYS = 366;
const WINDOW_DAYS = 7;
const PAGE_SIZE = 50;
const SHIPMENT_CONCURRENCY = 5;
const FRESH_FOR_MS = 10 * 60_000;
const COVERAGE_TOLERANCE_MS = 15 * 60_000;

interface SyncRow {
  status: "pending" | "syncing" | "complete" | "error";
  target_from: Date | string;
  target_to: Date | string;
  covered_from: Date | string | null;
  covered_to: Date | string | null;
  cursor_from: Date | string;
  cursor_to: Date | string;
  cursor_offset: number;
  processed_orders: number;
  products_synced_at: Date | string | null;
  products_total: number;
  active_products: number;
  products_complete: boolean;
  lease_until: Date | string | null;
  last_error: string | null;
  last_success_at: Date | string | null;
  updated_at: Date | string;
}

export interface MercadoLivreSyncStatus {
  status: SyncRow["status"] | "unavailable";
  progress: number;
  processedOrders: number;
  coveredFrom: string | null;
  coveredTo: string | null;
  lastSuccessAt: string | null;
  error: string | null;
  busy?: boolean;
}

function iso(value: Date | string | null): string | null {
  return value == null ? null : new Date(value).toISOString();
}

function publicStatus(row?: SyncRow, busy = false): MercadoLivreSyncStatus {
  if (!row) {
    return { status: "unavailable", progress: 0, processedOrders: 0, coveredFrom: null, coveredTo: null, lastSuccessAt: null, error: null };
  }
  const targetFrom = new Date(row.target_from).getTime();
  const targetTo = new Date(row.target_to).getTime();
  const cursorFrom = new Date(row.cursor_from).getTime();
  const span = Math.max(1, targetTo - targetFrom);
  const progress = row.status === "complete" ? 100 : Math.max(0, Math.min(99, Math.round((targetTo - cursorFrom) / span * 100)));
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
            cursor_offset, processed_orders, products_synced_at, products_total, active_products,
            products_complete, lease_until, last_error, last_success_at, updated_at
       FROM workspace_marketplace_syncs
      WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3`,
    [currentWorkspaceId(), PROVIDER, connectionId]
  );
  return rows[0];
}

export async function ensureMercadoLivreSyncState(connectionId: string): Promise<MercadoLivreSyncStatus> {
  if (!hasDb()) return publicStatus();
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
  return publicStatus(await getSyncRow(connectionId));
}

export async function requestMercadoLivreSync(connectionId: string): Promise<MercadoLivreSyncStatus> {
  await ensureMercadoLivreSyncState(connectionId);
  const row = await getSyncRow(connectionId);
  const lastSuccess = row?.last_success_at ? new Date(row.last_success_at).getTime() : 0;
  if (row?.status === "complete" && Date.now() - lastSuccess > FRESH_FOR_MS) {
    const now = new Date();
    const coveredTo = row.covered_to ? new Date(row.covered_to) : new Date(row.target_to);
    await dbQuery(
      `UPDATE workspace_marketplace_syncs
          SET status = 'pending', target_from = $5, target_to = $4, cursor_from = $5, cursor_to = $4,
              cursor_offset = 0, last_error = NULL, updated_at = now()
        WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3`,
      [currentWorkspaceId(), PROVIDER, connectionId, now, coveredTo]
    );
  }
  return publicStatus(await getSyncRow(connectionId));
}

async function saveOrders(connectionId: string, orders: MercadoLivreOrder[]): Promise<void> {
  if (!orders.length) return;
  const records = orders.map((order) => ({
    external_order_id: String(order.id),
    status: order.status,
    occurred_at: order.date_created,
    payload: order,
  }));
  await dbQuery(
    `INSERT INTO workspace_marketplace_orders
       (workspace_id, provider, connection_id, external_order_id, status, occurred_at, payload, synced_at)
     SELECT $1, $2, $3, item.external_order_id, item.status, item.occurred_at, item.payload, now()
       FROM jsonb_to_recordset($4::jsonb) AS item(
         external_order_id text, status text, occurred_at timestamptz, payload jsonb
       )
     ON CONFLICT (workspace_id, provider, connection_id, external_order_id) DO UPDATE SET
       status = EXCLUDED.status, occurred_at = EXCLUDED.occurred_at,
       payload = EXCLUDED.payload, synced_at = now()`,
    [currentWorkspaceId(), PROVIDER, connectionId, JSON.stringify(records)]
  );
}

async function syncProducts(connection: IntegrationConnection): Promise<void> {
  const data = await getMercadoLivreProducts(connection);
  if (data.products.length) {
    const records = data.products.map((product) => ({
      external_product_id: product.id,
      status: product.status,
      payload: product,
    }));
    await dbQuery(
      `INSERT INTO workspace_marketplace_products
         (workspace_id, provider, connection_id, external_product_id, status, payload, synced_at)
       SELECT $1, $2, $3, item.external_product_id, item.status, item.payload, now()
         FROM jsonb_to_recordset($4::jsonb) AS item(
           external_product_id text, status text, payload jsonb
         )
       ON CONFLICT (workspace_id, provider, connection_id, external_product_id) DO UPDATE SET
         status = EXCLUDED.status, payload = EXCLUDED.payload, synced_at = now()`,
      [currentWorkspaceId(), PROVIDER, connection.id, JSON.stringify(records)]
    );
  }
  await dbQuery(
    `UPDATE workspace_marketplace_syncs
        SET products_synced_at = now(), products_total = $4, active_products = $5,
            products_complete = $6, updated_at = now()
      WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3`,
    [currentWorkspaceId(), PROVIDER, connection.id, data.total, data.activeTotal, data.complete]
  );
}

async function syncShipmentCosts(connection: IntegrationConnection, orders: MercadoLivreOrder[]): Promise<void> {
  const shipmentIds = [...new Set(orders
    .filter((order) => order.status === "paid")
    .map((order) => order.shipping?.id == null ? null : String(order.shipping.id))
    .filter((id): id is string => id !== null))];
  const records: Array<{ external_shipment_id: string; payload: MercadoLivreShipmentCosts }> = [];
  for (let index = 0; index < shipmentIds.length; index += SHIPMENT_CONCURRENCY) {
    const batch = shipmentIds.slice(index, index + SHIPMENT_CONCURRENCY);
    const costs = await Promise.all(batch.map(async (shipmentId) => {
      try {
        const payload = await mercadoLivreFetch<MercadoLivreShipmentCosts>(connection, `/shipments/${encodeURIComponent(shipmentId)}/costs`);
        return { shipmentId, payload };
      } catch {
        return null;
      }
    }));
    for (const item of costs) if (item) records.push({ external_shipment_id: item.shipmentId, payload: item.payload });
  }
  if (records.length) {
    await dbQuery(
      `INSERT INTO workspace_marketplace_shipments
         (workspace_id, provider, connection_id, external_shipment_id, payload, synced_at)
       SELECT $1, $2, $3, item.external_shipment_id, item.payload, now()
         FROM jsonb_to_recordset($4::jsonb) AS item(external_shipment_id text, payload jsonb)
       ON CONFLICT (workspace_id, provider, connection_id, external_shipment_id) DO UPDATE SET
         payload = EXCLUDED.payload, synced_at = now()`,
      [currentWorkspaceId(), PROVIDER, connection.id, JSON.stringify(records)]
    );
  }
}

export async function runMercadoLivreSyncStep(connection: IntegrationConnection): Promise<MercadoLivreSyncStatus> {
  if (!hasDb()) return publicStatus();
  await requestMercadoLivreSync(connection.id);
  const leased = await dbQuery<SyncRow>(
    `UPDATE workspace_marketplace_syncs
        SET lease_until = now() + interval '5 minutes', status = 'syncing', updated_at = now()
      WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
        AND status <> 'complete' AND (lease_until IS NULL OR lease_until < now())
      RETURNING status, target_from, target_to, covered_from, covered_to, cursor_from, cursor_to,
                cursor_offset, processed_orders, products_synced_at, products_total, active_products,
                products_complete, lease_until, last_error, last_success_at, updated_at`,
    [currentWorkspaceId(), PROVIDER, connection.id]
  );
  const row = leased[0];
  if (!row) return publicStatus(await getSyncRow(connection.id), true);

  try {
    const productsDue = !row.products_synced_at || Date.now() - new Date(row.products_synced_at).getTime() > 60 * 60_000;
    if (productsDue) await syncProducts(connection);

    const from = new Date(row.cursor_from);
    const to = new Date(row.cursor_to);
    const offset = row.cursor_offset;
    const accountId = encodeURIComponent(connection.externalAccountId);
    const page = await mercadoLivreFetch<{ paging?: { total?: number }; results?: MercadoLivreOrder[] }>(
      connection,
      `/orders/search?seller=${accountId}&order.date_created.from=${encodeURIComponent(from.toISOString())}&order.date_created.to=${encodeURIComponent(to.toISOString())}&sort=date_desc&limit=${PAGE_SIZE}&offset=${offset}`
    );
    const orders = page.results ?? [];
    const total = page.paging?.total ?? orders.length;
    await saveOrders(connection.id, orders);
    await syncShipmentCosts(connection, orders);

    const pageComplete = offset + orders.length >= total || orders.length < PAGE_SIZE;
    const targetFrom = new Date(row.target_from);
    if (pageComplete && from.getTime() <= targetFrom.getTime()) {
      await dbQuery(
        `UPDATE workspace_marketplace_syncs
            SET status = 'complete', covered_from = COALESCE(covered_from, target_from), covered_to = target_to,
                processed_orders = processed_orders + $4, cursor_offset = 0,
                lease_until = NULL, last_error = NULL, last_success_at = now(), updated_at = now()
          WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3`,
        [currentWorkspaceId(), PROVIDER, connection.id, orders.length]
      );
    } else if (pageComplete) {
      const nextTo = from;
      const nextFrom = new Date(Math.max(targetFrom.getTime(), nextTo.getTime() - WINDOW_DAYS * DAY));
      await dbQuery(
        `UPDATE workspace_marketplace_syncs
            SET status = 'pending', covered_from = $4,
                covered_to = COALESCE(covered_to, target_to), cursor_from = $5, cursor_to = $6,
                cursor_offset = 0, processed_orders = processed_orders + $7,
                lease_until = NULL, last_error = NULL, last_success_at = now(), updated_at = now()
          WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3`,
        [currentWorkspaceId(), PROVIDER, connection.id, from, nextFrom, nextTo, orders.length]
      );
    } else {
      await dbQuery(
        `UPDATE workspace_marketplace_syncs
            SET status = 'pending', cursor_offset = $4,
                processed_orders = processed_orders + $5, lease_until = NULL,
                last_error = NULL, last_success_at = now(), updated_at = now()
          WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3`,
        [currentWorkspaceId(), PROVIDER, connection.id, offset + orders.length, orders.length]
      );
    }
  } catch (error) {
    await dbQuery(
      `UPDATE workspace_marketplace_syncs
          SET status = 'error', lease_until = NULL, last_error = $4, updated_at = now()
        WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3`,
      [currentWorkspaceId(), PROVIDER, connection.id, error instanceof Error ? error.message : "Falha ao sincronizar Mercado Livre."]
    );
  }
  return publicStatus(await getSyncRow(connection.id));
}

export async function loadMercadoLivreSource(
  connection: IntegrationConnection,
  period: MercadoLivrePeriod
): Promise<{ source: MercadoLivreOverviewSource | null; sync: MercadoLivreSyncStatus }> {
  if (!hasDb()) return { source: null, sync: publicStatus() };
  await ensureMercadoLivreSyncState(connection.id);
  const row = await getSyncRow(connection.id);
  const coveredFrom = row?.covered_from ? new Date(row.covered_from).getTime() : Number.POSITIVE_INFINITY;
  const coveredTo = row?.covered_to ? new Date(row.covered_to).getTime() : 0;
  const periodCovered = coveredFrom <= period.from.getTime()
    && coveredTo + COVERAGE_TOLERANCE_MS >= period.to.getTime()
    && !!row?.products_synced_at;
  if (!row || !periodCovered) return { source: null, sync: publicStatus(row) };

  const orderRows = await dbQuery<{ payload: MercadoLivreOrder }>(
    `SELECT payload FROM workspace_marketplace_orders
      WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
        AND occurred_at >= $4 AND occurred_at <= $5
      ORDER BY occurred_at DESC`,
    [currentWorkspaceId(), PROVIDER, connection.id, period.from, period.to]
  );
  const productRows = await dbQuery<{ payload: MercadoLivreOverviewSource["productsData"]["products"][number] }>(
    `SELECT payload FROM workspace_marketplace_products
      WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
      ORDER BY synced_at DESC`,
    [currentWorkspaceId(), PROVIDER, connection.id]
  );
  const orders = orderRows.map((item) => item.payload);
  const paidOrders = orders.filter((order) => order.status === "paid").slice(0, 1_000);
  const shipmentIds = [...new Set(paidOrders
    .map((order) => order.shipping?.id == null ? null : String(order.shipping.id))
    .filter((id): id is string => id !== null))];
  const shipmentRows = shipmentIds.length
    ? await dbQuery<{ external_shipment_id: string; payload: MercadoLivreShipmentCosts }>(
        `SELECT external_shipment_id, payload FROM workspace_marketplace_shipments
          WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
            AND external_shipment_id = ANY($4::text[])`,
        [currentWorkspaceId(), PROVIDER, connection.id, shipmentIds]
      )
    : [];
  const source: MercadoLivreOverviewSource = {
    user: {
      id: connection.externalAccountId,
      nickname: String(connection.metadata.nickname ?? connection.displayName ?? "Mercado Livre"),
      site_id: String(connection.metadata.siteId ?? connection.region ?? "MLB"),
    },
    productsData: {
      products: productRows.map((item) => item.payload),
      total: row.products_total,
      activeTotal: row.active_products,
      complete: row.products_complete,
    },
    orders,
    totalOrders: orders.length,
    ordersComplete: true,
    shipmentCosts: new Map(shipmentRows.map((item) => [item.external_shipment_id, item.payload])),
  };
  return { source, sync: publicStatus(row) };
}
