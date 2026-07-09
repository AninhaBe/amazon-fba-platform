import { spapiFetch, defaultMarketplaceId } from "./spapi";

// ---- Tipos da Product Fees API v0 ----
export interface MoneyType {
  CurrencyCode: string;
  Amount: number;
}

interface FeeDetail {
  FeeType: string;
  FeeAmount: MoneyType;
  FeePromotion?: MoneyType;
  TaxAmount?: MoneyType;
  FinalFee: MoneyType;
}

interface FeesEstimate {
  TimeOfFeesEstimation: string;
  TotalFeesEstimate: MoneyType;
  FeeDetailList: FeeDetail[];
}

interface FeesEstimateResult {
  Status: string;
  FeesEstimate?: FeesEstimate;
  Error?: { Type: string; Code: string; Message: string };
}

interface FeesEstimateResponse {
  payload: { FeesEstimateResult: FeesEstimateResult };
}

/**
 * Estima as taxas da Amazon para um ASIN a um dado preço de venda.
 * Operação: getMyFeesEstimateForASIN
 * POST /products/fees/v0/items/{Asin}/feesEstimate
 */
export async function getFeesEstimateForAsin(params: {
  asin: string;
  price: number;
  shipping?: number;
  currency?: string;
  isAmazonFulfilled?: boolean;
  marketplaceId?: string;
}): Promise<FeesEstimate> {
  const {
    asin,
    price,
    shipping = 0,
    currency = "BRL",
    isAmazonFulfilled = true,
    marketplaceId = defaultMarketplaceId(),
  } = params;

  const body = {
    FeesEstimateRequest: {
      MarketplaceId: marketplaceId,
      IsAmazonFulfilled: isAmazonFulfilled,
      PriceToEstimateFees: {
        ListingPrice: { CurrencyCode: currency, Amount: price },
        Shipping: { CurrencyCode: currency, Amount: shipping },
      },
      Identifier: `est-${asin}-${price}`,
    },
  };

  const data = await spapiFetch<FeesEstimateResponse>(
    `/products/fees/v0/items/${encodeURIComponent(asin)}/feesEstimate`,
    { method: "POST", body }
  );

  const result = data.payload?.FeesEstimateResult;
  if (!result || result.Status !== "Success" || !result.FeesEstimate) {
    const msg = result?.Error?.Message || `Status: ${result?.Status ?? "desconhecido"}`;
    throw new Error(`Não foi possível estimar as taxas: ${msg}`);
  }
  return result.FeesEstimate;
}

// ---- Cálculo de lucro ----
export interface ProfitBreakdown {
  price: number;
  cost: number;
  shipping: number;
  storageFee: number;
  totalFees: number; // taxas da API (comissão + FBA)
  feeDetails: { type: string; amount: number }[];
  netProfit: number;
  marginPct: number; // margem sobre o preço de venda
  roiPct: number; // retorno sobre o custo
  currency: string;
}

export function computeProfit(input: {
  estimate: FeesEstimate;
  price: number;
  cost: number;
  shipping?: number;
  storageFee?: number;
}): ProfitBreakdown {
  const { estimate, price, cost, shipping = 0, storageFee = 0 } = input;
  const totalFees = estimate.TotalFeesEstimate.Amount;
  const currency = estimate.TotalFeesEstimate.CurrencyCode;

  const feeDetails = estimate.FeeDetailList.map((f) => ({
    type: f.FeeType,
    amount: f.FinalFee.Amount,
  }));

  const netProfit = price - cost - shipping - totalFees - storageFee;
  const marginPct = price > 0 ? (netProfit / price) * 100 : 0;
  const roiPct = cost > 0 ? (netProfit / cost) * 100 : 0;

  return {
    price,
    cost,
    shipping,
    storageFee,
    totalFees,
    feeDetails,
    netProfit,
    marginPct,
    roiPct,
    currency,
  };
}
