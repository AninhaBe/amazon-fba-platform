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
import { invalidateMercadoLivreOverviewSnapshots } from "./mercadoLivreOverviewCache";
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
import {
  MercadoLivreLeaseLostError,
  nextMercadoLivreOrderWindow,
} from "./mercadoLivreSyncControl";
import { inicioDoMesVigente } from "./inicioDoMes";

const PROVIDER = "mercado_livre";
const DAY = 86_400_000;
const WINDOW_DAYS = 7;
const PAGE_SIZE = 50;
const SHIPMENT_CONCURRENCY = 5;
const SHIPMENT_BATCH_SIZE = 5;
/**
 * Por quanto tempo um sync "complete" é considerado fresco. Enquanto vale, o
 * canal se recusa a abrir janela nova.
 *
 * 6 HORAS → 2 MINUTOS em 23/08/2026. A Amazon já tinha feito essa queda em
 * 21/08 (ADR-023) pelo mesmo motivo, e ninguém replicou aqui — o resultado foi
 * o painel dela mostrando o Mercado Livre com **8h42 de defasagem** enquanto a
 * Amazon estava com 3 minutos, num produto que ela usa como tempo real.
 *
 * ⚠️ Este valor é EXPORTADO e o `mercadoLivreScheduler` o consome na consulta de
 * candidatos. São dois portões em série — o scheduler decide SE a conexão entra
 * no lote, este decide SE a janela abre — e divergir entre eles faz o sync rodar
 * e não trazer nada. Antes eram dois literais soltos; agora é um número só.
 *
 * O custo é baixo porque a janela é INCREMENTAL: cada passada cobre de
 * `covered_to` até agora, ou seja, ~2 minutos de pedidos.
 */
export const FRESH_FOR_MS = 2 * 60_000;
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
  reverify_to: Date | string | null;
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
            products_complete, lease_until, last_error, last_success_at, reverify_to, updated_at
       FROM workspace_marketplace_syncs
      WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3`,
    [currentWorkspaceId(), PROVIDER, connectionId]
  );
  return rows[0];
}

export async function ensureMercadoLivreSyncState(connectionId: string): Promise<MercadoLivreSyncStatus> {
  if (!hasDb()) return publicStatus();
  return publicStatus(await ensureSyncRow(connectionId));
}

async function ensureSyncRow(connectionId: string): Promise<SyncRow> {
  const existing = await getSyncRow(connectionId);
  if (existing) return existing;
  const now = new Date();
  // Conta nova importa o MÊS VIGENTE (decisão da Ana, 27/08/2026): quem conecta
  // no dia 17 vê os 17 dias do mês; dali em diante o histórico cresce para
  // frente. Sem aprofundamento retroativo em background. Conexão antiga não é
  // tocada: este INSERT só cria a linha quando ela não existe.
  const targetFrom = inicioDoMesVigente(now);
  const cursorFrom = new Date(Math.max(targetFrom.getTime(), now.getTime() - WINDOW_DAYS * DAY));
  await dbQuery(
    `INSERT INTO workspace_marketplace_syncs
       (workspace_id, provider, connection_id, status, target_from, target_to, cursor_from, cursor_to)
     VALUES ($1,$2,$3,'pending',$4,$5,$6,$5)
     ON CONFLICT (workspace_id, provider, connection_id) DO NOTHING`,
    [currentWorkspaceId(), PROVIDER, connectionId, targetFrom, now, cursorFrom]
  );
  const created = await getSyncRow(connectionId);
  if (!created) throw new Error("Não foi possível iniciar a sincronização do Mercado Livre.");
  return created;
}

export async function requestMercadoLivreSync(connectionId: string): Promise<MercadoLivreSyncStatus> {
  const row = await ensureSyncRow(connectionId);
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

async function saveOrders(connection: IntegrationConnection, orders: MercadoLivreOrder[]): Promise<void> {
  if (!orders.length) return;
  const connectionId = connection.id;
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
       payload = EXCLUDED.payload, synced_at = now()
     -- Só grava se algo mudou (ADR-022). Esta é a tabela mais castigada do banco:
     -- 38 mil linhas para 1,13 milhão de updates, com 0,0% deles HOT — porque há
     -- índice de expressão sobre payload e parcial sobre status, e update que
     -- toca coluna indexada reescreve TODA entrada de índice da linha.
     -- A comparação de jsonb é semântica: ordem de chave diferente não conta como
     -- mudança, que é exatamente o que se quer de um payload reentregue igual.
     WHERE (workspace_marketplace_orders.status, workspace_marketplace_orders.occurred_at,
            workspace_marketplace_orders.payload)
       IS DISTINCT FROM (EXCLUDED.status, EXCLUDED.occurred_at, EXCLUDED.payload)`,
    [currentWorkspaceId(), PROVIDER, connectionId, JSON.stringify(records)]
  );
  // Gravação dupla durante a migração (docs/canonical-schema.md), best-effort:
  // uma falha aqui não pode derrubar o sync que já salvou na tabela atual.
  // O raw fica só na tabela legada; o frete entra depois, quando o shipment
  // sincroniza — o COALESCE do store preserva o valor já conhecido.
  await canonicalBestEffort("sync:orders", () => saveCanonicalOrders(
    { provider: PROVIDER, connectionId, storeRaw: false },
    orders.map((order) => normalizeMercadoLivreOrder(order, { sellerId: connection.externalAccountId }))
  ));
}

