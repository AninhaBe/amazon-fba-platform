import { dbQuery } from "../db";
import { currentWorkspaceId } from "../workspaceScope";
import { allocateByWeight } from "../profitability";
import type { CanonicalFee, CanonicalOrder, CanonicalProduct } from "./canonical";
import type { IntegrationProvider } from "./types";

// Persistência do modelo canônico (docs/canonical-schema.md).
// As tabelas nascem via migração versionada (npm run migrate), não pelo
// ensureSchema. Cada gravação de pedidos é UM único statement (CTEs): pedido,
// linhas e fees entram atomicamente — sem janela entre delete e insert.
// Fees apenas acumulam/atualizam, porque chegam em momentos diferentes
// (comissão junto com o pedido, frete quando o shipment sincroniza).

export interface CanonicalScope {
  provider: IntegrationProvider;
  connectionId: string;
  /**
   * false = não grava o payload bruto (transição do Mercado Livre: o raw já
   * vive em workspace_marketplace_*, duplicá-lo dobraria tráfego e memória).
   */
  storeRaw?: boolean;
}

/**
 * Durante a migração, a arquitetura nova não pode derrubar a antiga: use este
 * wrapper em sync/webhook para registrar a falha canônica sem propagá-la.
 */
export async function canonicalBestEffort(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    console.error("Falha na escrita canônica (fluxo atual não afetado)", {
      label,
      reason: error instanceof Error ? error.message : "Erro desconhecido",
    });
  }
}

export async function saveCanonicalOrders(scope: CanonicalScope, orders: CanonicalOrder[]): Promise<void> {
  if (!orders.length) return;
  const workspaceId = currentWorkspaceId();
  const orderRecords = orders.map((order) => ({
    external_order_id: order.externalOrderId,
    status: order.status,
    provider_status: order.providerStatus,
    occurred_at: order.occurredAt,
    closed_at: order.closedAt,
    currency: order.currency,
    gross: order.gross,
    buyer_shipping: order.buyerShipping,
    fulfillment: order.fulfillment,
    pack_id: order.packId,
    raw: scope.storeRaw === false ? null : order.raw,
  }));
  const itemRecords = orders.flatMap((order) => order.items.map((item, index) => ({
    external_order_id: order.externalOrderId,
    line_no: index + 1,
    external_product_id: item.externalProductId,
    sku: item.sku,
    title: item.title,
    qty: item.qty,
    unit_price: item.unitPrice,
  })));
  const feeRecords = orders.flatMap((order) => order.fees.map((fee) => ({
    external_order_id: order.externalOrderId,
    fee_type: fee.feeType,
    provider_fee_code: fee.providerFeeCode,
    amount: fee.amount,
    currency: fee.currency,
    external_ref: null as string | null,
  })));

  // Um único statement = atômico. O upsert das linhas cobre line_no <= total
  // e o delete cobre line_no > total: conjuntos disjuntos, sem conflito entre
  // as CTEs. Pedidos que ficaram sem linhas têm todas removidas.
  await dbQuery(
    `WITH orders_payload AS (
       SELECT * FROM jsonb_to_recordset($4::jsonb) AS item(
         external_order_id text, status text, provider_status text, occurred_at timestamptz,
         closed_at timestamptz, currency text, gross numeric, buyer_shipping numeric,
         fulfillment text, pack_id text, raw jsonb
       )
     ),
     upsert_orders AS (
       INSERT INTO workspace_channel_orders
         (workspace_id, provider, connection_id, external_order_id, status, provider_status,
          occurred_at, closed_at, currency, gross, buyer_shipping, fulfillment, pack_id, raw, synced_at)
       SELECT $1, $2, $3, p.external_order_id, p.status, p.provider_status, p.occurred_at,
              p.closed_at, p.currency, p.gross, p.buyer_shipping, p.fulfillment, p.pack_id, p.raw, now()
         FROM orders_payload p
       ON CONFLICT (workspace_id, provider, connection_id, external_order_id) DO UPDATE SET
         status = EXCLUDED.status, provider_status = EXCLUDED.provider_status,
         occurred_at = EXCLUDED.occurred_at, closed_at = EXCLUDED.closed_at,
         currency = EXCLUDED.currency, gross = EXCLUDED.gross,
         buyer_shipping = COALESCE(EXCLUDED.buyer_shipping, workspace_channel_orders.buyer_shipping),
         fulfillment = EXCLUDED.fulfillment, pack_id = EXCLUDED.pack_id,
         raw = COALESCE(EXCLUDED.raw, workspace_channel_orders.raw), synced_at = now()
     ),
     items_payload AS (
       SELECT * FROM jsonb_to_recordset($5::jsonb) AS item(
         external_order_id text, line_no smallint, external_product_id text,
         sku text, title text, qty integer, unit_price numeric
       )
     ),
     upsert_items AS (
       INSERT INTO workspace_channel_order_items
         (workspace_id, provider, connection_id, external_order_id, line_no,
          external_product_id, sku, title, qty, unit_price)
       SELECT $1, $2, $3, p.external_order_id, p.line_no,
              p.external_product_id, p.sku, p.title, p.qty, p.unit_price
         FROM items_payload p
       ON CONFLICT (workspace_id, provider, connection_id, external_order_id, line_no) DO UPDATE SET
         external_product_id = EXCLUDED.external_product_id, sku = EXCLUDED.sku,
         title = EXCLUDED.title, qty = EXCLUDED.qty, unit_price = EXCLUDED.unit_price
     ),
     stale_items AS (
       DELETE FROM workspace_channel_order_items items
        WHERE items.workspace_id = $1 AND items.provider = $2 AND items.connection_id = $3
          AND items.external_order_id = ANY($6::text[])
          AND items.line_no > COALESCE((
            SELECT max(p.line_no) FROM items_payload p
             WHERE p.external_order_id = items.external_order_id
          ), 0)
     ),
     fees_payload AS (
       SELECT * FROM jsonb_to_recordset($7::jsonb) AS item(
         external_order_id text, fee_type text, provider_fee_code text,
         amount numeric, currency text, external_ref text
       )
     )
     INSERT INTO workspace_channel_order_fees
       (workspace_id, provider, connection_id, external_order_id, fee_type, provider_fee_code,
        amount, currency, external_ref)
     SELECT $1, $2, $3, p.external_order_id, p.fee_type, p.provider_fee_code,
            p.amount, p.currency, p.external_ref
       FROM fees_payload p
     ON CONFLICT (workspace_id, provider, connection_id, external_order_id, fee_type, provider_fee_code)
       DO UPDATE SET amount = EXCLUDED.amount, currency = EXCLUDED.currency,
                     external_ref = EXCLUDED.external_ref`,
    [
      workspaceId,
      scope.provider,
      scope.connectionId,
      JSON.stringify(orderRecords),
      JSON.stringify(itemRecords),
      orders.map((order) => order.externalOrderId),
      JSON.stringify(feeRecords),
    ]
  );
}

