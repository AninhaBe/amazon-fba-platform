import { dbQuery, hasDb } from "../../db";
import { currentWorkspaceId } from "../../workspaceScope";
import type { Detector, InsightCandidate } from "../types";
import { mercadoLivreConnections } from "./mercadoLivreRuptura";

// Detector de queda de velocidade (Mercado Livre). Reimplementação do princípio
// da Amazon com o canônico do ML: unidades vendidas por SKU nos últimos 7 dias
// contra os 7 anteriores, direto de workspace_channel_order_items. Só vendas
// aprovadas (status paid) — queda de venda é sobre o que vendeu de verdade.
// Mesmos limiares da Amazon: queda > 25% com volume mínimo na janela anterior.

const TYPE = "velocidade";
const PROVIDER = "mercado_livre";
const DROP_THRESHOLD = 0.25;
const MIN_PREVIOUS_UNITS = 5;
const DAY = 86_400_000;

interface UnitsRow { sku: string; title: string; units: number }

async function unitsBySku(connectionId: string, from: Date, to: Date): Promise<Map<string, UnitsRow>> {
  const rows = await dbQuery<UnitsRow>(
    `SELECT COALESCE(i.sku, i.external_product_id) AS sku, MAX(i.title) AS title, SUM(i.qty)::int AS units
       FROM workspace_channel_order_items i
       JOIN workspace_channel_orders o
         ON o.workspace_id = i.workspace_id AND o.provider = i.provider
        AND o.connection_id = i.connection_id AND o.external_order_id = i.external_order_id
      WHERE o.workspace_id = $1 AND o.provider = $2 AND o.connection_id = $3
        AND o.status = 'paid' AND o.occurred_at >= $4 AND o.occurred_at < $5
      GROUP BY 1`,
    [currentWorkspaceId(), PROVIDER, connectionId, from, to]
  );
  return new Map(rows.map((row) => [row.sku, row]));
}

export const mercadoLivreVelocidadeDetector: Detector = {
  type: TYPE,
  provider: PROVIDER,
  async run(): Promise<InsightCandidate[]> {
    if (!hasDb()) return [];
    const now = Date.now();
    const candidates: InsightCandidate[] = [];
    for (const connection of await mercadoLivreConnections()) {
      const [current, previous] = await Promise.all([
        unitsBySku(connection.id, new Date(now - 7 * DAY), new Date(now)),
        unitsBySku(connection.id, new Date(now - 14 * DAY), new Date(now - 7 * DAY)),
      ]);
      for (const [sku, prev] of previous) {
        if (prev.units < MIN_PREVIOUS_UNITS) continue;
        const curUnits = current.get(sku)?.units ?? 0;
        const drop = (prev.units - curUnits) / prev.units;
        if (drop <= DROP_THRESHOLD) continue;
        const name = prev.title || sku;
        const dropPct = Math.round(drop * 100);

        candidates.push({
          id: `${TYPE}:${PROVIDER}:${connection.externalAccountId}:${sku}`,
          type: TYPE,
          provider: PROVIDER,
          entityRef: sku,
          // Queda maior = mais urgente (62 a ~95), como na Amazon.
          severity: Math.min(95, 50 + Math.round(drop * 50)),
          title: name,
          evidence: {
            ultimos7d: curUnits,
            "7dAnteriores": prev.units,
            quedaPct: dropPct,
          },
          impact: {
            unidadesAMenosPorSemana: prev.units - curUnits,
            premissa: "comparação 7d vs 7d anteriores; vendas aprovadas por SKU",
          },
          recommendation: `Vendas de ${name} caíram ${dropPct}% na semana (${prev.units} → ${curUnits} un). Revise preço, posição do anúncio e estoque — algo mudou.`,
          actionHref: "/mercado-livre/monitor",
        });
      }
    }
    return candidates;
  },
};
