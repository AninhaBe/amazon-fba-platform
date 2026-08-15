import { getFinanceSummaryFromTransactions, type FinanceSummaryFromTransactions } from "./transactions";
import { getCosts } from "./costStore";
import type { Period } from "./period";
import { calculateHistoricalCostCoverage } from "./financialMath";
import { dbQuery } from "./db";
import { currentAccountId } from "./accountContext";
import { currentWorkspaceId } from "./workspaceScope";
import { amazonTaxAmount, getAmazonTaxRateSetting } from "./integrations/amazonSettings";

export interface ProfitSummary {
  finance: FinanceSummaryFromTransactions;
  cogs: number; // custo das mercadorias vendidas (unidades × custo cadastrado)
  estimatedProfit: number; // repasse líquido − COGS − imposto (quando configurado)
  unitsWithCost: number;
  unitsWithoutCost: number; // unidades vendidas sem custo cadastrado
  skusMissingCost: string[];
  /** Alíquota declarada pela vendedora. `null` = ainda não configurada. */
  taxRate: number | null;
  /** Imposto do período. `null` quando não há alíquota — nunca zero por omissão. */
  taxes: number | null;
}

/**
 * Lucro estimado do período, tudo a partir da Transactions API 2024-06-19
 * (a Finances v0 devolve valores zerados). Dinheiro (receita, taxas, repasse)
 * e unidades por SKU vêm da mesma fonte; o custo das mercadorias sai do
 * cruzamento com os custos cadastrados na vigência de cada venda.
 */
export async function getProfitSummary(period: Period): Promise<ProfitSummary> {
  const [finance, costs, taxRate] = await Promise.all([
    getFinanceSummaryFromTransactions(period),
    getCosts(),
    // A alíquota é declarada pela vendedora, não vem da Amazon. Falhar aqui não
    // pode derrubar o lucro inteiro — sem ela o resultado sai sem imposto e a
    // tela diz isso, que é o mesmo comportamento de quem nunca configurou.
    getAmazonTaxRateSetting(dbQuery, currentWorkspaceId(), currentAccountId()).catch(() => null),
  ]);

  const coverage = calculateHistoricalCostCoverage(finance.netProceeds, finance.salesLines, costs);
  // Imposto incide sobre a receita de vendas, não sobre o repasse líquido — a
  // base é o que foi vendido, não o que sobrou depois das tarifas.
  const taxes = amazonTaxAmount(finance.revenue, taxRate);

  return {
    finance,
    ...coverage,
    taxRate,
    taxes,
    estimatedProfit: +(coverage.estimatedProfit - (taxes ?? 0)).toFixed(2),
  };
}