/**
 * Upsert de headers de pedido para canais em que os itens chegam depois
 * (Amazon: getOrders traz o header; getOrderItems é conciliado aos poucos).
 * Quando o pedido já tem linhas, gross/buyer_shipping refinados são
 * preservados — o header traria de volta a aproximação do OrderTotal.
 */
export async function saveCanonicalOrderHeaders(scope: CanonicalScope, orders: CanonicalOrder[]): Promise<void> {
  if (!orders.length) return;
  const records = orders.map((order) => ({
    external_order_id: order.externalOrderId,
    status: order.status,
    provider_status: order.providerStatus,
    occurred_at: order.occurredAt,
    closed_at: order.closedAt,
    currency: order.currency,
    gross: order.gross,
    buyer_shipping: order.buyerShipping,
    fulfillment: order.fulfillment,
    pack_id: order.packId,
    raw: scope.storeRaw === false ? null : order.raw,
  }));
  await dbQuery(
    `INSERT INTO workspace_channel_orders
       (workspace_id, provider, connection_id, external_order_id, status, provider_status,
        occurred_at, closed_at, currency, gross, buyer_shipping, fulfillment, pack_id, raw, synced_at)
     SELECT $1, $2, $3, p.external_order_id, p.status, p.provider_status, p.occurred_at,
            p.closed_at, p.currency, p.gross, p.buyer_shipping, p.fulfillment, p.pack_id, p.raw, now()
       FROM jsonb_to_recordset($4::jsonb) AS p(
         external_order_id text, status text, provider_status text, occurred_at timestamptz,
         closed_at timestamptz, currency text, gross numeric, buyer_shipping numeric,
         fulfillment text, pack_id text, raw jsonb
       )
     ON CONFLICT (workspace_id, provider, connection_id, external_order_id) DO UPDATE SET
       status = EXCLUDED.status, provider_status = EXCLUDED.provider_status,
       occurred_at = EXCLUDED.occurred_at, closed_at = EXCLUDED.closed_at,
       currency = EXCLUDED.currency,
       gross = CASE WHEN EXISTS (
                 SELECT 1 FROM workspace_channel_order_items i
                  WHERE i.workspace_id = workspace_channel_orders.workspace_id
                    AND i.provider = workspace_channel_orders.provider
                    AND i.connection_id = workspace_channel_orders.connection_id
                    AND i.external_order_id = workspace_channel_orders.external_order_id
               ) THEN workspace_channel_orders.gross ELSE EXCLUDED.gross END,
       buyer_shipping = COALESCE(workspace_channel_orders.buyer_shipping, EXCLUDED.buyer_shipping),
       fulfillment = EXCLUDED.fulfillment, pack_id = EXCLUDED.pack_id,
       raw = COALESCE(EXCLUDED.raw, workspace_channel_orders.raw), synced_at = now()`,
    [currentWorkspaceId(), scope.provider, scope.connectionId, JSON.stringify(records)]
  );
}