async function syncProducts(
  connection: IntegrationConnection,
  assertOwnership: (() => Promise<string>) | null = null
): Promise<void> {
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
         status = EXCLUDED.status, payload = EXCLUDED.payload, synced_at = now()
       WHERE (workspace_marketplace_products.status, workspace_marketplace_products.payload)
         IS DISTINCT FROM (EXCLUDED.status, EXCLUDED.payload)`,
      [currentWorkspaceId(), PROVIDER, connection.id, JSON.stringify(records)]
    );
    await canonicalBestEffort("sync:products", () => saveCanonicalProducts(
      { provider: PROVIDER, connectionId: connection.id, storeRaw: false },
      data.products.map(normalizeMercadoLivreProduct)
    ));
  }
  // Sob lease, o checkpoint do catálogo só avança se o worker ainda for o dono
  // — um worker vencido não pode adiar a próxima varredura de produtos.
  if (assertOwnership) {
    const token = await assertOwnership();
    const updated = await dbQuery(
      `UPDATE workspace_marketplace_syncs
          SET products_synced_at = now(), products_total = $4, active_products = $5,
              products_complete = $6, updated_at = now()
        WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
          AND lease_until::text = $7 AND lease_until > now()
        RETURNING connection_id`,
      [currentWorkspaceId(), PROVIDER, connection.id, data.total, data.activeTotal, data.complete, token]
    );
    if (!updated[0]) throw new MercadoLivreLeaseLostError("Lease do Mercado Livre perdido ao concluir o catálogo.");
    return;
  }
  await dbQuery(
    `UPDATE workspace_marketplace_syncs
        SET products_synced_at = now(), products_total = $4, active_products = $5,
            products_complete = $6, updated_at = now()
      WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3`,
    [currentWorkspaceId(), PROVIDER, connection.id, data.total, data.activeTotal, data.complete]
  );
}

async function syncMissingShipmentCosts(connection: IntegrationConnection): Promise<void> {
  const shipmentRows = await dbQuery<{ shipment_id: string; order_ids: string[] }>(
    `SELECT orders.payload #>> '{shipping,id}' AS shipment_id,
            array_agg(orders.external_order_id) AS order_ids
       FROM workspace_marketplace_orders orders
       LEFT JOIN workspace_marketplace_shipments shipments
         ON shipments.workspace_id = orders.workspace_id
        AND shipments.provider = orders.provider
        AND shipments.connection_id = orders.connection_id
        AND shipments.external_shipment_id = orders.payload #>> '{shipping,id}'
      WHERE orders.workspace_id = $1 AND orders.provider = $2 AND orders.connection_id = $3
        AND orders.status = 'paid' AND orders.payload #>> '{shipping,id}' IS NOT NULL
        AND shipments.external_shipment_id IS NULL
      GROUP BY shipment_id
      ORDER BY shipment_id DESC
      LIMIT $4`,
    [currentWorkspaceId(), PROVIDER, connection.id, SHIPMENT_BATCH_SIZE]
  );
  const orderIdsByShipment = new Map(shipmentRows.map((row) => [row.shipment_id, row.order_ids]));
  const shipmentIds = shipmentRows.map((row) => row.shipment_id);
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
         payload = EXCLUDED.payload, synced_at = now()
       WHERE workspace_marketplace_shipments.payload IS DISTINCT FROM EXCLUDED.payload`,
      [currentWorkspaceId(), PROVIDER, connection.id, JSON.stringify(records)]
    );
    await canonicalBestEffort("sync:shipments", () => applyCanonicalShipmentCosts(
      { provider: PROVIDER, connectionId: connection.id },
      records.map((record) => ({
        orderIds: orderIdsByShipment.get(record.external_shipment_id) ?? [],
        ...canonicalShipmentCosts(record.payload, connection.externalAccountId),
        providerFeeCode: "shipment_sender_cost",
        externalRef: record.external_shipment_id,
      }))
    ));
  }
}

