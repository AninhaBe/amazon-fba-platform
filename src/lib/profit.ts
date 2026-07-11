import { getFinanceSummary, type FinanceSummary } from "./finances";
import { getSalesVelocity } from "./orders";
import { getCosts } from "./costStore";
import type { Period } from "./period";

export interface ProfitSummary {
  finance: FinanceSummary;
  cogs: number; // custo das mercadorias vendidas (unidades × custo cadastrado)
  estimatedProfit: number; // repasse líquido − COGS
  unitsWithCost: number;
  unitsWithoutCost: number; // unidades vendidas sem custo cadastrado
  skusMissingCost: string[];
}

/**
 * Lucro estimado do período: pega o repasse líquido real (Finances) e desconta
 * o custo das mercadorias vendidas (unidades vendidas por SKU × custo cadastrado).
 */
export async function getProfitSummary(period: Period): Promise<ProfitSummary> {
  const [finance, velocity, costs] = await Promise.all([
    getFinanceSummary(period),
    getSalesVelocity({ period }),
    getCosts(),
  ]);

  let cogs = 0;
  let unitsWithCost = 0;
  let unitsWithoutCost = 0;
  const skusMissingCost: string[] = [];

  for (const [sku, units] of Object.entries(velocity.unitsBySku)) {
    const cost = costs[sku]?.cost;
    if (cost == null) {
      unitsWithoutCost += units;
      skusMissingCost.push(sku);
    } else {
      cogs += units * cost;
      unitsWithCost += units;
    }
  }

  return {
    finance,
    cogs: +cogs.toFixed(2),
    estimatedProfit: +(finance.netProceeds - cogs).toFixed(2),
    unitsWithCost,
    unitsWithoutCost,
    skusMissingCost,
  };
}
