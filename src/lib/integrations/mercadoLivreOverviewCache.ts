import { dbQuery, hasDb } from "../db";
import { currentWorkspaceId } from "../workspaceScope";

const PROVIDER = "mercado_livre";
interface SnapshotRow<T> {
  payload: T;
  generated_at: Date | string;
}

export async function loadMercadoLivreOverviewSnapshot<T>(
  connectionId: string,
  periodKey: string
): Promise<{ payload: T; generatedAt: string } | null> {
  if (!hasDb()) return null;
  const rows = await dbQuery<SnapshotRow<T>>(
    `SELECT payload, generated_at
       FROM workspace_marketplace_overview_snapshots
      WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3 AND period_key = $4
        AND generated_at >= now() - interval '2 minutes'`,
    [currentWorkspaceId(), PROVIDER, connectionId, periodKey]
  );
  const row = rows[0];
  return row ? { payload: row.payload, generatedAt: new Date(row.generated_at).toISOString() } : null;
}

export async function saveMercadoLivreOverviewSnapshot<T>(
  connectionId: string,
  periodKey: string,
  payload: T
): Promise<string> {
  const rows = await dbQuery<{ generated_at: Date | string }>(
    `INSERT INTO workspace_marketplace_overview_snapshots
       (workspace_id, provider, connection_id, period_key, payload, generated_at)
     VALUES ($1,$2,$3,$4,$5::jsonb,now())
     ON CONFLICT (workspace_id, provider, connection_id, period_key) DO UPDATE SET
       payload = EXCLUDED.payload, generated_at = now()
     RETURNING generated_at`,
    [currentWorkspaceId(), PROVIDER, connectionId, periodKey, JSON.stringify(payload)]
  );
  return new Date(rows[0].generated_at).toISOString();
}

export async function invalidateMercadoLivreOverviewSnapshots(connectionId?: string): Promise<void> {
  if (!hasDb()) return;
  if (connectionId) {
    await dbQuery(
      `DELETE FROM workspace_marketplace_overview_snapshots
        WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3`,
      [currentWorkspaceId(), PROVIDER, connectionId]
    );
    return;
  }
  await dbQuery(
    `DELETE FROM workspace_marketplace_overview_snapshots
      WHERE workspace_id = $1 AND provider = $2`,
    [currentWorkspaceId(), PROVIDER]
  );
}
