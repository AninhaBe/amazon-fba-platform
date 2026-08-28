import crypto from "node:crypto";
import { dbQuery, hasDb } from "../db";
import { runWithWorkspace } from "../workspaceScope";
import { getIntegration } from "./integrationStore";
import {
  mercadoLivreFetch,
  type MercadoLivreItem,
  type MercadoLivreOrder,
  type MercadoLivreProduct,
  type MercadoLivreShipmentCosts,
} from "./mercadoLivre";
import type { MercadoLivreNotification } from "./mercadoLivreNotification";
import type { IntegrationConnection } from "./types";
import {
  canonicalShipmentCosts,
  normalizeMercadoLivreOrder,
  normalizeMercadoLivreProduct,
} from "./mercadoLivreCanonical";
import {
  applyCanonicalShipmentCosts,
  canonicalBestEffort,
  saveCanonicalOrders,
  saveCanonicalProducts,
} from "./canonicalStore";

const PROVIDER = "mercado_livre";
const SUPPORTED_TOPICS = new Set(["orders_v2", "items", "items_prices", "shipments"]);

export interface QueuedMercadoLivreEvent {
  workspaceId: string;
  connectionId: string;
  eventKey: string;
}

interface ConnectionTarget {
  workspace_id: string;
  id: string;
}

interface EventRow {
  workspace_id: string;
  connection_id: string;
  event_key: string;
  topic: string;
  resource: string;
}

function notificationKey(notification: MercadoLivreNotification): string {
  if (notification._id?.trim()) return notification._id.trim();
  return crypto.createHash("sha256").update([
    notification.application_id,
    notification.user_id,
    notification.topic,
    notification.resource,
    notification.sent || notification.received || "",
  ].join("|")).digest("hex");
}

export async function enqueueMercadoLivreNotification(
  notification: MercadoLivreNotification
): Promise<QueuedMercadoLivreEvent[]> {
  if (!hasDb()) throw new Error("Webhooks exigem DATABASE_URL configurada.");
  const targets = await dbQuery<ConnectionTarget>(
    `SELECT workspace_id, id
       FROM workspace_integrations
      WHERE provider = $1 AND external_account_id = $2 AND status = 'connected'`,
    [PROVIDER, String(notification.user_id)]
  );
  const eventKey = notificationKey(notification);
  const queued: QueuedMercadoLivreEvent[] = [];
  for (const target of targets) {
    const inserted = await dbQuery<{ event_key: string }>(
      `INSERT INTO workspace_marketplace_events
         (workspace_id, provider, event_key, connection_id, topic, resource, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
       ON CONFLICT (workspace_id, provider, event_key) DO UPDATE SET
         connection_id = EXCLUDED.connection_id,
         topic = EXCLUDED.topic,
         resource = EXCLUDED.resource,
         payload = EXCLUDED.payload,
         status = 'pending',
         processing_at = NULL,
         last_error = NULL
       WHERE workspace_marketplace_events.status IN ('pending', 'error')
          OR (workspace_marketplace_events.status = 'processing'
              AND (workspace_marketplace_events.processing_at IS NULL
                   OR workspace_marketplace_events.processing_at < now() - interval '5 minutes'))
       RETURNING event_key`,
      [target.workspace_id, PROVIDER, eventKey, target.id, notification.topic,
       notification.resource, JSON.stringify(notification)]
    );
    if (inserted.length) queued.push({ workspaceId: target.workspace_id, connectionId: target.id, eventKey });
  }
  return queued;
}

function itemSku(item: MercadoLivreItem): string | null {
  return item.seller_custom_field
    || item.attributes?.find((attribute) => attribute.id === "SELLER_SKU")?.value_name
    || null;
}

function webhookProduct(connectionId: string, item: MercadoLivreItem): MercadoLivreProduct {
  const sku = itemSku(item);
  return {
    id: item.id,
    costId: `mercado_livre:${connectionId}:${sku ? `sku:${sku}` : `item:${item.id}`}`,
    sku,
    title: item.title,
    price: item.price,
    currency: item.currency_id,
    availableQuantity: item.available_quantity,
    soldQuantity: item.sold_quantity,
    status: item.status,
    activeSince: item.start_time ?? null,
    lastUpdated: item.last_updated ?? null,
    thumbnail: item.pictures?.[0]?.secure_url || item.pictures?.[0]?.url || item.thumbnail || null,
    permalink: item.permalink ?? null,
    userProductId: item.user_product_id ?? null,
    listingTypeId: item.listing_type_id ?? null,
    logisticType: item.shipping?.logistic_type ?? null,
    shippingMode: item.shipping?.mode ?? null,
    freeShipping: item.shipping?.free_shipping ?? false,
    catalogListing: item.catalog_listing ?? false,
    catalogProductId: item.catalog_product_id ?? null,
    cost: null,
  };
}