export async function runMercadoLivreSyncStep(
  connection: IntegrationConnection,
  invalidateSnapshot = true,
  prepareSync = true
): Promise<MercadoLivreSyncStatus> {
  if (!hasDb()) return publicStatus();
  if (prepareSync) await requestMercadoLivreSync(connection.id);
  const workspaceId = currentWorkspaceId();
  const leased = await dbQuery<SyncRow & { ownership_token: string }>(
    `UPDATE workspace_marketplace_syncs
        SET lease_until = now() + interval '5 minutes', status = 'syncing', updated_at = now()
      WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
        AND status <> 'complete' AND (lease_until IS NULL OR lease_until < now())
      RETURNING status, target_from, target_to, covered_from, covered_to, cursor_from, cursor_to,
                cursor_offset, processed_orders, products_synced_at, products_total, active_products,
                products_complete, lease_until, last_error, last_success_at, updated_at,
                lease_until::text AS ownership_token`,
    [workspaceId, PROVIDER, connection.id]
  );
  const row = leased[0];
  if (!row) return publicStatus(await getSyncRow(connection.id), true);
  // Fencing igual ao TikTok/Shopee: o próprio lease_until é o token. Um worker
  // cujo lease venceu (e outro assumiu) falha aqui e não escreve por cima do
  // checkpoint do dono novo. O webhook não participa do lease — ele só empurra
  // covered_to/last_success_at, e isso segue fora da cerca de propósito.
  let ownershipToken = row.ownership_token;
  const assertOwnership = async (): Promise<string> => {
    const renewed = await dbQuery<{ ownership_token: string }>(
      `UPDATE workspace_marketplace_syncs
          SET lease_until = now() + interval '5 minutes', updated_at = now()
        WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
          AND lease_until::text = $4 AND lease_until > now()
        RETURNING lease_until::text AS ownership_token`,
      [workspaceId, PROVIDER, connection.id, ownershipToken]
    );
    if (!renewed[0]) throw new MercadoLivreLeaseLostError("Lease do Mercado Livre perdido; worker expirado não grava checkpoint.");
    ownershipToken = renewed[0].ownership_token;
    return ownershipToken;
  };

  try {
    const productsDue = !row.products_synced_at || Date.now() - new Date(row.products_synced_at).getTime() > 6 * 60 * 60_000;
    if (productsDue) await syncProducts(connection, assertOwnership);

    const from = new Date(row.cursor_from);
    const to = new Date(row.cursor_to);
    const offset = row.cursor_offset;
    const accountId = encodeURIComponent(connection.externalAccountId);
    const page = await mercadoLivreFetch<{ paging?: { total?: number }; results?: MercadoLivreOrder[] }>(
      connection,
      // sort=date_asc é ESTÁVEL para paginação por offset: pedidos novos entram no
      // fim (não deslocam o que já foi paginado). Com date_desc, ordens novas no
      // topo empurravam tudo pra baixo e ~1% caía no vão entre offsets, some do
      // canônico (validado contra a API do ML). Não reverter para date_desc.
      `/orders/search?seller=${accountId}&order.date_created.from=${encodeURIComponent(from.toISOString())}&order.date_created.to=${encodeURIComponent(to.toISOString())}&sort=date_asc&limit=${PAGE_SIZE}&offset=${offset}`
    );
    const orders = page.results ?? [];
    const total = page.paging?.total ?? orders.length;
    await assertOwnership();
    await saveOrders(connection, orders);

    const pageComplete = offset + orders.length >= total || orders.length < PAGE_SIZE;
    const targetFrom = new Date(row.target_from);
    await assertOwnership();
    if (!pageComplete) {
      await dbQuery(
        `UPDATE workspace_marketplace_syncs
            SET status = 'pending', cursor_offset = $4,
                processed_orders = processed_orders + $5, lease_until = NULL,
                last_error = NULL, last_success_at = now(), updated_at = now()
          WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
            AND lease_until::text = $6 AND lease_until > now()`,
        [workspaceId, PROVIDER, connection.id, offset + orders.length, orders.length, ownershipToken]
      );
    } else {
      const move = nextMercadoLivreOrderWindow({
        windowFromMs: from.getTime(),
        targetFromMs: targetFrom.getTime(),
        windowMs: WINDOW_DAYS * DAY,
      });
      if (move.kind === "complete") {
        await dbQuery(
          `UPDATE workspace_marketplace_syncs
              SET status = 'complete', covered_from = COALESCE(covered_from, target_from), covered_to = target_to,
                  processed_orders = processed_orders + $4, cursor_offset = 0,
                  lease_until = NULL, last_error = NULL, last_success_at = now(), updated_at = now()
            WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
              AND lease_until::text = $5 AND lease_until > now()`,
          [workspaceId, PROVIDER, connection.id, orders.length, ownershipToken]
        );
      } else {
        await dbQuery(
          `UPDATE workspace_marketplace_syncs
              SET status = 'pending', covered_from = $4,
                  covered_to = COALESCE(covered_to, target_to), cursor_from = $5, cursor_to = $6,
                  cursor_offset = 0, processed_orders = processed_orders + $7,
                  lease_until = NULL, last_error = NULL, last_success_at = now(), updated_at = now()
            WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
              AND lease_until::text = $8 AND lease_until > now()`,
          [workspaceId, PROVIDER, connection.id, from, new Date(move.nextFromMs), new Date(move.nextToMs), orders.length, ownershipToken]
        );
      }
    }
    // Frete é uma conciliação complementar. Processamos poucos registros por
    // passo, depois de salvar e avançar os pedidos, sem bloquear o faturamento.
    await syncMissingShipmentCosts(connection);
  } catch (error) {
    // O token cerca também a falha: worker que perdeu o lease não sobrescreve o
    // estado do dono novo com 'error' (o UPDATE simplesmente não casa).
    await dbQuery(
      `UPDATE workspace_marketplace_syncs
          SET status = 'error', lease_until = NULL, last_error = $4, updated_at = now()
        WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
          AND lease_until::text = $5`,
      [workspaceId, PROVIDER, connection.id, error instanceof Error ? error.message : "Falha ao sincronizar Mercado Livre.", ownershipToken]
    );
  }
  if (invalidateSnapshot) await invalidateMercadoLivreOverviewSnapshots(connection.id);
  return publicStatus(await getSyncRow(connection.id));
}

