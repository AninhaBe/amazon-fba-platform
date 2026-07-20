import test from "node:test";
import assert from "node:assert/strict";
import { calculateMarketplaceScenario } from "../src/lib/marketplaceCalculator.ts";

test("calcula a margem completa de uma simulação do marketplace", () => {
  const result = calculateMarketplaceScenario({
    price: 42.99,
    productCost: 24.61,
    marketplaceFee: 4.94,
    fixedMarketplaceFee: 0,
    taxRate: 0,
    sellerShipping: 6.65,
    adsRate: 0,
    otherCosts: 0,
  });
  assert.equal(+result.contribution.toFixed(2), 6.79);
  assert.equal(+result.marginRate.toFixed(2), 15.79);
});

test("calcula teto de ads sem consumir a margem restante", () => {
  const result = calculateMarketplaceScenario({
    price: 100,
    productCost: 40,
    marketplaceFee: 15,
    fixedMarketplaceFee: 5,
    taxRate: 6,
    sellerShipping: 8,
    adsRate: 10,
    otherCosts: 1,
  });
  assert.equal(result.maxAdsAmount, 30);
  assert.equal(result.maxAdsRate, 30);
});

test("estima o preço necessário para a margem alvo", () => {
  const result = calculateMarketplaceScenario({
    price: 100,
    productCost: 40,
    marketplaceFee: 15,
    fixedMarketplaceFee: 5,
    taxRate: 5,
    sellerShipping: 5,
    adsRate: 5,
    otherCosts: 0,
    targetMarginRate: 20,
  });
  assert.equal(+result.suggestedPrice.toFixed(2), 83.33);
});

test("reproduz a simulação de produto pesquisado no Mercado Livre", () => {
  const classic = calculateMarketplaceScenario({
    price: 179.34,
    productCost: 12,
    marketplaceFee: 21.52,
    taxRate: 7,
    sellerShipping: 20.75,
    adsRate: 0,
    otherCosts: 0,
  });
  const premium = calculateMarketplaceScenario({
    price: 179.34,
    productCost: 12,
    marketplaceFee: 30.49,
    taxRate: 7,
    sellerShipping: 20.75,
    adsRate: 0,
    otherCosts: 0,
  });
  assert.equal(+classic.contribution.toFixed(2), 112.52);
  assert.equal(+classic.marginRate.toFixed(2), 62.74);
  assert.equal(+premium.contribution.toFixed(2), 103.55);
  assert.equal(+premium.marginRate.toFixed(2), 57.74);
});
