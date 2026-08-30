import { getFinanceSummaryFromTransactions, type FinanceSummaryFromTransactions } from "./transactions";
import { getCosts } from "./costStore";
import type { Period } from "./period";
import { calculateHistoricalCostCoverage, descontarAnuncio } from "./financialMath";
import { anuncioDoCanal, anuncioJaNoExtrato } from "./anuncioDoCanal";
import { dbQuery } from "./db";
import { currentAccountId } from "./accountContext";
import { currentWorkspaceId } from "./workspaceScope";
import { amazonTaxAmount, getAmazonTaxRateSetting } from "./integrations/amazonSettings";

export interface ProfitSummary {
  finance: FinanceSummaryFromTransactions;
  cogs: number; // custo das mercadorias vendidas (unidades × custo cadastrado)
  /**
   * Repasse líquido − COGS − imposto (quando configurado) − ANÚNCIO.
   *
   * ⚠️ O anúncio JÁ ESTÁ AQUI DENTRO desde 30/08/2026 — ver a fronteira em
   * `financialMath.ts`. Quem consome (MONITOR, HOME) não subtrai de novo.
   * `null` quando o gasto com anúncio é desconhecido: o número sem anúncio
   * seria otimista, e otimista sem aviso é mentira.
   */
  estimatedProfit: number | null;
  unitsWithCost: number;
  unitsWithoutCost: number; // unidades vendidas sem custo cadastrado
  skusMissingCost: string[];
  /** Alíquota declarada pela vendedora. `null` = ainda não configurada. */
  taxRate: number | null;
  /** Imposto do período. `null` quando não há alíquota — nunca zero por omissão. */
  taxes: number | null;
  /** Gasto com anúncio JÁ descontado de `estimatedProfit`. `null` = desconhecido. */
  ads: number | null;
  /** A conta anuncia e a métrica do período não chegou. */
  adsDesconhecido: boolean;
  /** Último dia com métrica de anúncio. Não extrapolamos os dias que faltam. */
  adsAteDia: string | null;
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

  // ⚠️ O ANÚNCIO ENTRA AQUI, e não em quem exibe — ver a fronteira em
  // `financialMath.ts`. Este é o produtor do lucro que MONITOR e HOME leem, e
  // eram duas telas exibindo lucro da Amazon com a maior despesa de fora.
  //
  // Só a Amazon: `getProfitSummary` é o caminho da Amazon (Transactions API).
  // Os outros canais descontam no produtor deles.
  const anuncio = await anuncioDoCanal("amazon", period.startISO, period.endISO, {
    jaNoExtrato: anuncioJaNoExtrato(finance.feeBreakdown),
  });
  const lucro = descontarAnuncio(+(coverage.estimatedProfit - (taxes ?? 0)).toFixed(2), anuncio);

  return {
    finance,
    ...coverage,
    taxRate,
    taxes,
    estimatedProfit: lucro.estimatedProfit,
    ads: lucro.ads,
    adsDesconhecido: lucro.adsDesconhecido,
    adsAteDia: lucro.ateDia,
  };
}
