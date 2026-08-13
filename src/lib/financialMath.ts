export interface CostCoverage {
  cogs: number;
  estimatedProfit: number;
  unitsWithCost: number;
  unitsWithoutCost: number;
  skusMissingCost: string[];
}

export function calculateCostCoverage(
  netProceeds: number,
  unitsBySku: Record<string, number>,
  costs: Record<string, { cost: number } | undefined>
): CostCoverage {
  let cogs = 0;
  let unitsWithCost = 0;
  let unitsWithoutCost = 0;
  const skusMissingCost: string[] = [];

  for (const [sku, units] of Object.entries(unitsBySku)) {
    const cost = costs[sku]?.cost;
    if (cost == null || cost < 0) {
      unitsWithoutCost += units;
      skusMissingCost.push(sku);
    } else {
      cogs += units * cost;
      unitsWithCost += units;
    }
  }

  return {
    cogs: +cogs.toFixed(2),
    estimatedProfit: +(netProceeds - cogs).toFixed(2),
    unitsWithCost,
    unitsWithoutCost,
    skusMissingCost,
  };
}

export function percentage(numerator: number, denominator: number): number | null {
  return denominator > 0 ? (numerator / denominator) * 100 : null;
}

export function calculateHistoricalCostCoverage(
  netProceeds: number,
  sales: { sku: string; units: number; purchasedAt: string }[],
  costs: Record<string, { cost: number; updatedAt: string; history?: { cost: number; from: string }[] } | undefined>
): CostCoverage {
  let cogs = 0;
  let unitsWithCost = 0;
  let unitsWithoutCost = 0;
  const missing = new Set<string>();
  for (const sale of sales) {
    const entry = costs[sale.sku];
    const history = entry?.history?.length ? entry.history : entry ? [{ cost: entry.cost, from: entry.updatedAt }] : [];
    const cost = history.filter((change) => change.from <= sale.purchasedAt).at(-1)?.cost;
    if (cost == null || cost < 0) {
      unitsWithoutCost += sale.units;
      missing.add(sale.sku);
    } else {
      cogs += sale.units * cost;
      unitsWithCost += sale.units;
    }
  }
  return { cogs: +cogs.toFixed(2), estimatedProfit: +(netProceeds - cogs).toFixed(2), unitsWithCost, unitsWithoutCost, skusMissingCost: [...missing] };
}
