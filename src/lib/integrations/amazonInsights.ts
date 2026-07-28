import { dbQuery, hasDb } from "../db";
import { runWithWorkspace } from "../workspaceScope";
import { runWithAccount } from "../accountContext";
import { getAccount } from "../accountStore";
import { runDetection } from "../insights/run";

// Estágio 3 do Seller Intelligence (ADR-008): a detecção de insights roda no cron
// diário, depois do sync/warm, para cada conta ativa — a página /briefing passa a
// só LER a tabela. Best-effort: falha nunca derruba o cron.

const PROVIDER = "amazon";
const CONNECTION_PREFIX = "amazon:";

export async function runScheduledInsights(limit = 5): Promise<number> {
  if (!hasDb()) return 0;
  const rows = await dbQuery<{ workspace_id: string; connection_id: string }>(
    `SELECT workspace_id, connection_id
       FROM workspace_marketplace_syncs
      WHERE provider = $1
      ORDER BY updated_at DESC
      LIMIT $2`,
    [PROVIDER, limit]
  );

  let ran = 0;
  for (const row of rows) {
    const sellerId = row.connection_id.startsWith(CONNECTION_PREFIX)
      ? row.connection_id.slice(CONNECTION_PREFIX.length)
      : row.connection_id;
    const account = await getAccount(sellerId);
    if (!account?.refreshToken) continue;
    try {
      await runWithWorkspace(row.workspace_id, () =>
        runWithAccount({ sellerId: account.sellerId, refreshToken: account.refreshToken }, runDetection)
      );
      ran += 1;
    } catch {
      // best-effort: segue para a próxima conta.
    }
  }
  return ran;
}
