import { dropGhostSkus, getInventory, type StockItem } from "./inventory";
import { getListings } from "./listings";
import { getSalesVelocity } from "./orders";
import type { Period } from "./period";
import { classificarCobertura, ORDEM_DO_RADAR, type StockStatus } from "./coberturaDeEstoque";

export { classificarCobertura, ORDEM_DO_RADAR, ROTULO_DE_COBERTURA } from "./coberturaDeEstoque";
export type { StockStatus } from "./coberturaDeEstoque";

export interface RadarRow extends StockItem {
  unitsSold: number;
  perDay: number; // velocidade de venda (un/dia)
  daysRemaining: number | null; // null = sem venda (não dá pra prever)
  status: StockStatus;
}

function classify(item: StockItem, perDay: number, daysRemaining: number | null): StockStatus {
  return classificarCobertura({
    disponivel: item.fulfillable,
    aCaminho: item.inbound,
    porDia: perDay,
    diasRestantes: daysRemaining,
  });
}

/**
 * Monta o radar de estoque: estoque atual + velocidade → dias restantes + status.
 * `velocityOverride` (unidades vendidas por SKU) vem do canônico quando o período
 * está coberto; sem ele, cai na Sales Velocity ao vivo (Finances v0, mais lenta).
 */
export async function getStockRadar(period: Period, velocityOverride?: Record<string, number>): Promise<RadarRow[]> {
  // Estoque, anúncios e velocidade em paralelo (a velocidade é pulada se veio do
  // canônico). Os anúncios servem só para descartar SKU fantasma — anúncio excluído
  // que sobrou no inventário FBA, zerado, e que não é reposição de nada.
  const [inventory, listings, velocity] = await Promise.all([
    getInventory(),
    getListings().catch(() => []),
    velocityOverride ? Promise.resolve({ unitsBySku: velocityOverride }) : getSalesVelocity({ period }),
  ]);

  const reais = dropGhostSkus(inventory, new Set(listings.map((l) => l.sku)));

  const rows: RadarRow[] = reais.map((item) => {
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
  const rank = ORDEM_DO_RADAR;
  rows.sort((a, b) => {
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
    const da = a.daysRemaining ?? Infinity;
    const db = b.daysRemaining ?? Infinity;
    return da - db;
  });

  return rows;
}
