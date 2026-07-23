import { getInventory, type StockItem } from "./inventory";
import { getSalesVelocity } from "./orders";
import type { Period } from "./period";

export type StockStatus = "out" | "critical" | "low" | "ok" | "overstock" | "idle";

export interface RadarRow extends StockItem {
  unitsSold: number;
  perDay: number; // velocidade de venda (un/dia)
  daysRemaining: number | null; // null = sem venda (não dá pra prever)
  status: StockStatus;
}

// Limiares de dias para classificar a urgência.
const CRITICAL_DAYS = 10; // repor já (menos que o lead time típico do FBA)
const LOW_DAYS = 21; // repor em breve
const OVERSTOCK_DAYS = 120; // parado demais, pagando armazenagem

function classify(item: StockItem, perDay: number, daysRemaining: number | null): StockStatus {
  if (item.fulfillable <= 0 && item.inbound <= 0) return "out";
  if (perDay <= 0) return item.fulfillable > 0 ? "idle" : "out";
  if (daysRemaining == null) return "idle";
  if (daysRemaining <= CRITICAL_DAYS) return "critical";
  if (daysRemaining <= LOW_DAYS) return "low";
  if (daysRemaining >= OVERSTOCK_DAYS) return "overstock";
  return "ok";
}

/**
 * Monta o radar de estoque: estoque atual + velocidade → dias restantes + status.
 * `velocityOverride` (unidades vendidas por SKU) vem do canônico quando o período
 * está coberto; sem ele, cai na Sales Velocity ao vivo (Finances v0, mais lenta).
 */
export async function getStockRadar(period: Period, velocityOverride?: Record<string, number>): Promise<RadarRow[]> {
  // Estoque e velocidade em paralelo (a velocidade é pulada se veio do canônico).
  const [inventory, velocity] = await Promise.all([
    getInventory(),
    velocityOverride ? Promise.resolve({ unitsBySku: velocityOverride }) : getSalesVelocity({ period }),
  ]);

  const rows: RadarRow[] = inventory.map((item) => {
    const unitsSold = velocity.unitsBySku[item.sellerSku] ?? 0;
    const perDay = unitsSold / period.days;
    const daysRemaining = perDay > 0 ? item.fulfillable / perDay : null;
    return {
      ...item,
      unitsSold,
      perDay: +perDay.toFixed(2),
      daysRemaining: daysRemaining == null ? null : Math.floor(daysRemaining),
      status: classify(item, perDay, daysRemaining),
    };
  });

  // Ordena por urgência: quem acaba antes primeiro; sem venda vai pro fim.
  const rank: Record<StockStatus, number> = {
    out: 0, critical: 1, low: 2, ok: 3, overstock: 4, idle: 5,
  };
  rows.sort((a, b) => {
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
    const da = a.daysRemaining ?? Infinity;
    const db = b.daysRemaining ?? Infinity;
    return da - db;
  });

  return rows;
}
