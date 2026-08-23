import test from "node:test";
import assert from "node:assert/strict";
import { allocateByWeight, calculateContribution } from "../src/lib/profitability.ts";

test("calcula margem por venda com custos, tarifas, imposto e frete", () => {
  const result = calculateContribution({
    revenue: 100,
    buyerShipping: 10,
    productCost: 35,
    marketplaceFees: 15,
    sellerShipping: 8,
    tax: 6,
  });
  assert.deepEqual(result, { contribution: 46, marginPct: 46, complete: true });
});

test("não inventa margem quando custo ou tarifa ainda não existem", () => {
  assert.deepEqual(
    calculateContribution({ revenue: 100, productCost: null, marketplaceFees: 15 }),
    { contribution: null, marginPct: null, complete: false }
  );
});

test("rateia o frete entre itens sem perder centavos", () => {
  const shares = allocateByWeight(13.3, [42.99, 42.99]);
  assert.deepEqual(shares, [6.65, 6.65]);
  assert.equal(shares.reduce((sum, value) => sum + value, 0), 13.3);
});

test("rateia centavos restantes de forma determinística", () => {
  const shares = allocateByWeight(10, [1, 1, 1]);
  assert.deepEqual(shares, [3.34, 3.33, 3.33]);
});

test("reproduz a margem conciliada da venda do Mercado Livre", () => {
  const result = calculateContribution({
    revenue: 42.99,
    productCost: 24.61,
    marketplaceFees: 4.94,
    sellerShipping: 6.65,
    tax: 0,
  });
  assert.deepEqual(result, { contribution: 6.79, marginPct: 15.79, complete: true });
});
