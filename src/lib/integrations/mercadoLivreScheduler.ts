import { dbQuery, hasDb } from "../db";
import { runWithWorkspace } from "../workspaceScope";
import { getIntegration } from "./integrationStore";
import {
  reverifyMercadoLivreOrders,
  runMercadoLivreSyncBatch,
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

  const candidates = await dbQuery<SyncCandidate>(
    `SELECT sync.workspace_id, sync.connection_id
       FROM workspace_marketplace_syncs sync
       JOIN workspace_integrations integration
         ON integration.workspace_id = sync.workspace_id
        AND integration.id = sync.connection_id
        AND integration.provider = sync.provider
      WHERE sync.provider = $1
        AND integration.status = 'connected'
        AND (
          (sync.status IN ('pending', 'syncing')
            AND (sync.lease_until IS NULL OR sync.lease_until < now()))
          OR (sync.status = 'complete'
            AND COALESCE(sync.last_success_at, sync.updated_at) < now() - interval '6 hours')
        )
      ORDER BY
        CASE WHEN sync.status = 'complete' THEN 1 ELSE 0 END,
        sync.updated_at ASC
      LIMIT $2`,
    [PROVIDER, connectionLimit]
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

  const candidates = await dbQuery<SyncCandidate>(
    `SELECT sync.workspace_id, sync.connection_id
       FROM workspace_marketplace_syncs sync
       JOIN workspace_integrations integration
         ON integration.workspace_id = sync.workspace_id
        AND integration.id = sync.connection_id
        AND integration.provider = sync.provider
      WHERE sync.provider = $1
        AND integration.status = 'connected'
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
