import { getFinanceSummaryFromTransactions, type FinanceSummaryFromTransactions } from "./transactions";
import { getSalesVelocity } from "./orders";
import { getCosts } from "./costStore";
import type { Period } from "./period";
import { calculateHistoricalCostCoverage } from "./financialMath";

export interface ProfitSummary {
  finance: FinanceSummaryFromTransactions;
  cogs: number; // custo das mercadorias vendidas (unidades × custo cadastrado)
  estimatedProfit: number; // repasse líquido − COGS
  unitsWithCost: number;
  unitsWithoutCost: number; // unidades vendidas sem custo cadastrado
  skusMissingCost: string[];
}

/**
 * Lucro estimado do período. O dinheiro (receita, taxas, repasse líquido) vem
 * da Transactions API 2024-06-19 — a Finances v0 passou a devolver valores
 * zerados nesta conta. As unidades vendidas por SKU vêm da velocidade de
 * venda, e o custo das mercadorias sai do cruzamento com os custos cadastrados
 * na vigência de cada venda.
 */
export async function getProfitSummary(period: Period): Promise<ProfitSummary> {
  const [finance, velocity, costs] = await Promise.all([
    getFinanceSummaryFromTransactions(period),
    getSalesVelocity({ period }),
    getCosts(),
  ]);

  const sales = velocity.sales
    .filter((line): line is typeof line & { sku: string } => !!line.sku && line.units > 0)
    .map((line) => ({ sku: line.sku, units: line.units, purchasedAt: line.purchasedAt }));
  const coverage = calculateHistoricalCostCoverage(finance.netProceeds, sales, costs);

  return {
    finance,
    ...coverage,
  };
}