async function saveOrder(workspaceId: string, connectionId: string, order: MercadoLivreOrder) {
  await dbQuery(
    `INSERT INTO workspace_marketplace_orders
       (workspace_id, provider, connection_id, external_order_id, status, occurred_at, payload, synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,now())
     ON CONFLICT (workspace_id, provider, connection_id, external_order_id) DO UPDATE SET
       status = EXCLUDED.status, occurred_at = EXCLUDED.occurred_at,
       payload = EXCLUDED.payload, synced_at = now()
     -- Mesma regra do sync (ADR-022): webhook reentregue com payload idêntico não
     -- gera escrita. O ML reenvia a mesma notificação várias vezes por pedido.
     WHERE (workspace_marketplace_orders.status, workspace_marketplace_orders.occurred_at,
            workspace_marketplace_orders.payload)
       IS DISTINCT FROM (EXCLUDED.status, EXCLUDED.occurred_at, EXCLUDED.payload)`,
    [workspaceId, PROVIDER, connectionId, String(order.id), order.status,
     order.date_created, JSON.stringify(order)]
  );
}

async function saveShipment(
  workspaceId: string,
  connectionId: string,
  shipmentId: string,
  payload: MercadoLivreShipmentCosts
) {
  await dbQuery(
    `INSERT INTO workspace_marketplace_shipments
       (workspace_id, provider, connection_id, external_shipment_id, payload, synced_at)
     VALUES ($1,$2,$3,$4,$5::jsonb,now())
     ON CONFLICT (workspace_id, provider, connection_id, external_shipment_id) DO UPDATE SET
       payload = EXCLUDED.payload, synced_at = now()
     WHERE workspace_marketplace_shipments.payload IS DISTINCT FROM EXCLUDED.payload`,
    [workspaceId, PROVIDER, connectionId, shipmentId, JSON.stringify(payload)]
  );
}

async function saveProduct(workspaceId: string, connectionId: string, product: MercadoLivreProduct) {
  await dbQuery(
    `INSERT INTO workspace_marketplace_products
       (workspace_id, provider, connection_id, external_product_id, status, payload, synced_at)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,now())
     ON CONFLICT (workspace_id, provider, connection_id, external_product_id) DO UPDATE SET
       status = EXCLUDED.status, payload = EXCLUDED.payload, synced_at = now()
     WHERE (workspace_marketplace_products.status, workspace_marketplace_products.payload)
       IS DISTINCT FROM (EXCLUDED.status, EXCLUDED.payload)`,
    [workspaceId, PROVIDER, connectionId, product.id, product.status, JSON.stringify(product)]
  );
  await dbQuery(
    `UPDATE workspace_marketplace_syncs sync
        SET products_synced_at = now(), updated_at = now(),
            products_total = counts.total, active_products = counts.active
       FROM (
         SELECT count(*)::integer AS total,
                count(*) FILTER (WHERE status = 'active')::integer AS active
           FROM workspace_marketplace_products
          WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
       ) counts
      WHERE sync.workspace_id = $1 AND sync.provider = $2 AND sync.connection_id = $3`,
    [workspaceId, PROVIDER, connectionId]
  );
}

// Roteia os custos do shipment para todos os pedidos que o compartilham
// (packs) — o store rateia por receita, como o overview faz hoje.
async function applyShipmentToCanonical(
  workspaceId: string,
  connection: IntegrationConnection,
  shipmentId: string,
  costs: MercadoLivreShipmentCosts
) {
  const rows = await dbQuery<{ external_order_id: string }>(
    `SELECT external_order_id FROM workspace_marketplace_orders
      WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
        AND status = 'paid' AND payload #>> '{shipping,id}' = $4`,
    [workspaceId, PROVIDER, connection.id, shipmentId]
  );
  await applyCanonicalShipmentCosts({ provider: PROVIDER, connectionId: connection.id }, [{
    orderIds: rows.map((item) => item.external_order_id),
    ...canonicalShipmentCosts(costs, connection.externalAccountId),
    providerFeeCode: "shipment_sender_cost",
    externalRef: shipmentId,
  }]);
}

