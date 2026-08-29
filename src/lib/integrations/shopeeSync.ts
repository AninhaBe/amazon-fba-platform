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
  normalizeShopeeProducts,
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
  nextShopeeOrderWindow,
  validateShopeeCatalogSnapshot,
  validateShopeeOrderBatch,
  type ShopeeFailurePhase,
} from "./shopeeSyncControl";
import { withShopeeSyncWriteFence } from "./shopeeWriteFence";
import { inicioDoMesVigente } from "./inicioDoMes";

// Sync da Shopee — mesma máquina de estados do Mercado Livre (lease + cursor por
// janela), adaptada aos limites da API dela (docs/api-shopee.md):
//   - get_order_list aceita no máximo 15 dias por chamada → a janela do cursor
//     é de 15 dias e caminha para trás até cobrir o histórico;
//   - get_order_detail aceita no máximo 50 order_sn por chamada;
//   - o escrow (taxas reais) só existe depois do pagamento, então ele é uma
//     conciliação complementar: não bloqueia a ingestão do pedido.

const PROVIDER = "shopee";
const DAY = 86_400_000;
const WINDOW_DAYS = ORDER_WINDOW_DAYS; // teto da própria API
const FRESH_FOR_MS = 10 * 60_000;
/** Pedidos por passo que buscam escrow — mantém o passo curto no cron. */
const ESCROW_BATCH_SIZE = 20;

/**
 * Quanto tempo esperar antes de reperguntar o escrow do MESMO pedido.
 *
 * ⚠️ Sete dias é conservador de propósito, e o número vai poder ser escolhido
 * com dado em vez de prudência assim que `settlement_attempt_at` tiver histórico
 * — hoje ele está NULO em 20.162 de 20.162 pedidos, então ninguém sabe qual é a
 * janela real de liberação da Shopee. A distribuição que temos está contaminada:
 * pedido recente sem liquidação pode ser "a Shopee não liberou" ou "nunca
 * perguntamos", e sem a marca não dá para distinguir.
 */
const REPERGUNTA_APOS_DIAS = Number(process.env.SHOPEE_REPERGUNTA_ESCROW_DIAS || 7);
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
  if (!created) throw new Error("Não foi possível iniciar a sincronização da Shopee.");
  return created;
}

export async function ensureShopeeSyncState(connectionId: string): Promise<ShopeeSyncStatus> {
  if (!hasDb()) return publicStatus();
  return publicStatus(await ensureSyncRow(connectionId));
}

/**
 * Reabre a janela recente quando os dados já estão velhos.
 *
 * A reabertura é INCREMENTAL (espelho do requestMercadoLivreSync — correção de
 * 28/08/2026): o alvo estreita para o trecho ainda não coberto, com 1 dia de
 * sobreposição para mutação tardia. Sem estreitar target_from, a máquina de
 * janelas — que só completa quando o cursor alcança target_from — re-caminhava
 * a história INTEIRA a cada reabertura: loja com ~22k pedidos vivia em
 * 'pending' (a tela de primeira sync engolia o dashboard cheio) e
 * processed_orders somava a loja inteira por passada. covered_from segue
 * preservado pelo LEAST do fechamento de janela, então a cobertura exibida não
 * encolhe.
 */
