import { dbQuery, hasDb } from "../db";
import { runWithWorkspace } from "../workspaceScope";
import { getIntegration } from "./integrationStore";
import { runShopeeSyncBatch, type ShopeeSyncStatus } from "./shopeeSync";

// Agendamento do sync da Shopee (ADR-003: cron por GitHub Actions).
// Mesmo desenho do scheduler do Mercado Livre: escolhe conexões elegíveis,
// respeita o lease e roda cada uma dentro do seu workspace.

const PROVIDER = "shopee";

interface SyncCandidate {
  workspace_id: string;
  connection_id: string;
}

export interface ScheduledShopeeResult {
  workspaceId: string;
  connectionId: string;
  status: ShopeeSyncStatus["status"] | "missing" | "failed";
  progress?: number;
  reason?: string;
}

export async function runScheduledShopeeSync(
  connectionLimit = 3,
  budgetMs = 20_000
): Promise<ScheduledShopeeResult[]> {
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

  return Promise.all(candidates.map(async (candidate): Promise<ScheduledShopeeResult> => {
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
        const sync = await runShopeeSyncBatch(connection, budgetMs);
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
