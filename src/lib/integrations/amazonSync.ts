import { dbQuery, hasDb } from "../db";
import { currentWorkspaceId } from "../workspaceScope";
import { runWithAccount, type AccountCtx } from "../accountContext";
import { getOrder, getOrders, getOrderItems } from "../orders";
import { getOrderFinancialsFromTransactions } from "../transactions";
import { SpApiError } from "../spapi";
import { periodFromRange } from "../period";
import {
  normalizeAmazonOrderHeader,
  normalizeAmazonOrderItems,
} from "./amazonCanonical";
import type { CanonicalFee } from "./canonical";
import { ingerirRelatorioDePedidos } from "./amazonOrdersReport";
import {
  applyCanonicalOrderItems,
  saveCanonicalOrderHeaders,
  upsertCanonicalOrderFees,
  type OrderItemsApplication,
} from "./canonicalStore";
import { AmazonLeaseLostError, nextAmazonOrderWindow } from "./amazonSyncControl";
import { inicioDoMesVigente } from "./inicioDoMes";

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
const WINDOW_DAYS = 7;
const PAGE_SIZE = 100;
// 20 → 40 em 20/08: com 930 pedidos sem itens na conta grande, 20/passo dava
// ~320/h e a conciliação levaria o dia. O teto real é o rate limit da
// getOrderItems (0,5 req/s, burst 30) — 40 por passo continua com folga porque
// os passos se espaçam pelo cron.
const ITEM_BATCH_SIZE = 40;
// Uma única chamada à Transactions API cobre a janela inteira, então dá para
// reconciliar muitos pedidos por passada.
const FEES_BATCH_SIZE = 500;
// Fees só ficam disponíveis após a liquidação; a janela cobre o que os painéis
// mostram (≤30 dias) com folga. Histórico mais antigo não é reconciliado.
const FEES_WINDOW_DAYS = 45;
// Quanto tempo uma conexão `complete` fica sem abrir janela nova.
//
// Era 6 HORAS. Com o agendador interno rodando a cada 5 minutos, isso significava
// que 71 de cada 72 execuções não buscavam pedido nenhum — só reconciliavam itens.
// Na prática o painel podia mostrar dado de horas atrás sem qualquer aviso, e foi
// exatamente o que aconteceu em 21/08/2026: último pedido ingerido às 16:05 com a
// tela aberta às 22:15.
//
// 2 minutos cabe no limite da SP-API: `getOrders` permite ~1 req/min
// por conta (burst 20), e cada conexao abre janela ~30x/hora — dentro do teto,
// mas ESTIMADO, nao medido: o sinal de excesso e 429 no log do sync. O piso de 5 min da rota do dashboard continua valendo
// para o caminho sob demanda — quem abre a tela dez vezes não gera dez varreduras.
const FRESH_FOR_MS = 2 * 60_000;
// A SP-API exige CreatedBefore com pelo menos 2 minutos de idade; 3 dá folga.
const CREATED_BEFORE_LAG_MS = 3 * 60_000;

function syncHorizon(): Date {
  return new Date(Date.now() - CREATED_BEFORE_LAG_MS);
}

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
  const now = syncHorizon();
  // Conta nova importa o MÊS VIGENTE (decisão da Ana, 27/08/2026): quem conecta
  // no dia 17 vê os 17 dias do mês; dali em diante o histórico cresce para
  // frente. Sem aprofundamento retroativo em background. Conta antiga não é
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
  if (!created) throw new Error("Não foi possível iniciar a sincronização da Amazon.");
  return created;
}

/**
 * Garante a linha de estado da sincronização — chamado pelo callback OAuth para
 * a conta recém-conectada já nascer candidata do agendador, mesmo que o kick
 * imediato morra antes de rodar.
 */
export async function ensureAmazonSyncState(connectionId: string): Promise<void> {
  if (!hasDb()) return;
  await ensureSyncRow(connectionId);
}

