// Backfill do modelo canônico (docs/canonical-schema.md, passo 3 da migração).
// Reprocessa os payloads já salvos em workspace_marketplace_orders/products/
// shipments pelos mesmos normalizadores da gravação dupla — nenhuma chamada à
// API do Mercado Livre, só leitura do Postgres e upserts idempotentes (pode
// rodar quantas vezes quiser).
//
// Uso:  npm run backfill:canonical
// (ou:  node --experimental-strip-types --import ./scripts/ts-resolver.mjs \
//         --env-file=.env.local scripts/backfill-canonical.mjs)

import { dbQuery, hasDb } from "../src/lib/db.ts";
import { runWithWorkspace } from "../src/lib/workspaceScope.ts";
import {
  canonicalShipmentCosts,
  normalizeMercadoLivreOrder,
  normalizeMercadoLivreProduct,
} from "../src/lib/integrations/mercadoLivreCanonical.ts";
import {
  applyCanonicalShipmentCosts,
  saveCanonicalOrders,
  saveCanonicalProducts,
} from "../src/lib/integrations/canonicalStore.ts";

const PROVIDER = "mercado_livre";
const BATCH = 500;

if (!hasDb()) {
  console.error("Defina DATABASE_URL no .env.local para rodar o backfill.");
  process.exit(1);
}

const [{ table }] = await dbQuery("SELECT to_regclass('public.workspace_channel_orders') AS table");
if (!table) {
  console.error("As tabelas canônicas ainda não existem. Rode antes: npm run migrate");
  process.exit(1);
}

async function backfillOrders(connection) {
  let cursor = "";
  let total = 0;
  for (;;) {
    const rows = await dbQuery(
      `SELECT external_order_id, payload FROM workspace_marketplace_orders
        WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
          AND external_order_id > $4
        ORDER BY external_order_id
        LIMIT $5`,
      [connection.workspace_id, PROVIDER, connection.id, cursor, BATCH]
    );
    if (!rows.length) break;
    await saveCanonicalOrders(
      { provider: PROVIDER, connectionId: connection.id, storeRaw: false },
      rows.map((row) =>
        normalizeMercadoLivreOrder(row.payload, { sellerId: connection.external_account_id })
      )
    );
    total += rows.length;
    cursor = rows[rows.length - 1].external_order_id;
    console.log(`    pedidos: ${total}`);
  }
  return total;
}

async function backfillShipments(connection) {
  let cursor = "";
  let total = 0;
  for (;;) {
    // O frete é aplicado por shipment com os pedidos que o compartilham
    // (packs) — o store rateia por receita, como no fluxo ao vivo.
    const rows = await dbQuery(
      `SELECT shipments.external_shipment_id, shipments.payload,
              array_agg(orders.external_order_id) AS order_ids
         FROM workspace_marketplace_shipments shipments
         JOIN workspace_marketplace_orders orders
           ON orders.workspace_id = shipments.workspace_id
          AND orders.provider = shipments.provider
          AND orders.connection_id = shipments.connection_id
          AND orders.payload #>> '{shipping,id}' = shipments.external_shipment_id
          AND orders.status = 'paid'
        WHERE shipments.workspace_id = $1 AND shipments.provider = $2
          AND shipments.connection_id = $3 AND shipments.external_shipment_id > $4
        GROUP BY shipments.external_shipment_id, shipments.payload
        ORDER BY shipments.external_shipment_id
        LIMIT $5`,
      [connection.workspace_id, PROVIDER, connection.id, cursor, BATCH]
    );
    if (!rows.length) break;
    await applyCanonicalShipmentCosts(
      { provider: PROVIDER, connectionId: connection.id },
      rows.map((row) => ({
        orderIds: row.order_ids,
        ...canonicalShipmentCosts(row.payload, connection.external_account_id),
        providerFeeCode: "shipment_sender_cost",
        externalRef: row.external_shipment_id,
      }))
    );
    total += rows.length;
    cursor = rows[rows.length - 1].external_shipment_id;
    console.log(`    fretes: ${total}`);
  }
  return total;
}

async function backfillProducts(connection) {
  let cursor = "";
  let total = 0;
  for (;;) {
    const rows = await dbQuery(
      `SELECT external_product_id, payload FROM workspace_marketplace_products
        WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
          AND external_product_id > $4
        ORDER BY external_product_id
        LIMIT $5`,
      [connection.workspace_id, PROVIDER, connection.id, cursor, BATCH]
    );
    if (!rows.length) break;
    await saveCanonicalProducts(
      { provider: PROVIDER, connectionId: connection.id, storeRaw: false },
      rows.map((row) => normalizeMercadoLivreProduct(row.payload))
    );
    total += rows.length;
    cursor = rows[rows.length - 1].external_product_id;
    console.log(`    produtos: ${total}`);
  }
  return total;
}

const connections = await dbQuery(
  `SELECT workspace_id, id, external_account_id
     FROM workspace_integrations
    WHERE provider = $1
    ORDER BY workspace_id, id`,
  [PROVIDER]
);

// Pedidos de conexões removidas ficam órfãos do external_account_id (o
// sellerId da regra de frete) — apontamos em vez de adivinhar.
const orphans = await dbQuery(
  `SELECT DISTINCT orders.workspace_id, orders.connection_id
     FROM workspace_marketplace_orders orders
     LEFT JOIN workspace_integrations integrations
       ON integrations.workspace_id = orders.workspace_id AND integrations.id = orders.connection_id
    WHERE orders.provider = $1 AND integrations.id IS NULL`,
  [PROVIDER]
);
for (const orphan of orphans) {
  console.warn(`Aviso: pedidos da conexão ${orphan.connection_id} (workspace ${orphan.workspace_id}) foram ignorados — a conexão não existe mais.`);
}

if (!connections.length) {
  console.log("Nenhuma conexão do Mercado Livre encontrada. Nada a fazer.");
  process.exit(0);
}

let grand = { orders: 0, shipments: 0, products: 0 };
for (const connection of connections) {
  console.log(`Conexão ${connection.id} (workspace ${connection.workspace_id}):`);
  await runWithWorkspace(connection.workspace_id, async () => {
    grand.orders += await backfillOrders(connection);
    grand.products += await backfillProducts(connection);
    // Por último: o rateio do frete precisa dos pedidos já no canônico.
    grand.shipments += await backfillShipments(connection);
  });
}

console.log(
  `\nBackfill concluído: ${grand.orders} pedidos, ${grand.shipments} fretes e ${grand.products} produtos normalizados em ${connections.length} conexão(ões).`
);
process.exit(0);