const REVERIFY_RETENTION_DAYS = 45; // cobre todos os períodos do dashboard (até 30d) + margem
const REVERIFY_WINDOW_DAYS = 5; // cada passagem re-verifica uma fatia de 5 dias

// Re-verificação automática do canônico. Re-busca uma fatia recente do histórico com
// sort=date_asc (chunk por dia p/ ficar sob o teto de offset do ML) e re-persiste. Cura
// gaps históricos — pedidos que sumiram do canônico antes do fix de paginação date_asc —
// sem nada manual. O cursor `reverify_to` corre para trás pela janela de retenção e volta
// ao topo, então toda conta conectada é continuamente reconferida sozinha pelo cron.
export async function reverifyMercadoLivreOrders(
  connection: IntegrationConnection
): Promise<{ from: string; to: string; orders: number }> {
  if (!hasDb()) return { from: "", to: "", orders: 0 };
  await ensureSyncRow(connection.id);
  const row = await getSyncRow(connection.id);
  const now = new Date();
  const retentionFloor = now.getTime() - REVERIFY_RETENTION_DAYS * DAY;
  // Onde a fatia termina: retoma do cursor salvo (limitado a agora) ou começa de agora.
  const savedTo = row?.reverify_to ? new Date(row.reverify_to).getTime() : now.getTime();
  const to = new Date(Math.min(savedTo, now.getTime()));
  const from = new Date(Math.max(retentionFloor, to.getTime() - REVERIFY_WINDOW_DAYS * DAY));

  const orders = await fetchOrdersWindow(connection, from, to);
  await saveOrders(connection, orders);

  // Avança o cursor para trás; ao cruzar o piso de retenção, reinicia do topo (agora).
  const nextTo = from.getTime() <= retentionFloor ? now : from;
  await dbQuery(
    `UPDATE workspace_marketplace_syncs
        SET reverify_to = $4, updated_at = now()
      WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3`,
    [currentWorkspaceId(), PROVIDER, connection.id, nextTo]
  );
  await invalidateMercadoLivreOverviewSnapshots(connection.id);
  return { from: from.toISOString(), to: to.toISOString(), orders: orders.length };
}