/**
 * Abre janela nova quando a atual já ficou velha.
 *
 * `forcar` existe para a busca sob demanda da tela (ADR-017 / rota do dashboard):
 * sem ele, `FRESH_FOR_MS` de 6 HORAS recusa abrir janela e o sync só reconcilia
 * itens — ou seja, **nunca traz pedido novo**. Foi o que fez o painel do sócio
 * ficar preso às 16:05 com vendas até as 20:38 (medido em 21/08/2026), e o que
 * fez a primeira tentativa de conserto não mudar nada: eu havia contornado só a
 * trava do agendador, e esta aqui continuava barrando um nível abaixo.
 *
 * Quem chama com `forcar` é responsável por limitar a frequência — a rota do
 * dashboard usa piso de 5 minutos, para abrir a tela dez vezes não virar dez
 * varreduras na SP-API.
 */
async function requestAmazonSync(connectionId: string, forcar = false): Promise<SyncRow> {
  const row = await ensureSyncRow(connectionId);
  const lastSuccess = row.last_success_at ? new Date(row.last_success_at).getTime() : 0;
  if (row.status === "complete" && (forcar || Date.now() - lastSuccess > FRESH_FOR_MS)) {
    const now = syncHorizon();
    const coveredTo = row.covered_to ? new Date(row.covered_to) : new Date(row.target_to);
    // A reabertura não é dona de lease nenhum: só pode mexer no cursor se
    // nenhum worker ativo estiver segurando a linha — senão sobrescreveria o
    // checkpoint de quem está trabalhando.
    await dbQuery(
      `UPDATE workspace_marketplace_syncs
          SET status = 'pending', target_from = $5, target_to = $4, cursor_from = $5, cursor_to = $4,
              cursor_token = NULL, cursor_offset = 0, last_error = NULL, updated_at = now()
        WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
          AND (lease_until IS NULL OR lease_until < now())`,
      [currentWorkspaceId(), PROVIDER, connectionId, now, coveredTo]
    );
  }
  return (await getSyncRow(connectionId))!;
}

/**
 * A DESISTÊNCIA DEIXA RASTRO — e é só isso que esta função faz.
 *
 * ⚠️ Os três `catch` deste arquivo engoliam o erro em silêncio. Medido em
 * produção em 29/08/2026: `/finances/2024-06-19/transactions` recusa **~20% das
 * chamadas** (62, 57 e 64 erros em três horas seguidas), todas 429, e o log da
 * SP-API mostra a mesma chamada indo a `tentativa: 4` — como `maxRetries = 3`,
 * a quarta não retenta, ela lança. O `catch` então abandonava o lote inteiro de
 * tarifas sem uma linha em lugar nenhum.
 *
 * O resultado disso está no banco: **22.347 pedidos da Amazon, 22.347 sem
 * carimbo de tentativa, 0 liquidados** — a mesma armadilha que matou o escrow
 * da Shopee em silêncio depois de meses funcionando.
 *
 * ⚠️ ISTO NÃO MUDA COMPORTAMENTO. Não muda quando chama, nem quantas vezes, nem
 * o que grava: o `return`/`break` de cada chamador continua exatamente onde
 * estava. Só torna visível um erro que hoje some. O carimbo de tentativa por
 * pedido — a correção de verdade — é desenho, e está no ADR da conciliação como
 * passo próprio; enquanto ele não sai, cada erro engolido aqui é dado
 * financeiro dela sumindo sem rastro.
 *
 * `amazonRequestId` vai junto de propósito: é o que a Amazon pede para abrir
 * caso no suporte, e sem ele a recusa é irrespondível.
 *
 * Exportada para o teste: o valor dela É o que ela escreve, então o teste tem
 * que ler a linha, e não confiar que ela existe.
 */
