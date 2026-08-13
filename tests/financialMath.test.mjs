import test from "node:test";
import assert from "node:assert/strict";
import { calculateCostCoverage, calculateHistoricalCostCoverage, percentage } from "../src/lib/financialMath.ts";

test("calcula COGS e lucro somente com custos confiáveis", () => {
  const result = calculateCostCoverage(500, { SKU_A: 2, SKU_B: 3 }, { SKU_A: { cost: 40 } });
  assert.deepEqual(result, {
    cogs: 80,
    estimatedProfit: 420,
    unitsWithCost: 2,
    unitsWithoutCost: 3,
    skusMissingCost: ["SKU_B"],
  });
});

test("custo zero explícito é conhecido e entra no cálculo", () => {
  const result = calculateCostCoverage(100, { SKU: 1 }, { SKU: { cost: 0 } });
  assert.equal(result.unitsWithCost, 1);
  assert.equal(result.unitsWithoutCost, 0);
  assert.deepEqual(result.skusMissingCost, []);
});

test("percentual evita divisão por zero", () => {
  assert.equal(percentage(25, 100), 25);
  assert.equal(percentage(25, 0), null);
});

test("usa o custo vigente na data da venda", () => {
  const result = calculateHistoricalCostCoverage(300, [{ sku: "SKU", units: 2, purchasedAt: "2026-06-15T12:00:00.000Z" }], {
    SKU: { cost: 70, updatedAt: "2026-07-01T00:00:00.000Z", history: [{ cost: 50, from: "2026-01-01T00:00:00.000Z" }, { cost: 70, from: "2026-07-01T00:00:00.000Z" }] },
  });
  assert.equal(result.cogs, 100);
  assert.equal(result.estimatedProfit, 200);
});