async function processResource(row: EventRow) {
  await runWithWorkspace(row.workspace_id, async () => {
    const connection = await getIntegration(row.connection_id);
    if (!connection || connection.provider !== PROVIDER) throw new Error("Conexão do Mercado Livre não encontrada.");

    if (row.topic === "orders_v2" && /^\/orders\/\d+$/.test(row.resource)) {
      const order = await mercadoLivreFetch<MercadoLivreOrder>(connection, row.resource);
      await saveOrder(row.workspace_id, row.connection_id, order);
      await canonicalBestEffort("webhook:order", () => saveCanonicalOrders(
        { provider: PROVIDER, connectionId: row.connection_id, storeRaw: false },
        [normalizeMercadoLivreOrder(order, { sellerId: connection.externalAccountId })]
      ));
      const shipmentId = order.shipping?.id == null ? null : String(order.shipping.id);
      if (shipmentId) {
        try {
          const costs = await mercadoLivreFetch<MercadoLivreShipmentCosts>(connection, `/shipments/${encodeURIComponent(shipmentId)}/costs`);
          await saveShipment(row.workspace_id, row.connection_id, shipmentId, costs);
          await canonicalBestEffort("webhook:order-shipment", () =>
            applyShipmentToCanonical(row.workspace_id, connection, shipmentId, costs));
        } catch {
          // A conciliação periódica cobre custos ainda indisponíveis no momento do evento.
        }
      }
      await dbQuery(
        `UPDATE workspace_marketplace_syncs
            SET covered_to = GREATEST(COALESCE(covered_to, $4::timestamptz), $4::timestamptz),
                last_success_at = now(), updated_at = now()
          WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3`,
        [row.workspace_id, PROVIDER, row.connection_id, new Date().toISOString()]
      );
      return;
    }

    if ((row.topic === "items" || row.topic === "items_prices")) {
      const itemId = row.resource.match(/\/items\/(MLB\d+)/i)?.[1]?.toUpperCase();
      if (!itemId) throw new Error("Recurso de anúncio não reconhecido.");
      const item = await mercadoLivreFetch<MercadoLivreItem>(connection, `/items/${encodeURIComponent(itemId)}`);
      const product = webhookProduct(row.connection_id, item);
      await saveProduct(row.workspace_id, row.connection_id, product);
      await canonicalBestEffort("webhook:product", () => saveCanonicalProducts(
        { provider: PROVIDER, connectionId: row.connection_id, storeRaw: false },
        [normalizeMercadoLivreProduct(product)]
      ));
      return;
    }

    if (row.topic === "shipments") {
      const shipmentId = row.resource.match(/\/shipments\/(\d+)/)?.[1];
      if (!shipmentId) throw new Error("Recurso de remessa não reconhecido.");
      const costs = await mercadoLivreFetch<MercadoLivreShipmentCosts>(connection, `/shipments/${shipmentId}/costs`);
      await saveShipment(row.workspace_id, row.connection_id, shipmentId, costs);
      await canonicalBestEffort("webhook:shipment", () =>
        applyShipmentToCanonical(row.workspace_id, connection, shipmentId, costs));
      return;
    }

    if (SUPPORTED_TOPICS.has(row.topic)) throw new Error("Formato de recurso não reconhecido.");
  });
}

export async function processMercadoLivreEvent(event: QueuedMercadoLivreEvent): Promise<void> {
  const rows = await dbQuery<EventRow>(
    `UPDATE workspace_marketplace_events
        SET status = 'processing', processing_at = now(), attempts = attempts + 1, last_error = NULL
      WHERE workspace_id = $1 AND provider = $2 AND event_key = $3
        AND status IN ('pending', 'error')
      RETURNING workspace_id, connection_id, event_key, topic, resource`,
    [event.workspaceId, PROVIDER, event.eventKey]
  );
  const row = rows[0];
  if (!row) return;
  try {
    await processResource(row);
    await runWithWorkspace(row.workspace_id, async () => {
      await dbQuery(
        `UPDATE workspace_marketplace_syncs
            SET last_success_at = now(), updated_at = now()
          WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3`,
        [row.workspace_id, PROVIDER, row.connection_id]
      );
    });
    await dbQuery(
      `UPDATE workspace_marketplace_events
          SET status = 'complete', processing_at = NULL, processed_at = now(), last_error = NULL
        WHERE workspace_id = $1 AND provider = $2 AND event_key = $3`,
      [row.workspace_id, PROVIDER, row.event_key]
    );
  } catch (error) {
    await dbQuery(
      `UPDATE workspace_marketplace_events
          SET status = 'error', processing_at = NULL, last_error = $4
        WHERE workspace_id = $1 AND provider = $2 AND event_key = $3`,
      [row.workspace_id, PROVIDER, row.event_key,
       error instanceof Error ? error.message : "Falha ao processar notificação."]
    );
    throw error;
  }
}