export function registrarDesistencia(etapa: string, erro: unknown, contexto: Record<string, unknown>): void {
  const spapi = erro instanceof SpApiError ? erro : null;
  console.warn("[amazon-sync] etapa abandonada", {
    etapa,
    motivo: spapi?.code ?? (erro instanceof Error ? erro.name : "DESCONHECIDO"),
    status: spapi?.status ?? null,
    endpoint: spapi?.endpoint ?? null,
    amazonRequestId: spapi?.amazonRequestId ?? null,
    detalhe: erro instanceof Error ? erro.message : String(erro),
    ...contexto,
  });
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
    } catch (erro) {
      // Rate limit ou pedido indisponível: a próxima passada tenta de novo.
      registrarDesistencia("itens-do-pedido", erro, {
        connectionId,
        pedido: row.external_order_id,
        pedidosNoLote: rows.length,
        conciliadosAntesDeParar: applications.length,
      });
      break;
    }
  }
  await applyCanonicalOrderItems({ provider: PROVIDER, connectionId }, applications);
}

// Conciliação de fees pela Transactions API. A Finances v0 retorna valores
// zerados nesta conta (por isso o dashboard já usa a Transactions API), então a
// ingestão canônica também precisa dela. Como a Transactions é por período, uma
// chamada cobre a janela toda: buscamos os totais por pedido de uma janela
// recente e gravamos comissão (total de tarifas) e estorno por pedido.
async function syncMissingOrderFees(connectionId: string): Promise<void> {
  const rows = await dbQuery<{ external_order_id: string; occurred_at: Date | string; currency: string }>(
    `SELECT o.external_order_id, o.occurred_at, o.currency FROM workspace_channel_orders o
      WHERE o.workspace_id = $1 AND o.provider = $2 AND o.connection_id = $3
        AND o.status IN ('paid', 'shipped', 'delivered')
        AND o.occurred_at < now() - interval '2 days'
        AND o.occurred_at >= now() - ($4 || ' days')::interval
        AND NOT EXISTS (
          SELECT 1 FROM workspace_channel_order_fees f
           WHERE f.workspace_id = o.workspace_id AND f.provider = o.provider
             AND f.connection_id = o.connection_id AND f.external_order_id = o.external_order_id
             AND f.fee_type = 'commission'
        )
      ORDER BY o.occurred_at DESC
      LIMIT $5`,
    [currentWorkspaceId(), PROVIDER, connectionId, FEES_WINDOW_DAYS, FEES_BATCH_SIZE]
  );
  if (!rows.length) return;

  // Janela dinâmica: do pedido mais antigo do lote (já ordenado desc) até agora.
  // Pequena no regime permanente, larga só durante o backfill.
  const ymd = (date: Date) => new Date(date.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
  const oldest = new Date(rows[rows.length - 1].occurred_at);
  let financials: Record<string, { fees: number; refunds: number; currency: string }>;
  try {
    financials = await getOrderFinancialsFromTransactions(periodFromRange(ymd(oldest), ymd(new Date())));
  } catch (erro) {
    // Rate limit / indisponibilidade: tenta na próxima passada.
    //
    // ⚠️ ESTE é o que sangra dado financeiro: o lote inteiro fica sem tarifa, e
    // "a próxima passada" bate no mesmo 429. É a causa medida da cobertura de
    // 27% da Amazon.
    registrarDesistencia("tarifas-pela-transactions", erro, {
      connectionId,
      pedidosSemTarifa: rows.length,
      janelaDe: ymd(oldest),
      janelaAte: ymd(new Date()),
    });
    return;
  }

  const applications: Array<{ externalOrderId: string; fees: CanonicalFee[] }> = [];
  for (const row of rows) {
    const fin = financials[row.external_order_id];
    // Sem transação no período = ainda não liquidado; fica para a próxima passada.
    if (!fin) continue;
    const currency = fin.currency || row.currency || "BRL";
    const fees: CanonicalFee[] = [];
    if (fin.fees > 0) fees.push({ feeType: "commission", providerFeeCode: "transactions_total", amount: fin.fees, currency });
    if (fin.refunds > 0) fees.push({ feeType: "refund", providerFeeCode: "transactions_refund", amount: fin.refunds, currency });
    if (fees.length) applications.push({ externalOrderId: row.external_order_id, fees });
  }
  if (applications.length) await upsertCanonicalOrderFees({ provider: PROVIDER, connectionId }, applications);
}

// Quantas páginas de reverificação por passada. Uma página = 100 pedidos; na
// conta pequena sobra, na grande o cron de 15 min alcança o ritmo sem estourar
// o rate limit da Orders API.
const REVERIFY_PAGES = 2;
// Reverificação PONTUAL: quantos pedidos pendentes reconferir por ID a cada
// passada. O rate limit do getOrder é 0,5 req/s com burst 30 — 40 por passada,
// com o cron a cada 5 min, dá ~480/hora e alcança conta de 60 pedidos/dia.
const PENDING_BY_ID_BATCH = 40;

/**
 * Revisita pedidos que MUDARAM na Amazon depois de ingeridos — o buraco que
 * deixou 16 de 17 pedidos eternamente "pending" e sem itens (20/08/2026).
 *
 * O backfill varre por data de CRIAÇÃO e nunca relê: pedido visto como Pending
 * ficava Pending para sempre, e o backfill de itens pula pendentes (correto —
 * a API não entrega itens de pedido pendente). Esta passada usa LastUpdatedAfter
 * para pegar as transições (Pending → Shipped) e regravar os cabeçalhos; os
 * itens entram na mesma passada, via syncMissingOrderItems.
 *
 * A janela é derivada do que precisa de cura: começa no pedido `pending` mais
 * antigo (limitado a 30 dias), ou 48h quando não há pendência — assim ela se
 * auto-corrige depois de qualquer buraco de cron, sem precisar de coluna nova.
 */
/**
 * Reconfere por ID os pedidos `pending` MAIS RECENTES.
 *
 * A varredura por `LastUpdatedAfter` (abaixo) é boa para descobrir mudança que
 * não sabíamos existir, mas ela devolve as páginas do mais antigo para o mais
 * novo: numa conta de 60 pedidos/dia o teto de 2 páginas se esgota em pedido
 * velho e os de hoje nunca chegam. Em 21/08/2026 isso deixou **55 dos 62
 * pedidos do dia anterior presos em `Pending`**, e o dashboard mostrou "2
 * vendas" num dia de 62 — parecendo queda de vendas quando era lag de ingestão.
 *
 * Aqui a ordem é invertida de propósito: os mais NOVOS primeiro, um a um.
 */
async function reverifyPendingById(connectionId: string): Promise<void> {
  const rows = await dbQuery<{ external_order_id: string }>(
    `SELECT external_order_id FROM workspace_channel_orders
      WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
        AND status = 'pending'
        AND occurred_at >= now() - interval '30 days'
      ORDER BY occurred_at DESC
      LIMIT $4`,
    [currentWorkspaceId(), PROVIDER, connectionId, PENDING_BY_ID_BATCH]
  );
  const atualizados = [];
  for (const row of rows) {
    try {
      const pedido = await getOrder(row.external_order_id);
      if (pedido) atualizados.push(normalizeAmazonOrderHeader(pedido));
    } catch (erro) {
      // Rate limit ou pedido indisponível: para o lote e tenta na próxima
      // passada. Insistir aqui só queima cota.
      registrarDesistencia("reverificacao-de-pedido", erro, {
        connectionId,
        pedido: row.external_order_id,
        pedidosNoLote: rows.length,
        reverificadosAntesDeParar: atualizados.length,
      });
      break;
    }
  }
  if (atualizados.length) {
    await saveCanonicalOrderHeaders({ provider: PROVIDER, connectionId, storeRaw: true }, atualizados);
  }
}

async function reverifyUpdatedOrders(connectionId: string): Promise<void> {
  const [row] = await dbQuery<{ oldest_pending: Date | string | null }>(
    `SELECT MIN(occurred_at) AS oldest_pending
       FROM workspace_channel_orders
      WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
        AND status = 'pending'
        AND occurred_at >= now() - interval '30 days'`,
    [currentWorkspaceId(), PROVIDER, connectionId]
  );
  const fallback = Date.now() - 48 * 3_600_000;
  const oldest = row?.oldest_pending ? new Date(row.oldest_pending).getTime() - 3_600_000 : fallback;
  const since = new Date(Math.min(oldest, fallback));

  let nextToken: string | undefined;
  for (let page = 0; page < REVERIFY_PAGES; page++) {
    const result = await getOrders({
      lastUpdatedAfter: since.toISOString(),
      maxResults: PAGE_SIZE,
      nextToken,
    });
    if (result.orders.length) {
      await saveCanonicalOrderHeaders(
        { provider: PROVIDER, connectionId, storeRaw: true },
        result.orders.map(normalizeAmazonOrderHeader)
      );
    }
    nextToken = result.nextToken;
    if (!nextToken) break;
  }
}

export async function runAmazonSyncStep(account: AccountCtx, forcarJanela = false): Promise<void> {
  if (!hasDb()) return;
  const connectionId = amazonConnectionId(account.sellerId);
  await requestAmazonSync(connectionId, forcarJanela);
  const workspaceId = currentWorkspaceId();
  const leased = await dbQuery<SyncRow & { ownership_token: string }>(
    `UPDATE workspace_marketplace_syncs
        SET lease_until = now() + interval '5 minutes', status = 'syncing', updated_at = now()
      WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
        AND status <> 'complete' AND (lease_until IS NULL OR lease_until < now())
      RETURNING ${SYNC_COLUMNS}, lease_until::text AS ownership_token`,
    [workspaceId, PROVIDER, connectionId]
  );
  const row = leased[0];
  if (!row) {
    // Sem trabalho de janela (completo ou outro processo na frente): as
    // conciliações de itens e fees ainda podem avançar.
    await runWithAccount(account, async () => {
      // Reverificação antes dos itens: o pedido precisa sair de `pending` para o
      // backfill de itens enxergá-lo. Best-effort — rate limit fica para a próxima.
      // Pontual primeiro (alcança os recentes), varredura depois (descobre o resto).
      await reverifyPendingById(connectionId).catch(() => {});
      await reverifyUpdatedOrders(connectionId).catch(() => {});
      await syncMissingOrderItems(connectionId);
      await syncMissingOrderFees(connectionId);
      // Captura o valor de tabela enquanto o pedido ainda tem um: a Amazon zera
      // o cancelado em toda API de pedido, então depois não há de onde tirar.
      // Ele mesmo se espaça (3h) — chamar todo ciclo não gera relatório todo ciclo.
      await ingerirRelatorioDePedidos(connectionId).catch((erro) => {
        console.error("[amazon] relatório de pedidos falhou", erro);
      });
    });
    return;
  }

  // Fencing igual aos outros três canais: o próprio lease_until é o token. Um
  // worker cujo lease venceu (e outro assumiu) falha aqui e não escreve por
  // cima do checkpoint do dono novo.
  let ownershipToken = row.ownership_token;
  const assertOwnership = async (): Promise<string> => {
    const renewed = await dbQuery<{ ownership_token: string }>(
      `UPDATE workspace_marketplace_syncs
          SET lease_until = now() + interval '5 minutes', updated_at = now()
        WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
          AND lease_until::text = $4 AND lease_until > now()
        RETURNING lease_until::text AS ownership_token`,
      [workspaceId, PROVIDER, connectionId, ownershipToken]
    );
    if (!renewed[0]) throw new AmazonLeaseLostError("Lease da Amazon perdido; worker expirado não grava checkpoint.");
    ownershipToken = renewed[0].ownership_token;
    return ownershipToken;
  };

  try {
    const from = new Date(row.cursor_from);
    const to = new Date(row.cursor_to);
    const page = await runWithAccount(account, () => getOrders({
      createdAfter: from.toISOString(),
      createdBefore: to.toISOString(),
      maxResults: PAGE_SIZE,
      nextToken: row.cursor_token ?? undefined,
    }));
    await assertOwnership();
    await saveCanonicalOrderHeaders(
      { provider: PROVIDER, connectionId, storeRaw: true },
      page.orders.map(normalizeAmazonOrderHeader)
    );

    const targetFrom = new Date(row.target_from);
    await assertOwnership();
    if (page.nextToken) {
      await dbQuery(
        `UPDATE workspace_marketplace_syncs
            SET status = 'pending', cursor_token = $4, processed_orders = processed_orders + $5,
                lease_until = NULL, last_error = NULL, last_success_at = now(), updated_at = now()
          WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
            AND lease_until::text = $6 AND lease_until > now()`,
        [workspaceId, PROVIDER, connectionId, page.nextToken, page.orders.length, ownershipToken]
      );
    } else {
      const move = nextAmazonOrderWindow({
        windowFromMs: from.getTime(),
        targetFromMs: targetFrom.getTime(),
        windowMs: WINDOW_DAYS * DAY,
      });
      if (move.kind === "complete") {
        await dbQuery(
          `UPDATE workspace_marketplace_syncs
              SET status = 'complete', covered_from = COALESCE(covered_from, target_from), covered_to = target_to,
                  processed_orders = processed_orders + $4, cursor_token = NULL,
                  lease_until = NULL, last_error = NULL, last_success_at = now(), updated_at = now()
            WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
              AND lease_until::text = $5 AND lease_until > now()`,
          [workspaceId, PROVIDER, connectionId, page.orders.length, ownershipToken]
        );
      } else {
        // LEAST: covered_from guarda o ponto mais antigo JÁ coberto — o
        // re-walk pós-reopen não pode encolher a cobertura para a janela
        // recém-fechada. Mesmo desenho do tiktokSync.
        await dbQuery(
          `UPDATE workspace_marketplace_syncs
              SET status = 'pending', covered_from = LEAST(COALESCE(covered_from, $4), $4),
                  covered_to = COALESCE(covered_to, target_to),
                  cursor_from = $5, cursor_to = $6, cursor_token = NULL,
                  processed_orders = processed_orders + $7,
                  lease_until = NULL, last_error = NULL, last_success_at = now(), updated_at = now()
            WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
              AND lease_until::text = $8 AND lease_until > now()`,
          [workspaceId, PROVIDER, connectionId, from, new Date(move.nextFromMs), new Date(move.nextToMs), page.orders.length, ownershipToken]
        );
      }
    }
    await runWithAccount(account, async () => {
      // Pontual primeiro (alcança os recentes), varredura depois (descobre o resto).
      await reverifyPendingById(connectionId).catch(() => {});
      await reverifyUpdatedOrders(connectionId).catch(() => {});
      await syncMissingOrderItems(connectionId);
      await syncMissingOrderFees(connectionId);
    });
  } catch (error) {
    // O token cerca também a falha: worker que perdeu o lease não sobrescreve o
    // estado do dono novo com 'error' (o UPDATE simplesmente não casa).
    await dbQuery(
      `UPDATE workspace_marketplace_syncs
          SET status = 'error', lease_until = NULL, last_error = $4, updated_at = now()
        WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
          AND lease_until::text = $5`,
      [workspaceId, PROVIDER, connectionId, error instanceof Error ? error.message : "Falha ao sincronizar Amazon.", ownershipToken]
    );
  }
}

export async function runAmazonSyncBatch(account: AccountCtx, maxSteps = 4, forcarJanela = false): Promise<void> {
  if (!hasDb()) return;
  for (let step = 0; step < maxSteps; step += 1) {
    const row = await getSyncRow(amazonConnectionId(account.sellerId));
    if (row && (row.status === "complete" || row.status === "error")) {
      // Com `forcarJanela`, o primeiro passo ABRE janela nova em vez de apenas
      // conciliar itens — é o que traz pedido recente. Sem isso, uma conexão
      // `complete` fica 6h sem enxergar venda nova (ver requestAmazonSync).
      if (step === 0) await runAmazonSyncStep(account, forcarJanela);
      if (!forcarJanela) break;
      continue;
    }
    await runAmazonSyncStep(account);
  }
}
