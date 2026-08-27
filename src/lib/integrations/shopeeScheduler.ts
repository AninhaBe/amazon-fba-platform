import { dbQuery, hasDb } from "../db";
import { runWithWorkspace } from "../workspaceScope";
import { getIntegration } from "./integrationStore";
import { runShopeeSyncBatch, type ShopeeSyncStatus } from "./shopeeSync";
import { isShopeeDemoConnection } from "./shopeeConnection";

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
        AND integration.metadata->'demo' IS DISTINCT FROM 'true'::jsonb
        AND (
          (sync.status IN ('pending', 'syncing')
            AND (sync.lease_until IS NULL OR sync.lease_until < now()))
          OR (sync.status = 'error'
            AND sync.last_error NOT LIKE '[REAUTH_REQUIRED]%'
            AND sync.last_error NOT LIKE '[TERMINAL_ERROR]%'
            AND sync.updated_at < now() - interval '5 minutes'
            AND (sync.lease_until IS NULL OR sync.lease_until < now()))
          OR (sync.status = 'complete'
            -- 6h → 10min em 23/08/2026: este literal DIVERGIA do FRESH_FOR_MS
            -- de 10 minutos em shopeeSync.ts. Com os dois em desacordo, a
            -- conexão só virava candidata a cada 6 horas — o portão mais lento
            -- manda, e o valor curto do outro arquivo não servia para nada.
            AND COALESCE(sync.last_success_at, sync.updated_at) < now() - interval '10 minutes')
        )
      ORDER BY
        -- Loja que nunca fechou uma janela (covered_from nulo) é primeira
        -- sincronização: fura a fila para o vendedor não esperar atrás do
        -- backfill das lojas antigas.
        CASE
          WHEN sync.covered_from IS NULL THEN 0
          WHEN sync.status = 'complete' THEN 2
          ELSE 1
        END,
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
        if (isShopeeDemoConnection(connection)) {
          return {
            workspaceId: candidate.workspace_id,
            connectionId: candidate.connection_id,
            status: "missing",
            reason: "demo",
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
