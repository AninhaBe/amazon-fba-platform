import { getFinanceSummaryFromTransactions, type FinanceSummaryFromTransactions } from "./transactions";
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
 * Lucro estimado do período, tudo a partir da Transactions API 2024-06-19
 * (a Finances v0 devolve valores zerados). Dinheiro (receita, taxas, repasse)
 * e unidades por SKU vêm da mesma fonte; o custo das mercadorias sai do
 * cruzamento com os custos cadastrados na vigência de cada venda.
 */
export async function getProfitSummary(period: Period): Promise<ProfitSummary> {
  const [finance, costs] = await Promise.all([
    getFinanceSummaryFromTransactions(period),
    getCosts(),
  ]);

  const coverage = calculateHistoricalCostCoverage(finance.netProceeds, finance.salesLines, costs);

  return {
    finance,
    ...coverage,
  };
}