// Pagina [from, to] com date_asc, quebrando por dia — cada chunk fica bem abaixo do teto
// de offset do ML, então nenhuma janela densa estoura o limite. Dedup por id do pedido.
async function fetchOrdersWindow(
  connection: IntegrationConnection,
  from: Date,
  to: Date
): Promise<MercadoLivreOrder[]> {
  const accountId = encodeURIComponent(connection.externalAccountId);
  const collected = new Map<MercadoLivreOrder["id"], MercadoLivreOrder>();
  for (let start = from.getTime(); start < to.getTime(); start += DAY) {
    const chunkFrom = new Date(start);
    const chunkTo = new Date(Math.min(start + DAY, to.getTime()));
    let offset = 0;
    for (;;) {
      const page = await mercadoLivreFetch<{ paging?: { total?: number }; results?: MercadoLivreOrder[] }>(
        connection,
        `/orders/search?seller=${accountId}&order.date_created.from=${encodeURIComponent(chunkFrom.toISOString())}&order.date_created.to=${encodeURIComponent(chunkTo.toISOString())}&sort=date_asc&limit=${PAGE_SIZE}&offset=${offset}`
      );
      const results = page.results ?? [];
      for (const order of results) collected.set(order.id, order);
      const total = page.paging?.total ?? results.length;
      offset += PAGE_SIZE;
      if (results.length < PAGE_SIZE || offset >= total) break;
    }
  }
  return [...collected.values()];
}

export async function runMercadoLivreSyncBatch(
  connection: IntegrationConnection,
  maxSteps = 64
): Promise<MercadoLivreSyncStatus> {
  let status = await requestMercadoLivreSync(connection.id);
  for (let step = 0; step < maxSteps; step += 1) {
    if (status.status === "complete" || status.status === "error" || status.status === "unavailable") break;
    status = await runMercadoLivreSyncStep(connection, false, false);
    if (status.busy) break;
  }
  // Não apaga os snapshots a cada lote do histórico. Eles expiram sozinhos em
  // dois minutos e carregam o status atual da sincronização separadamente.
  // Webhooks, custos e sincronizações manuais continuam invalidando imediatamente.
  return status;
}

export async function loadMercadoLivreSource(
  connection: IntegrationConnection,
  period: MercadoLivrePeriod
): Promise<{ source: MercadoLivreOverviewSource | null; sync: MercadoLivreSyncStatus }> {
  if (!hasDb()) return { source: null, sync: publicStatus() };
  const row = await ensureSyncRow(connection.id);
  const coveredFrom = row?.covered_from ? new Date(row.covered_from).getTime() : Number.POSITIVE_INFINITY;
  const coveredTo = row?.covered_to ? new Date(row.covered_to).getTime() : 0;
  const periodCovered = coveredFrom <= period.from.getTime()
    && coveredTo + COVERAGE_TOLERANCE_MS >= period.to.getTime()
    && !!row?.products_synced_at;
  if (!row) return { source: null, sync: publicStatus(row) };

  const [orderRows, productRows] = await Promise.all([
    dbQuery<{ payload: MercadoLivreOrder }>(
      `SELECT payload FROM workspace_marketplace_orders
        WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
          AND occurred_at >= $4 AND occurred_at <= $5
        ORDER BY occurred_at DESC`,
      [currentWorkspaceId(), PROVIDER, connection.id, period.from, period.to]
    ),
    dbQuery<{ payload: MercadoLivreOverviewSource["productsData"]["products"][number] }>(
      `SELECT payload FROM workspace_marketplace_products
        WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
        ORDER BY synced_at DESC`,
      [currentWorkspaceId(), PROVIDER, connection.id]
    ),
  ]);
  if (!row.products_synced_at && !orderRows.length && !productRows.length) {
    return { source: null, sync: publicStatus(row) };
  }
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
    ordersComplete: periodCovered,
    shipmentCosts: new Map(shipmentRows.map((item) => [item.external_shipment_id, item.payload])),
  };
  return { source, sync: publicStatus(row) };
}