export interface OrderItemsApplication {
  externalOrderId: string;
  items: Array<{ externalProductId: string; sku: string | null; title: string; qty: number; unitPrice: number }>;
  /** Receita dos produtos calculada das linhas; substitui a aproximação do header. */
  gross: number;
  buyerShipping: number;
}

/** Aplica linhas conciliadas e refina gross/buyer_shipping — um statement, atômico. */
export async function applyCanonicalOrderItems(
  scope: CanonicalScope,
  applications: OrderItemsApplication[]
): Promise<void> {
  const pending = applications.filter((application) => application.items.length);
  if (!pending.length) return;
  const workspaceId = currentWorkspaceId();
  const itemRecords = pending.flatMap((application) => application.items.map((item, index) => ({
    external_order_id: application.externalOrderId,
    line_no: index + 1,
    external_product_id: item.externalProductId,
    sku: item.sku,
    title: item.title,
    qty: item.qty,
    unit_price: item.unitPrice,
  })));
  const orderRecords = pending.map((application) => ({
    external_order_id: application.externalOrderId,
    gross: application.gross,
    buyer_shipping: application.buyerShipping,
  }));
  await dbQuery(
    `WITH items_payload AS (
       SELECT * FROM jsonb_to_recordset($4::jsonb) AS item(
         external_order_id text, line_no smallint, external_product_id text,
         sku text, title text, qty integer, unit_price numeric
       )
     ),
     upsert_items AS (
       INSERT INTO workspace_channel_order_items
         (workspace_id, provider, connection_id, external_order_id, line_no,
          external_product_id, sku, title, qty, unit_price)
       SELECT $1, $2, $3, p.external_order_id, p.line_no,
              p.external_product_id, p.sku, p.title, p.qty, p.unit_price
         FROM items_payload p
       ON CONFLICT (workspace_id, provider, connection_id, external_order_id, line_no) DO UPDATE SET
         external_product_id = EXCLUDED.external_product_id, sku = EXCLUDED.sku,
         title = EXCLUDED.title, qty = EXCLUDED.qty, unit_price = EXCLUDED.unit_price
     ),
     stale_items AS (
       DELETE FROM workspace_channel_order_items items
        WHERE items.workspace_id = $1 AND items.provider = $2 AND items.connection_id = $3
          AND items.external_order_id = ANY($5::text[])
          AND items.line_no > COALESCE((
            SELECT max(p.line_no) FROM items_payload p
             WHERE p.external_order_id = items.external_order_id
          ), 0)
     )
     UPDATE workspace_channel_orders orders
        SET gross = refined.gross, buyer_shipping = refined.buyer_shipping, synced_at = now()
       FROM jsonb_to_recordset($6::jsonb) AS refined(external_order_id text, gross numeric, buyer_shipping numeric)
      WHERE orders.workspace_id = $1 AND orders.provider = $2 AND orders.connection_id = $3
        AND orders.external_order_id = refined.external_order_id`,
    [
      workspaceId,
      scope.provider,
      scope.connectionId,
      JSON.stringify(itemRecords),
      pending.map((application) => application.externalOrderId),
      JSON.stringify(orderRecords),
    ]
  );
}

/**
 * Upsert das fees conciliadas de um lote de pedidos (ex.: Finances da Amazon).
 * Cada chamada traz o TOTAL corrente por (pedido, tipo, código) — ajustes
 * posteriores substituem o valor, nunca acumulam em dobro.
 */
