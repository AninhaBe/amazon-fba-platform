import { dbQuery, hasDb } from "../db";
import { runWithWorkspace } from "../workspaceScope";
import { getAccount } from "../accountStore";
import { runAmazonSyncBatch } from "./amazonSync";

// Agendador do sync canônico da Amazon (cron): avança o histórico e a
// conciliação de itens sem depender de visitas ao dashboard. Mesmo desenho do
// mercadoLivreScheduler; a conta vem do accountStore (token criptografado).

const PROVIDER = "amazon";
const CONNECTION_PREFIX = "amazon:";

interface SyncCandidate {
  workspace_id: string;
  connection_id: string;
}

export interface ScheduledAmazonSyncResult {
  workspaceId: string;
  connectionId: string;
  status: "ok" | "missing" | "failed";
  reason?: string;
}

export async function runScheduledAmazonSync(
  // 2 → 3 em 20/08: com três conexões Amazon (dela, sócio, demo), duas vagas
  // deixavam sempre uma para trás — e era justamente a do sócio, com 930 itens
  // pendentes de conciliação.
  connectionLimit = 3,
  stepsPerConnection = 6
): Promise<ScheduledAmazonSyncResult[]> {
  if (!hasDb()) return [];

  const candidates = await dbQuery<SyncCandidate>(
    `SELECT sync.workspace_id, sync.connection_id
       FROM workspace_marketplace_syncs sync
       -- LEFT JOIN, nao JOIN: conexao Amazon REAL nao tem linha em
       -- workspace_integrations (medido em 27/08/2026 — as tres contas vivas
       -- estao so em workspace_marketplace_syncs). Um join interno pararia o
       -- sync delas em silencio. Com LEFT JOIN, quem nao tem integracao segue
       -- entrando; so a conexao marcada como demo fica de fora.
       LEFT JOIN workspace_integrations integration
         ON integration.workspace_id = sync.workspace_id
        AND integration.id = sync.connection_id
        AND integration.provider = sync.provider
      WHERE sync.provider = $1
        AND integration.metadata->'demo' IS DISTINCT FROM 'true'::jsonb
        AND (
          (sync.status IN ('pending', 'syncing')
            AND (sync.lease_until IS NULL OR sync.lease_until < now()))
          -- Erros transientes (rate limit, 5xx) voltam sozinhos após a pausa.
          OR (sync.status = 'error' AND sync.updated_at < now() - interval '30 minutes')
          OR (sync.status = 'complete'
          -- 6h -> 2min em 21/08/2026 (ADR-023, sem AWS: push nao e opcao). Com 6 horas, uma conexao completa so
          -- virava candidata duas vezes por dia, e o painel mostrava dado velho
          -- sem avisar (medido: ultimo pedido 16:05, tela aberta 22:15). Este
          -- valor precisa casar com FRESH_FOR_MS em amazonSync.ts: aqui decide
          -- SE a conexao entra no lote, la decide SE a janela abre. Divergir
          -- entre os dois faz o sync rodar e nao trazer nada.
            AND COALESCE(sync.last_success_at, sync.updated_at) < now() - interval '2 minutes')
          -- Pedido 'pending' VELHO é suspeito: a Amazon muda o status em horas,
          -- então pendente com 6h+ significa transição perdida (Pending → Shipped
          -- que ninguém releu). Sem esta cláusula, uma conexão "complete" com só
          -- pedidos pendentes não é candidata a nada e o buraco vira permanente —
          -- foi o caso dos 16 de 17 pedidos eternamente pendentes (20/08/2026).
          -- É esta candidatura que leva o passo de sync até reverifyUpdatedOrders.
          OR (sync.status = 'complete' AND EXISTS (
            SELECT 1 FROM workspace_channel_orders stuck
             WHERE stuck.workspace_id = sync.workspace_id AND stuck.provider = sync.provider
               AND stuck.connection_id = sync.connection_id
               AND stuck.status = 'pending'
               AND stuck.occurred_at >= now() - interval '30 days'
               AND stuck.occurred_at < now() - interval '6 hours'
          ))
          -- Completo mas com itens ou fees pendentes: continua refinando.
          OR (sync.status = 'complete' AND EXISTS (
            SELECT 1 FROM workspace_channel_orders orders
             WHERE orders.workspace_id = sync.workspace_id AND orders.provider = sync.provider
               AND orders.connection_id = sync.connection_id
               AND orders.status IN ('paid', 'shipped', 'delivered')
               AND (
                 NOT EXISTS (
                   SELECT 1 FROM workspace_channel_order_items items
                    WHERE items.workspace_id = orders.workspace_id AND items.provider = orders.provider
                      AND items.connection_id = orders.connection_id
                      AND items.external_order_id = orders.external_order_id
                 )
                 OR (orders.occurred_at < now() - interval '2 days'
                     AND orders.occurred_at >= now() - interval '45 days'
                     AND NOT EXISTS (
                   SELECT 1 FROM workspace_channel_order_fees fees
                    WHERE fees.workspace_id = orders.workspace_id AND fees.provider = orders.provider
                      AND fees.connection_id = orders.connection_id
                      AND fees.external_order_id = orders.external_order_id
                      AND fees.fee_type = 'commission'
                 ))
               )
          ))
        )
      ORDER BY
        -- Conta que nunca fechou uma janela (covered_from nulo) é primeira
        -- sincronização: fura a fila para o vendedor não esperar atrás do
        -- backfill das contas antigas. Mesmo desenho dos outros três canais.
        CASE
          WHEN sync.covered_from IS NULL THEN 0
          WHEN sync.status = 'complete' THEN 2
          ELSE 1
        END,
        sync.updated_at ASC
      LIMIT $2`,
    [PROVIDER, connectionLimit]
  );

  return Promise.all(candidates.map(async (candidate): Promise<ScheduledAmazonSyncResult> => {
    try {
      return await runWithWorkspace(candidate.workspace_id, async () => {
        const sellerId = candidate.connection_id.startsWith(CONNECTION_PREFIX)
          ? candidate.connection_id.slice(CONNECTION_PREFIX.length)
          : candidate.connection_id;
        const account = await getAccount(sellerId);
        if (!account?.refreshToken) {
          return { workspaceId: candidate.workspace_id, connectionId: candidate.connection_id, status: "missing" as const };
        }
        // Linhas em erro voltam a 'pending' antes do lote, para o loop do
        // batch não parar no primeiro passo por causa do status antigo.
        await dbQuery(
          `UPDATE workspace_marketplace_syncs
              SET status = CASE WHEN status = 'error' THEN 'pending' ELSE status END, updated_at = now()
            WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3`,
          [candidate.workspace_id, PROVIDER, candidate.connection_id]
        );
        await runAmazonSyncBatch({ sellerId: account.sellerId, refreshToken: account.refreshToken }, stepsPerConnection);
        return { workspaceId: candidate.workspace_id, connectionId: candidate.connection_id, status: "ok" as const };
      });
    } catch (error) {
      return {
        workspaceId: candidate.workspace_id,
        connectionId: candidate.connection_id,
        status: "failed",
        reason: error instanceof Error ? error.message : "Erro desconhecido",
      };
    }
  }));
}
