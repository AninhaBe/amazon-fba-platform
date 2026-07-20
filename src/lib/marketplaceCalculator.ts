export interface MarketplaceCalculationInput {
  price: number;
  productCost: number;
  marketplaceFee: number;
  fixedMarketplaceFee?: number;
  taxRate: number;
  sellerShipping: number;
  adsRate: number;
  otherCosts: number;
  targetMarginRate?: number;
}

export function calculateMarketplaceScenario(input: MarketplaceCalculationInput) {
  const tax = input.price * input.taxRate / 100;
  const ads = input.price * input.adsRate / 100;
  const contribution = input.price - input.marketplaceFee - tax - input.sellerShipping - input.productCost - ads - input.otherCosts;
  const marginRate = input.price > 0 ? contribution / input.price * 100 : 0;
  const roiRate = input.productCost > 0 ? contribution / input.productCost * 100 : null;
  const maxAdsAmount = Math.max(0, contribution + ads);
  const maxAdsRate = input.price > 0 ? maxAdsAmount / input.price * 100 : 0;
  const variableMarketplaceRate = input.price > 0
    ? Math.max(0, input.marketplaceFee - (input.fixedMarketplaceFee ?? 0)) / input.price * 100
    : 0;
  const targetMarginRate = input.targetMarginRate ?? 0;
  const denominator = 1 - (variableMarketplaceRate + input.taxRate + input.adsRate + targetMarginRate) / 100;
  const suggestedPrice = denominator > 0
    ? (input.productCost + input.sellerShipping + input.otherCosts + (input.fixedMarketplaceFee ?? 0)) / denominator
    : null;

  return {
    tax,
    ads,
    contribution,
    marginRate,
    roiRate,
    maxAdsAmount,
    maxAdsRate,
    suggestedPrice,
  };
}
