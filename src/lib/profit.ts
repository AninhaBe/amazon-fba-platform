import { getFinanceSummary, type FinanceSummary } from "./finances";
import { getCosts } from "./costStore";
import type { Period } from "./period";
import { calculateHistoricalCostCoverage } from "./financialMath";

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
  const [finance, costs] = await Promise.all([
    getFinanceSummary(period),
    getCosts(),
  ]);

  const sales = finance.itemLines
    .filter((line): line is typeof line & { sku: string } => !!line.sku && line.quantity > 0)
    .map((line) => ({ sku: line.sku, units: line.quantity, purchasedAt: line.postedDate }));
  const coverage = calculateHistoricalCostCoverage(finance.netProceeds, sales, costs);

  return {
    finance,
    ...coverage,
  };
}
