import { dbQuery, hasDb } from "../db";
import { filtroDeAcessoLiberado } from "./assinaturaPausaSync";
import { runWithWorkspace } from "../workspaceScope";
import { getIntegration } from "./integrationStore";
import {
  reverifyMercadoLivreOrders,
  runMercadoLivreSyncBatch,
  FRESH_FOR_MS,
  type MercadoLivreSyncStatus,
} from "./mercadoLivreSync";

const PROVIDER = "mercado_livre";

interface SyncCandidate {
  workspace_id: string;
  connection_id: string;
}

export interface ScheduledSyncResult {
  workspaceId: string;
  connectionId: string;
  status: MercadoLivreSyncStatus["status"] | "missing" | "failed";
  progress?: number;
  reason?: string;
}

export async function runScheduledMercadoLivreSync(
  connectionLimit = 3,
  stepsPerConnection = 8
): Promise<ScheduledSyncResult[]> {
  if (!hasDb()) return [];

  const filtroDeAcesso = await filtroDeAcessoLiberado("sync");
  const candidates = await dbQuery<SyncCandidate>(
    `SELECT sync.workspace_id, sync.connection_id
       FROM workspace_marketplace_syncs sync
       JOIN workspace_integrations integration
         ON integration.workspace_id = sync.workspace_id
        AND integration.id = sync.connection_id
        AND integration.provider = sync.provider
      WHERE sync.provider = $1
        AND ${filtroDeAcesso}
        AND integration.status = 'connected'
        -- Conexao de demonstracao nunca vai para a API real: o token e falso e
        -- cada tentativa grava erro no sync, que aparece na frente do dashboard
        -- da conta de demo. Mesmo predicado do shopeeScheduler.ts.
        AND integration.metadata->'demo' IS DISTINCT FROM 'true'::jsonb
        AND (
          (sync.status IN ('pending', 'syncing')
            AND (sync.lease_until IS NULL OR sync.lease_until < now()))
          -- ERRO TRANSITÓRIO VOLTA A SER CANDIDATO (28/08/2026).
          --
          -- Sem esta cláusula, status='error' era ESTADO TERMINAL DE FATO: o
          -- scheduler só elegia pending/syncing/complete, então um timeout de
          -- banco às 11:34 prendeu a conta real da vendedora por 7h30 — o token
          -- venceu junto (o refresh só acontece dentro do passo de sync) e
          -- ninguém foi avisado. Vale para qualquer cliente que pegue um 5xx.
          --
          -- ⚠️ Estado terminal só pode ser terminal quando o MOTIVO é terminal
          -- (mesma regra do claim órfão do webhook): erro de autorização NÃO
          -- entra em loop de retry. Aqui isso já está garantido SEM olhar o
          -- texto do erro — diferente da Shopee, que carimba prefixos em
          -- last_error, o ML persiste integration.status='disconnected' no
          -- próprio refresh recusado (mercadoLivre.ts, ChannelAuthExpiredError),
          -- e o predicado integration.status = 'connected' lá em cima já tira
          -- essas conexões do lote. Filtrar por prefixo aqui seria decorativo:
          -- o ML grava a mensagem crua do erro, sem marcador nenhum.
          OR (sync.status = 'error'
            AND sync.updated_at < now() - interval '15 minutes'
            AND (sync.lease_until IS NULL OR sync.lease_until < now()))
          -- A janela vem de FRESH_FOR_MS (mercadoLivreSync.ts), não de um literal
          -- daqui: os dois portões PRECISAM casar, e um literal solto foi o que
          -- deixou este canal 6h atrás dos outros até 23/08/2026.
          OR (sync.status = 'complete'
            AND COALESCE(sync.last_success_at, sync.updated_at) < now() - ($3 || ' milliseconds')::interval)
        )
      ORDER BY
        -- Conta que nunca fechou uma janela (covered_from nulo) é primeira
        -- sincronização: fura a fila para o vendedor não esperar atrás do
        -- backfill das contas antigas. Mesmo desenho do shopeeScheduler.ts.
        CASE
          WHEN sync.covered_from IS NULL THEN 0
          WHEN sync.status = 'complete' THEN 2
          ELSE 1
        END,
        sync.updated_at ASC
      LIMIT $2`,
    [PROVIDER, connectionLimit, String(FRESH_FOR_MS)]
  );

  return Promise.all(candidates.map(async (candidate): Promise<ScheduledSyncResult> => {
    try {
      return await runWithWorkspace(candidate.workspace_id, async () => {
        const connection = await getIntegration(candidate.connection_id);
        if (!connection || connection.provider !== PROVIDER) {
          return {
            workspaceId: candidate.workspace_id,
            connectionId: candidate.connection_id,
            status: "missing",
          };
        }

        const sync = await runMercadoLivreSyncBatch(connection, stepsPerConnection);
        return {
          workspaceId: candidate.workspace_id,
          connectionId: candidate.connection_id,
          status: sync.status,
          progress: sync.progress,
        };
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

export interface ScheduledReverifyResult {
  workspaceId: string;
  connectionId: string;
  status: "reverified" | "missing" | "failed";
  from?: string;
  to?: string;
  orders?: number;
  reason?: string;
}

// Re-verificação automática e escalável. A cada passagem do cron pega as N contas
// conectadas menos recentemente reconferidas (reverify_to ASC NULLS FIRST), re-busca
// uma fatia da janela de retenção com date_asc e re-persiste no canônico. Cada conta
// cicla sozinha pela retenção ao longo de várias passagens — sem nada manual, cura
// gaps históricos e drift futuro para todos os usuários.
export async function runScheduledMercadoLivreReverify(
  connectionLimit = 3
): Promise<ScheduledReverifyResult[]> {
  if (!hasDb()) return [];

  const filtroDeAcesso = await filtroDeAcessoLiberado("sync");
  const candidates = await dbQuery<SyncCandidate>(
    `SELECT sync.workspace_id, sync.connection_id
       FROM workspace_marketplace_syncs sync
       JOIN workspace_integrations integration
         ON integration.workspace_id = sync.workspace_id
        AND integration.id = sync.connection_id
        AND integration.provider = sync.provider
      WHERE sync.provider = $1
        AND ${filtroDeAcesso}
        AND integration.status = 'connected'
        -- Conexao de demonstracao nunca vai para a API real: o token e falso e
        -- cada tentativa grava erro no sync, que aparece na frente do dashboard
        -- da conta de demo. Mesmo predicado do shopeeScheduler.ts.
        AND integration.metadata->'demo' IS DISTINCT FROM 'true'::jsonb
        AND sync.status = 'complete'
      ORDER BY sync.reverify_to ASC NULLS FIRST, sync.updated_at ASC
      LIMIT $2`,
    [PROVIDER, connectionLimit]
  );

  return Promise.all(candidates.map(async (candidate): Promise<ScheduledReverifyResult> => {
    try {
      return await runWithWorkspace(candidate.workspace_id, async () => {
        const connection = await getIntegration(candidate.connection_id);
        if (!connection || connection.provider !== PROVIDER) {
          return {
            workspaceId: candidate.workspace_id,
            connectionId: candidate.connection_id,
            status: "missing",
          };
        }

        const result = await reverifyMercadoLivreOrders(connection);
        return {
          workspaceId: candidate.workspace_id,
          connectionId: candidate.connection_id,
          status: "reverified",
          from: result.from,
          to: result.to,
          orders: result.orders,
        };
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