export async function upsertCanonicalOrderFees(
  scope: CanonicalScope,
  orders: Array<{ externalOrderId: string; fees: CanonicalFee[] }>
): Promise<void> {
  const records = orders.flatMap((order) => order.fees.map((fee) => ({
    external_order_id: order.externalOrderId,
    fee_type: fee.feeType,
    provider_fee_code: fee.providerFeeCode,
    amount: fee.amount,
    currency: fee.currency,
  })));
  if (!records.length) return;
  await dbQuery(
    `INSERT INTO workspace_channel_order_fees
       (workspace_id, provider, connection_id, external_order_id, fee_type, provider_fee_code, amount, currency)
     SELECT $1, $2, $3, p.external_order_id, p.fee_type, p.provider_fee_code, p.amount, p.currency
       FROM jsonb_to_recordset($4::jsonb) AS p(
         external_order_id text, fee_type text, provider_fee_code text, amount numeric, currency text
       )
     ON CONFLICT (workspace_id, provider, connection_id, external_order_id, fee_type, provider_fee_code)
       DO UPDATE SET amount = EXCLUDED.amount, currency = EXCLUDED.currency`,
    [currentWorkspaceId(), scope.provider, scope.connectionId, JSON.stringify(records)]
  );
}

export interface ShipmentCostsApplication {
  /** Pedidos que compartilham o shipment (packs têm mais de um). */
  orderIds: string[];
  sellerShipping: number;
  buyerShipping: number;
  providerFeeCode: string;
  /** Origem do valor (ex.: id do shipment), para auditoria e correção. */
  externalRef: string;
}

/**
 * Aplica custos de frete aos pedidos canônicos, rateando por peso de receita
 * quando o shipment atende mais de um pedido (mesma regra do overview atual).
 * Fee e buyer_shipping entram no mesmo statement (atômico).
 */
export async function applyCanonicalShipmentCosts(
  scope: CanonicalScope,
  applications: ShipmentCostsApplication[]
): Promise<void> {
  const pending = applications.filter((application) => application.orderIds.length);
  if (!pending.length) return;
  const workspaceId = currentWorkspaceId();
  const allIds = [...new Set(pending.flatMap((application) => application.orderIds))];
  const orderRows = await dbQuery<{ external_order_id: string; gross: string; currency: string }>(
    `SELECT external_order_id, gross, currency FROM workspace_channel_orders
      WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
        AND external_order_id = ANY($4::text[])`,
    [workspaceId, scope.provider, scope.connectionId, allIds]
  );
  const byId = new Map(orderRows.map((row) => [row.external_order_id, row]));

  const feeRecords: Array<{
    external_order_id: string;
    fee_type: string;
    provider_fee_code: string;
    amount: number;
    currency: string;
    external_ref: string;
  }> = [];
  const buyerRecords: Array<{ external_order_id: string; buyer_shipping: number }> = [];
  for (const application of pending) {
    // Pedidos ainda não ingeridos no canônico ficam para a próxima passada.
    const known = application.orderIds
      .map((id) => byId.get(id))
      .filter((row): row is NonNullable<typeof row> => !!row);
    if (!known.length) continue;
    const weights = known.map((row) => Number(row.gross));
    const sellerShares = allocateByWeight(application.sellerShipping, weights);
    const buyerShares = allocateByWeight(application.buyerShipping, weights);
    known.forEach((row, index) => {
      feeRecords.push({
        external_order_id: row.external_order_id,
        fee_type: "shipping_seller",
        provider_fee_code: application.providerFeeCode,
        amount: sellerShares[index],
        currency: row.currency,
        external_ref: application.externalRef,
      });
      buyerRecords.push({ external_order_id: row.external_order_id, buyer_shipping: buyerShares[index] });
    });
  }
  if (!feeRecords.length) return;
  await dbQuery(
    `WITH fees_payload AS (
       SELECT * FROM jsonb_to_recordset($4::jsonb) AS item(
         external_order_id text, fee_type text, provider_fee_code text,
         amount numeric, currency text, external_ref text
       )
     ),
     upsert_fees AS (
       INSERT INTO workspace_channel_order_fees
         (workspace_id, provider, connection_id, external_order_id, fee_type, provider_fee_code,
          amount, currency, external_ref)
       SELECT $1, $2, $3, p.external_order_id, p.fee_type, p.provider_fee_code,
              p.amount, p.currency, p.external_ref
         FROM fees_payload p
       ON CONFLICT (workspace_id, provider, connection_id, external_order_id, fee_type, provider_fee_code)
         DO UPDATE SET amount = EXCLUDED.amount, currency = EXCLUDED.currency,
                       external_ref = EXCLUDED.external_ref
     )
     UPDATE workspace_channel_orders orders
        SET buyer_shipping = b.buyer_shipping, synced_at = now()
       FROM jsonb_to_recordset($5::jsonb) AS b(external_order_id text, buyer_shipping numeric)
      WHERE orders.workspace_id = $1 AND orders.provider = $2 AND orders.connection_id = $3
        AND orders.external_order_id = b.external_order_id`,
    [workspaceId, scope.provider, scope.connectionId, JSON.stringify(feeRecords), JSON.stringify(buyerRecords)]
  );
}

