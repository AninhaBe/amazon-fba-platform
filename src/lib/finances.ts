import { spapiFetch } from "./spapi";
import { cached } from "./cache";

// Finances API v0 — listFinancialEvents.
// Agrega os eventos financeiros REAIS (repasses efetivos) da conta: receita,
// taxas de fato cobradas, reembolsos → repasse líquido. É o "realizado" que
// complementa o "previsto" da calculadora.

interface Money {
  CurrencyCode?: string;
  Amount?: string | number;
}
interface Charge {
  ChargeType?: string;
  ChargeAmount?: Money;
}
interface Fee {
  FeeType?: string;
  FeeAmount?: Money;
}
interface ShipmentItem {
  SellerSKU?: string;
  ItemChargeList?: Charge[];
  ItemFeeList?: Fee[];
  PromotionList?: { PromotionAmount?: Money }[];
}
interface ShipmentEvent {
  AmazonOrderId?: string;
  PostedDate?: string;
  ShipmentItemList?: ShipmentItem[];
}
interface RefundEvent {
  AmazonOrderId?: string;
  PostedDate?: string;
  ShipmentItemAdjustmentList?: ShipmentItem[];
}
interface FinancialEventsResponse {
  payload?: {
    FinancialEvents?: {
      ShipmentEventList?: ShipmentEvent[];
      RefundEventList?: RefundEvent[];
    };
    NextToken?: string;
  };
}

function n(m?: Money): number {
  if (!m || m.Amount == null) return 0;
  return typeof m.Amount === "number" ? m.Amount : parseFloat(m.Amount) || 0;
}

export interface FinanceSummary {
  currency: string;
  revenue: number; // vendas (Principal)
  fees: number; // taxas efetivas (comissão + FBA etc.), valor positivo
  promotions: number; // descontos concedidos, valor positivo
  refunds: number; // reembolsos a clientes, valor positivo
  netProceeds: number; // repasse líquido = receita - taxas - promoções - reembolsos
  orderCount: number;
  feeBreakdown: { type: string; amount: number }[];
}

/**
 * Puxa e agrega os eventos financeiros dos últimos N dias.
 * Operação: listFinancialEvents — GET /finances/v0/financialEvents
 */
export function getFinanceSummary(days: number): Promise<FinanceSummary> {
  return cached(`finance:${days}`, 120_000, () => computeFinanceSummary(days));
}

async function computeFinanceSummary(days: number): Promise<FinanceSummary> {
  const postedAfter = new Date(Date.now() - days * 86_400_000).toISOString();

  let currency = "BRL";
  let revenue = 0;
  let fees = 0;
  let promotions = 0;
  let refunds = 0;
  const orders = new Set<string>();
  const feeMap = new Map<string, number>();

  let nextToken: string | undefined;
  let guard = 0;

  do {
    const query: Record<string, string | number | undefined> = nextToken
      ? { NextToken: nextToken }
      : { PostedAfter: postedAfter, MaxResultsPerPage: 100 };

    const data = await spapiFetch<FinancialEventsResponse>(
      "/finances/v0/financialEvents",
      { query }
    );
    const ev = data.payload?.FinancialEvents;

    for (const s of ev?.ShipmentEventList ?? []) {
      if (s.AmazonOrderId) orders.add(s.AmazonOrderId);
      for (const item of s.ShipmentItemList ?? []) {
        for (const c of item.ItemChargeList ?? []) {
          const amt = n(c.ChargeAmount);
          if (c.ChargeAmount?.CurrencyCode) currency = c.ChargeAmount.CurrencyCode;
          if (c.ChargeType === "Principal") revenue += amt;
        }
        for (const f of item.ItemFeeList ?? []) {
          const amt = n(f.FeeAmount); // normalmente negativo
          fees += -amt;
          feeMap.set(f.FeeType || "Outra", (feeMap.get(f.FeeType || "Outra") || 0) + -amt);
        }
        for (const p of item.PromotionList ?? []) {
          promotions += -n(p.PromotionAmount);
        }
      }
    }

    for (const r of ev?.RefundEventList ?? []) {
      for (const item of r.ShipmentItemAdjustmentList ?? []) {
        for (const c of item.ItemChargeList ?? []) {
          refunds += -n(c.ChargeAmount); // reembolso vem negativo
        }
      }
    }

    nextToken = data.payload?.NextToken;
  } while (nextToken && ++guard < 20);

  const round = (v: number) => +v.toFixed(2);
  const netProceeds = revenue - fees - promotions - refunds;

  return {
    currency,
    revenue: round(revenue),
    fees: round(fees),
    promotions: round(promotions),
    refunds: round(refunds),
    netProceeds: round(netProceeds),
    orderCount: orders.size,
    feeBreakdown: [...feeMap.entries()]
      .map(([type, amount]) => ({ type, amount: round(amount) }))
      .sort((a, b) => b.amount - a.amount),
  };
}
