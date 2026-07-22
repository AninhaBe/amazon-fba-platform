import { dbQuery, hasDb } from "../db";
import { currentWorkspaceId } from "../workspaceScope";
import { getMercadoLivreOverview, type MercadoLivreOverviewSource, type MercadoLivrePeriod } from "./mercadoLivre";
import { saveMercadoLivreOverviewSnapshot } from "./mercadoLivreOverviewCache";
import { loadMercadoLivreSource } from "./mercadoLivreSync";
import type { IntegrationConnection } from "./types";

const PROVIDER = "mercado_livre";
const DAY = 86_400_000;
const VIEWS = ["dashboard", "estoque", "monitor"] as const;
type MaterializedView = typeof VIEWS[number];

export interface MaterializationPriority {
  periodKey: string;
  view: MaterializedView;
}

interface PresetPeriod extends MercadoLivrePeriod {
  cacheKey: string;
}

function presetPeriods(now = new Date()): PresetPeriod[] {
  const brazilDate = new Date(now.getTime() - 3 * 60 * 60_000).toISOString().slice(0, 10);
  return [
    {
      from: new Date(`${brazilDate}T00:00:00-03:00`),
      to: now,
      label: "Hoje",
      cacheKey: `today:${brazilDate}`,
    },
    ...[7, 15, 30].map((days) => {
      // Dia-calendário em São Paulo (00:00 de N dias atrás), como o painel do ML.
      const startDate = new Date(now.getTime() - 3 * 60 * 60_000 - days * DAY).toISOString().slice(0, 10);
      return {
        from: new Date(`${startDate}T00:00:00-03:00`),
        to: now,
        label: `Últimos ${days} dias`,
        cacheKey: `days:${days}`,
      };
    }),
  ];
}

function sourceForPeriod(source: MercadoLivreOverviewSource, period: MercadoLivrePeriod): MercadoLivreOverviewSource {
  const orders = source.orders.filter((order) => {
    const occurredAt = new Date(order.date_created).getTime();
    return occurredAt >= period.from.getTime() && occurredAt <= period.to.getTime();
  });
  return {
    ...source,
    orders,
    totalOrders: orders.length,
  };
}

async function acquireLease(connectionId: string): Promise<boolean> {
  const rows = await dbQuery<{ acquired: boolean }>(
    `INSERT INTO workspace_marketplace_materialization_leases
       (workspace_id, provider, connection_id, lease_until, updated_at)
     VALUES ($1, $2, $3, now() + interval '5 minutes', now())
     ON CONFLICT (workspace_id, provider, connection_id) DO UPDATE SET
       lease_until = EXCLUDED.lease_until,
       updated_at = now()
     WHERE workspace_marketplace_materialization_leases.lease_until IS NULL
        OR workspace_marketplace_materialization_leases.lease_until < now()
     RETURNING true AS acquired`,
    [currentWorkspaceId(), PROVIDER, connectionId]
  );
  return rows[0]?.acquired === true;
}

async function releaseLease(connectionId: string): Promise<void> {
  await dbQuery(
    `UPDATE workspace_marketplace_materialization_leases
        SET lease_until = NULL, updated_at = now()
      WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3`,
    [currentWorkspaceId(), PROVIDER, connectionId]
  );
}

export async function materializeMercadoLivrePresetOverviews(
  connection: IntegrationConnection,
  priority?: MaterializationPriority
): Promise<boolean> {
  if (!hasDb() || !await acquireLease(connection.id)) return false;
  try {
    const periods = presetPeriods();
    const broadPeriod = periods.at(-1)!;
    const loaded = await loadMercadoLivreSource(connection, broadPeriod);
    if (!loaded.source) return false;
    const orderedPeriods = priority
      ? [...periods].sort((left, right) =>
          Number(right.cacheKey === priority.periodKey) - Number(left.cacheKey === priority.periodKey)
        )
      : periods;
    const orderedViews = priority
      ? [...VIEWS].sort((left, right) =>
          Number(right === priority.view) - Number(left === priority.view)
        )
      : VIEWS;

    for (const period of orderedPeriods) {
      const overview = await getMercadoLivreOverview(
        connection,
        period,
        sourceForPeriod(loaded.source, period)
      );
      for (const view of orderedViews) {
        const payload = view === "monitor"
          ? overview
          : { ...overview, profitabilityLines: [] };
        await saveMercadoLivreOverviewSnapshot(
          connection.id,
          `${period.cacheKey}:view:${view}`,
          payload
        );
      }
    }
    return true;
  } finally {
    await releaseLease(connection.id);
  }
}