export async function saveCanonicalProducts(scope: CanonicalScope, products: CanonicalProduct[]): Promise<void> {
  if (!products.length) return;
  const records = products.map((product) => ({
    external_product_id: product.externalProductId,
    sku: product.sku,
    title: product.title,
    status: product.status,
    provider_status: product.providerStatus,
    price: product.price,
    currency: product.currency,
    available_qty: product.availableQty,
    fulfillment: product.fulfillment,
    thumbnail: product.thumbnail,
    permalink: product.permalink,
    raw: scope.storeRaw === false ? null : product.raw,
  }));
  await dbQuery(
    `INSERT INTO workspace_channel_products
       (workspace_id, provider, connection_id, external_product_id, sku, title, status, provider_status,
        price, currency, available_qty, fulfillment, thumbnail, permalink, raw, synced_at)
     SELECT $1, $2, $3, item.external_product_id, item.sku, item.title, item.status, item.provider_status,
            item.price, item.currency, item.available_qty, item.fulfillment, item.thumbnail, item.permalink,
            item.raw, now()
       FROM jsonb_to_recordset($4::jsonb) AS item(
         external_product_id text, sku text, title text, status text, provider_status text,
         price numeric, currency text, available_qty integer, fulfillment text,
         thumbnail text, permalink text, raw jsonb
       )
     ON CONFLICT (workspace_id, provider, connection_id, external_product_id) DO UPDATE SET
       sku = EXCLUDED.sku, title = EXCLUDED.title, status = EXCLUDED.status,
       provider_status = EXCLUDED.provider_status, price = EXCLUDED.price,
       currency = EXCLUDED.currency, available_qty = EXCLUDED.available_qty,
       fulfillment = EXCLUDED.fulfillment, thumbnail = EXCLUDED.thumbnail,
       permalink = EXCLUDED.permalink,
       raw = COALESCE(EXCLUDED.raw, workspace_channel_products.raw), synced_at = now()`,
    [currentWorkspaceId(), scope.provider, scope.connectionId, JSON.stringify(records)]
  );
  await recordOfferSnapshot(scope, products);
}

// ADR-010: foto diária da oferta. A tabela canônica acima é sobrescrita a cada sync,
// então o passado se perde — e é o passado que explica "parou de vender porque o
// estoque zerou anteontem". Preço e estoque já vieram na mesma resposta do canal, então
// gravar aqui não custa nenhuma chamada extra (mesmo padrão do histórico de ranking).
// Upsert por dia: a última foto do dia é a que vale.
export async function recordOfferSnapshot(
  scope: CanonicalScope,
  products: CanonicalProduct[]
): Promise<void> {
  if (!products.length) return;
  const records = products.map((product) => ({
    external_product_id: product.externalProductId,
    sku: product.sku,
    status: product.status,
    price: product.price,
    currency: product.currency,
    available_qty: product.availableQty,
  }));
  await dbQuery(
    `INSERT INTO workspace_channel_offer_history
       (workspace_id, provider, connection_id, external_product_id, captured_on,
        sku, status, price, currency, available_qty, updated_at)
     SELECT $1, $2, $3, item.external_product_id, CURRENT_DATE,
            item.sku, item.status, item.price, item.currency, item.available_qty, now()
       FROM jsonb_to_recordset($4::jsonb) AS item(
         external_product_id text, sku text, status text,
         price numeric, currency text, available_qty integer
       )
     ON CONFLICT (workspace_id, provider, connection_id, external_product_id, captured_on)
     DO UPDATE SET sku = EXCLUDED.sku, status = EXCLUDED.status, price = EXCLUDED.price,
       currency = EXCLUDED.currency, available_qty = EXCLUDED.available_qty, updated_at = now()`,
    [currentWorkspaceId(), scope.provider, scope.connectionId, JSON.stringify(records)]
  );
}
