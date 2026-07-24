import { dbQuery, hasDb } from "../db";
import { runWithWorkspace } from "../workspaceScope";
import { runWithAccount, type AccountCtx } from "../accountContext";
import { getAccount } from "../accountStore";
import { periodFromDays } from "../period";
import { getDailySales } from "../sales";
import { getProfitSummary } from "../profit";
import { getInventory } from "../inventory";

// Aquecimento do dashboard Amazon (fase 5C, parte 2). Depois do sync, o cron
// pré-carrega os caches (swr/Postgres) dos períodos que o filtro oferece, para
// a primeira visita já vir quente — inclusive o KPI de Lucro, que fica na
// Transactions API de propósito (reconciliação). Diferente do sync, o warming
// roda para TODAS as contas ativas a cada passada (não depende da seleção de
// candidatos do sync, que só reagenda contas "em dia" a cada 6h).
//
// Best-effort: qualquer falha é engolida — aquecer nunca deve derrubar o cron.

const PROVIDER = "amazon";
const CONNECTION_PREFIX = "amazon:";
// Espelha os presets de DashboardPeriodFilter: Hoje (1), 7, 15, 30 dias.
const WARM_PERIODS = [1, 7, 15, 30];

async function warmOneAccount(account: AccountCtx): Promise<void> {
  await runWithAccount(account, async () => {
    // O estoque (FBA Inventory) independe do período: aquece uma vez só.
    await getInventory().catch(() => {});
    for (const days of WARM_PERIODS) {
      const period = periodFromDays(days);
      // Sequencial e tolerante a falhas para não pressionar o rate limit da
      // SP-API; quando o cache está fresco, o swr devolve na hora sem chamada.
      await getDailySales(period).catch(() => {});
      await getProfitSummary(period).catch(() => {});
    }
  });
}

export async function runScheduledAmazonWarm(limit = 2): Promise<number> {
  if (!hasDb()) return 0;
  const rows = await dbQuery<{ workspace_id: string; connection_id: string }>(
    `SELECT workspace_id, connection_id
       FROM workspace_marketplace_syncs
      WHERE provider = $1
      ORDER BY updated_at DESC
      LIMIT $2`,
    [PROVIDER, limit]
  );

  let warmed = 0;
  for (const row of rows) {
    const sellerId = row.connection_id.startsWith(CONNECTION_PREFIX)
      ? row.connection_id.slice(CONNECTION_PREFIX.length)
      : row.connection_id;
    const account = await getAccount(sellerId);
    if (!account?.refreshToken) continue;
    try {
      await runWithWorkspace(row.workspace_id, () =>
        warmOneAccount({ sellerId: account.sellerId, refreshToken: account.refreshToken })
      );
      warmed += 1;
    } catch {
      // best-effort: segue para a próxima conta.
    }
  }
  return warmed;
}
