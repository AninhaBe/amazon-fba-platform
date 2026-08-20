import { spapiFetch } from "./spapi";
import { cacheScope } from "./accountContext";
import { swr } from "./swr";
import type { Period } from "./period";
import { collectAllNextTokenPages, splitDateRange } from "./nextTokenPagination";

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
  OrderItemId?: string;
  SellerSKU?: string;
  QuantityShipped?: number;
  ItemChargeList?: Charge[];
  ItemFeeList?: Fee[];
  // Em eventos de estorno a SP-API usa as listas de ajuste.
  ItemChargeAdjustmentList?: Charge[];
  ItemFeeAdjustmentList?: Fee[];
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

export type { Money as FinanceMoney, Fee as FinanceFee, ShipmentItem as FinanceShipmentItem };
export interface OrderFinancialEvents {
  ShipmentEventList?: ShipmentEvent[];
  RefundEventList?: RefundEvent[];
}

/**
 * Eventos financeiros de um pedido específico (comissão, tarifas FBA, frete,
 * estornos). Operação: listFinancialEventsByOrderId —
 * GET /finances/v0/orders/{orderId}/financialEvents
 */
export async function getOrderFinancialEvents(amazonOrderId: string): Promise<OrderFinancialEvents> {
  const pages = await collectAllNextTokenPages(
    (nextToken) => spapiFetch<FinancialEventsResponse>(
      `/finances/v0/orders/${encodeURIComponent(amazonOrderId)}/financialEvents`,
      { query: nextToken ? { NextToken: nextToken } : { MaxResultsPerPage: 100 } }
    ),
    (page) => page.payload?.NextToken
  );
  return {
    ShipmentEventList: pages.flatMap((page) => page.payload?.FinancialEvents?.ShipmentEventList ?? []),
    RefundEventList: pages.flatMap((page) => page.payload?.FinancialEvents?.RefundEventList ?? []),
  };
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
  itemLines: FinanceItemLine[];
}

export interface FinanceItemLine {
  orderId: string;
  orderItemId?: string;
  sku?: string;
  postedDate: string;
  quantity: number;
  revenue: number;
  buyerShipping: number;
  fees: number;
  promotions: number;
  currency: string;
}

/**
 * Puxa e agrega os eventos financeiros dos últimos N dias.
 * Operação: listFinancialEvents — GET /finances/v0/financialEvents
 */
export function getFinanceSummary(period: Period): Promise<FinanceSummary> {
  return swr(`finance:${cacheScope()}:${period.key}`, 10 * 60_000, () => computeFinanceSummary(period), {
    awaitIfEmpty: true,
  });
}

async function computeFinanceSummary(period: Period): Promise<FinanceSummary> {
  const postedAfter = period.startISO;
  const postedBefore = period.endISO;

  let currency = "BRL";
  let revenue = 0;
  let fees = 0;
  let promotions = 0;
  let refunds = 0;
  const orders = new Set<string>();
  const feeMap = new Map<string, number>();
  const itemLineMap = new Map<string, FinanceItemLine>();

  const safePostedBefore = new Date(Math.min(new Date(postedBefore).getTime(), Date.now() - 3 * 60_000));
  const ranges = splitDateRange(new Date(postedAfter), safePostedBefore);
  const pages: FinancialEventsResponse[] = [];
  for (const range of ranges) {
    pages.push(...await collectAllNextTokenPages(
      (nextToken) => spapiFetch<FinancialEventsResponse>(
        "/finances/v0/financialEvents",
        {
          query: nextToken
            ? { NextToken: nextToken }
            : { PostedAfter: range.from.toISOString(), PostedBefore: range.to.toISOString(), MaxResultsPerPage: 100 },
        }
      ),
      (page) => page.payload?.NextToken
    ));
  }

  for (const data of pages) {
    const ev = data.payload?.FinancialEvents;

    for (const s of ev?.ShipmentEventList ?? []) {
      if (s.AmazonOrderId) orders.add(s.AmazonOrderId);
      for (const item of s.ShipmentItemList ?? []) {
        const lineKey = `${s.AmazonOrderId || ""}:${item.OrderItemId || item.SellerSKU || ""}`;
        const line = itemLineMap.get(lineKey) ?? {
          orderId: s.AmazonOrderId || "",
          orderItemId: item.OrderItemId,
          sku: item.SellerSKU,
          postedDate: s.PostedDate || postedBefore,
          quantity: 0,
          revenue: 0,
          buyerShipping: 0,
          fees: 0,
          promotions: 0,
          currency,
        };
        line.quantity += item.QuantityShipped ?? 0;
        for (const c of item.ItemChargeList ?? []) {
          const amt = n(c.ChargeAmount);
          if (c.ChargeAmount?.CurrencyCode) {
            currency = c.ChargeAmount.CurrencyCode;
            line.currency = currency;
          }
          if (c.ChargeType === "Principal") {
            revenue += amt;
            line.revenue += amt;
          }
          if (c.ChargeType === "ShippingCharge") line.buyerShipping += amt;
        }
        for (const f of item.ItemFeeList ?? []) {
          const amt = n(f.FeeAmount); // normalmente negativo
          fees += -amt;
          line.fees += -amt;
          feeMap.set(f.FeeType || "Outra", (feeMap.get(f.FeeType || "Outra") || 0) + -amt);
        }
        for (const p of item.PromotionList ?? []) {
          const amount = -n(p.PromotionAmount);
          promotions += amount;
          line.promotions += amount;
        }
        itemLineMap.set(lineKey, line);
      }
    }

    for (const r of ev?.RefundEventList ?? []) {
      for (const item of r.ShipmentItemAdjustmentList ?? []) {
        for (const c of item.ItemChargeList ?? []) {
          refunds += -n(c.ChargeAmount); // reembolso vem negativo
        }
      }
    }

  }

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
    itemLines: [...itemLineMap.values()].map((line) => ({
      ...line,
      revenue: round(line.revenue),
      buyerShipping: round(line.buyerShipping),
      fees: round(line.fees),
      promotions: round(line.promotions),
    })),
  };
}