export async function requestShopeeSync(connectionId: string): Promise<ShopeeSyncStatus> {
  const row = await ensureSyncRow(connectionId);
  const lastSuccess = row.last_success_at ? new Date(row.last_success_at).getTime() : 0;
  if (row.status === "complete" && Date.now() - lastSuccess > FRESH_FOR_MS) {
    const now = new Date();
    const coveredTo = row.covered_to ? new Date(row.covered_to) : new Date(row.target_to);
    // Nunca ALARGA o alvo: se a cobertura recua além do target_from original,
    // o original prevalece.
    const targetFrom = new Date(Math.max(new Date(row.target_from).getTime(), coveredTo.getTime() - DAY));
    const cursorFrom = new Date(Math.max(targetFrom.getTime(), now.getTime() - WINDOW_DAYS * DAY));
    await dbQuery(
      `UPDATE workspace_marketplace_syncs
          SET status = 'pending', target_from = $6, target_to = $4, cursor_from = $5, cursor_to = $4, updated_at = now()
        WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3`,
      [currentWorkspaceId(), PROVIDER, connectionId, now, cursorFrom, targetFrom]
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
      // UMA LINHA POR VARIACAO (ADR-029): anuncio com `has_model` vira N linhas,
      // anuncio simples continua sendo uma. `push(...)` porque o normalizador
      // agora devolve lista.
      normalized.push(...normalizeShopeeProducts(product, input.modelsByItem?.get(String(product.item_id))));
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
 * Marca que PERGUNTAMOS, com o desfecho. Escrita própria, fora da transação da
 * liquidação: ela precisa sobreviver mesmo quando a liquidação não acontece —
 * é justamente o caso "perguntamos e não havia" que hoje some.
 */
async function marcarTentativaDeEscrow(
  connectionId: string,
  externalOrderId: string,
  desfecho: string
): Promise<void> {
  await dbQuery(
    `UPDATE workspace_channel_orders
        -- clock_timestamp() e nao now(): mesma forma que o TikTok ja usa, e
        -- e o relogio real da tentativa, nao o inicio da transacao. Esta escrita
        -- muda a linha SEMPRE, de proposito — o carimbo E o dado. Por isso ela
        -- esta na lista de UPDATE direto permitido da ADR-022, ao lado da do
        -- TikTok, em vez de ganhar um guard de "nao regrave o igual".
        SET settlement_attempt_at = clock_timestamp(), settlement_outcome = $5
      WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
        AND external_order_id = $4`,
    [currentWorkspaceId(), PROVIDER, connectionId, externalOrderId, desfecho]
  );
}

/**
 * O detalhe do pedido que já está gravado, quando ele serve.
 *
 * Só vale se for mesmo um detalhe — `item_list` é o que distingue a resposta de
 * `get_order_detail` da linha resumida. Sem essa checagem a gente trocaria uma
 * chamada a mais por um dado a menos, que é o pior dos dois.
 */
function detalheGuardado(raw: unknown): ShopeeOrderDetail | null {
  if (!raw || typeof raw !== "object") return null;
  const candidato = raw as { item_list?: unknown; order_sn?: unknown };
  if (!Array.isArray(candidato.item_list) || candidato.item_list.length === 0) return null;
  if (typeof candidato.order_sn !== "string") return null;
  return candidato as unknown as ShopeeOrderDetail;
}

/**
 * Conciliação do escrow: pedidos com receita mas ainda sem tarifa gravada.
 * Roda depois dos pedidos, em lotes pequenos — a tarifa chega atrasada por
 * natureza (só fecha após o pagamento) e não pode travar o faturamento.
 */
async function syncMissingEscrow(
  connection: IntegrationConnection,
  assertOwnership: () => Promise<string>
): Promise<{ attempted: number; failed: number; nextOffset: number }> {
  // Liquidação agora vive em coluna (ADR-026 R2); o fallback ao raw cobre as
  // linhas antigas até o backfill concluir e o namespace `_sellercore` morrer.
  const NAO_LIQUIDADO = `NOT (o.financial_settled
        OR COALESCE((o.raw #>> '{_sellercore,shopeeEscrowSettled}')::boolean, false))`;
  const [countRow] = await dbQuery<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM workspace_channel_orders o
      WHERE o.workspace_id=$1 AND o.provider=$2 AND o.connection_id=$3
        AND o.status IN ('paid','shipped','delivered')
        AND ${NAO_LIQUIDADO}`,
    [currentWorkspaceId(), PROVIDER, connection.id]
  );
  const total = countRow?.total ?? 0;
  if (!total) return { attempted: 0, failed: 0, nextOffset: 0 };
  // ⚠️ SEM OFFSET, e essa é a correção principal (29/08/2026).
  //
  // O cursor era uma POSIÇÃO numa lista FILTRADA que ENCOLHE conforme os
  // pedidos liquidam. Duas consequências, e a segunda é a grave:
  //   · repetia — ao dar a volta (`cursorOffset % total`), reperguntava os
  //     mesmos pedidos, para sempre, inclusive os que a Shopee ainda não tem
  //     como liquidar;
  //   · PULAVA — quando a lista encolhe embaixo do offset, o pedido que estava
  //     naquela posição nunca chega a ser perguntado. Buraco no dado financeiro
  //     dela, e SILENCIOSO: pedido nunca perguntado não aparece como faltando.
  //
  // A ordenação por `settlement_attempt_at` (NULLS FIRST) se sustenta sozinha:
  // quem nunca foi perguntado vem primeiro, depois quem foi perguntado há mais
  // tempo. Não há posição para pular nem volta para repetir — a estrutura que
  // produzia os dois defeitos deixou de existir.
  const pending = await dbQuery<{ external_order_id: string; raw: unknown }>(
    `SELECT o.external_order_id, o.raw
       FROM workspace_channel_orders o
      WHERE o.workspace_id = $1 AND o.provider = $2 AND o.connection_id = $3
        AND o.status IN ('paid', 'shipped', 'delivered')
        AND ${NAO_LIQUIDADO}
        -- Não repergunta o mesmo pedido antes do intervalo: sem isto, pedido
        -- que a Shopee nunca vai liquidar volta à fila em toda passagem.
        AND (o.settlement_attempt_at IS NULL
             OR o.settlement_attempt_at < now() - interval '${REPERGUNTA_APOS_DIAS} days')
      ORDER BY o.settlement_attempt_at ASC NULLS FIRST, o.occurred_at, o.external_order_id
      LIMIT $4`,
    [currentWorkspaceId(), PROVIDER, connection.id, ESCROW_BATCH_SIZE]
  );

  let failed = 0;
  for (const row of pending) {
    // ⚠️ TODA TENTATIVA DEIXA MARCA, inclusive a que volta vazia.
    //
    // Sem a marca não existe diferença entre "a Shopee não tem escrow deste
    // pedido" e "nunca perguntamos" — e o sistema lê ausência de marca como
    // ausência de fato, escolhendo sempre a interpretação errada. Foi o mesmo
    // defeito do zero fabricado e do evento com zero tentativas, três vezes no
    // mesmo dia, em lugares que não se conhecem.
    //
    // O carimbo vem ANTES da chamada, e é de propósito: se ela falhar no meio,
    // a marca tem que existir mesmo assim, senão o pedido volta à fila na
    // passagem seguinte e a repetição continua.
    await marcarTentativaDeEscrow(connection.id, row.external_order_id, "tentado");
    try {
      const escrow = (await fencedShopeeExternalRead(
        assertOwnership,
        () => getShopeeEscrowDetail(connection, row.external_order_id)
      )) as ShopeeEscrowDetail;
      if (!escrow?.order_income) {
        // Fato registrado, não silêncio: a Shopee respondeu e não havia escrow.
        await marcarTentativaDeEscrow(connection.id, row.external_order_id, "sem_escrow");
        continue;
      }
      // O detalhe do pedido JÁ ESTÁ no banco na maioria dos casos — foi ele que
      // criou a linha. Buscar de novo era metade das chamadas deste passo, e a
      // pergunta cuja resposta a gente já tinha.
      const guardado = detalheGuardado(row.raw);
      const order = guardado ?? ((await fencedShopeeExternalRead(
        assertOwnership,
        () => getShopeeOrderDetail(connection, [row.external_order_id])
      )).order_list as ShopeeOrderDetail[] | undefined)?.[0];
      if (!order) {
        await marcarTentativaDeEscrow(connection.id, row.external_order_id, "sem_detalhe");
        continue;
      }
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
          // Conclusão do produto em COLUNAS (ADR-026 R2): o raw fica imutável,
          // só com o que a Shopee mandou — nada de `_sellercore` novo.
          await query(
            `UPDATE workspace_channel_orders
                SET financial_settled = true,
                    evidence_fees = $5, evidence_seller_shipping = $6, evidence_ads = $7,
                    evidence_taxes_withheld = $8, evidence_refunds = $9,
                    synced_at = now()
              WHERE workspace_id=$1 AND provider=$2 AND connection_id=$3 AND external_order_id=$4
                -- ADR-022: não regrava linha que já está idêntica.
                AND (financial_settled, evidence_fees, evidence_seller_shipping,
                     evidence_ads, evidence_taxes_withheld, evidence_refunds)
                    IS DISTINCT FROM (true, $5, $6, $7, $8, $9)`,
            [currentWorkspaceId(), PROVIDER, connection.id, row.external_order_id,
              ["commission_fee", "service_fee", "seller_transaction_fee"].every((field) => Object.hasOwn(escrow.order_income!, field)),
              ["actual_shipping_fee", "reverse_shipping_fee"].every((field) => Object.hasOwn(escrow.order_income!, field)),
              ["campaign_fee", "order_ams_commission_fee"].every((field) => Object.hasOwn(escrow.order_income!, field)),
              ["escrow_tax", "final_escrow_product_gst"].every((field) => Object.hasOwn(escrow.order_income!, field)),
              Object.hasOwn(escrow.order_income!, "seller_return_refund"),
            ],
          );
        },
      );
      if (!fenced.owned) throw new ShopeeLeaseLostError("Lease Shopee perdido antes de persistir escrow.");
      await marcarTentativaDeEscrow(connection.id, row.external_order_id, "liquidado");
    } catch (error) {
      if (error instanceof ShopeeLeaseLostError) throw error;
      // Escrow indisponível para este pedido (ainda não pago, ou erro pontual).
      // A marca da tentativa já foi gravada antes da chamada, então ele espera o
      // intervalo em vez de voltar à fila na passagem seguinte.
      await marcarTentativaDeEscrow(connection.id, row.external_order_id, "falhou").catch(() => {});
      failed++;
    }
  }
  // `nextOffset` continua no contrato por compatibilidade com o chamador, mas
  // não significa mais posição: a fila se ordena sozinha por quem foi
  // perguntado há mais tempo. Ver o comentário do SELECT acima.
  return { attempted: pending.length, failed, nextOffset: 0 };
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
      windowMs: WINDOW_DAYS * DAY,
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
    } else {
      // LEAST: covered_from guarda o ponto mais antigo JÁ coberto. Sem isso, o
      // re-walk pós-reopen (que re-caminha as janelas do presente ao alvo)
      // ENCOLHIA a cobertura para a janela recém-fechada — e a tela dizia que o
      // histórico começava ontem numa loja com o mês inteiro capturado. Mesmo
      // desenho do tiktokSync.
      await dbQuery(
        `UPDATE workspace_marketplace_syncs
            SET status = 'pending', covered_from = LEAST(COALESCE(covered_from, $4), $4),
                covered_to = COALESCE(covered_to, target_to),
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
    // Sem `cursorOffset`: a fila do escrow se ordena sozinha por quem nunca foi
    // perguntado. O campo continua sendo gravado como 0 para não mudar o schema
    // nesta frente — ele deixou de ter significado, não de existir.
    const escrow = await syncMissingEscrow(connection, assertOwnership);
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
