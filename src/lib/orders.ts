import { spapiFetch, defaultMarketplaceId } from "./spapi";
import { cached } from "./cache";
import type { Period } from "./period";
import { normalizeAmazonOrder, type AmazonOrderResponse, type OrderSummary } from "./amazonOrder";
import { getFinanceSummary } from "./finances";
import { collectAllNextTokenPages } from "./nextTokenPagination";

export type { OrderSummary } from "./amazonOrder";

interface GetOrdersResponse {
  payload: {
    Orders: AmazonOrderResponse[];
    NextToken?: string;
    LastUpdatedBefore?: string;
    CreatedBefore?: string;
  };
}

/**
 * Lista pedidos da sua conta desde uma data.
 * Operação: getOrders — GET /orders/v0/orders
 */
export async function getOrders(params: {
  createdAfter: string; // ISO 8601, ex: 2026-06-01T00:00:00Z
  createdBefore?: string; // fim do intervalo (ISO)
  marketplaceId?: string;
  orderStatuses?: string[];
  maxResults?: number;
  nextToken?: string;
}): Promise<{ orders: OrderSummary[]; nextToken?: string }> {
  const {
    createdAfter,
    createdBefore,
    marketplaceId = defaultMarketplaceId(),
    orderStatuses,
    maxResults = 50,
    nextToken,
  } = params;

  const query: Record<string, string | number | undefined> = {
    MarketplaceIds: marketplaceId,
    MaxResultsPerPage: maxResults,
  };
  // NextToken e CreatedAfter são mutuamente exclusivos na SP-API.
  if (nextToken) {
    query.NextToken = nextToken;
  } else {
    query.CreatedAfter = createdAfter;
    if (createdBefore) query.CreatedBefore = createdBefore;
    if (orderStatuses?.length) query.OrderStatuses = orderStatuses.join(",");
  }

  const data = await spapiFetch<GetOrdersResponse>("/orders/v0/orders", { query });
  return {
    orders: (data.payload?.Orders ?? [])
      .map(normalizeAmazonOrder)
      .filter((order): order is OrderSummary => order !== null),
    nextToken: data.payload?.NextToken,
  };
}

interface OrderItemsResponse {
  payload?: {
    OrderItems?: AmazonOrderItem[];
    NextToken?: string;
  };
}

export interface AmazonOrderItem {
  OrderItemId?: string;
  SellerSKU?: string;
  ASIN?: string;
  Title?: string;
  QuantityOrdered?: number;
  QuantityShipped?: number;
  ItemPrice?: { CurrencyCode?: string; Amount?: string };
  ShippingPrice?: { CurrencyCode?: string; Amount?: string };
  /** Parte do frete bancada pela vendedora. Em frete grátis vem igual a `ShippingPrice`. */
  ShippingDiscount?: { CurrencyCode?: string; Amount?: string };
  PromotionDiscount?: { CurrencyCode?: string; Amount?: string };
}

export function getOrderItems(amazonOrderId: string): Promise<AmazonOrderItem[]> {
  return cached(`order-items:${amazonOrderId}`, 5 * 60_000, async () => {
    const pages = await collectAllNextTokenPages(
      (nextToken) => spapiFetch<OrderItemsResponse>(
        `/orders/v0/orders/${encodeURIComponent(amazonOrderId)}/orderItems`,
        { query: nextToken ? { NextToken: nextToken } : undefined }
      ),
      (page) => page.payload?.NextToken
    );
    return pages.flatMap((page) => page.payload?.OrderItems ?? []);
  });
}

export interface SalesVelocity {
  unitsBySku: Record<string, number>; // unidades vendidas por SKU no período
  sales: { sku: string; units: number; purchasedAt: string; revenue?: number }[];
  days: number;
}

/**
 * Calcula unidades enviadas por SKU a partir de todas as linhas financeiras
 * conciliadas no período, sem amostragem de pedidos.
 */
export function getSalesVelocity(params: {
  period: Period;
  marketplaceId?: string;
}): Promise<SalesVelocity> {
  const { period, marketplaceId = defaultMarketplaceId() } = params;
  return cached(`velocity:${period.key}:${marketplaceId}:finance`, 120_000, () =>
    computeSalesVelocity(period)
  );
}

async function computeSalesVelocity(period: Period): Promise<SalesVelocity> {
  const unitsBySku: Record<string, number> = {};
  const sales: SalesVelocity["sales"] = [];
  const finance = await getFinanceSummary(period);
  for (const line of finance.itemLines) {
    if (!line.sku || line.quantity <= 0) continue;
    unitsBySku[line.sku] = (unitsBySku[line.sku] || 0) + line.quantity;
    sales.push({ sku: line.sku, units: line.quantity, purchasedAt: line.postedDate, revenue: line.revenue });
  }

  return { unitsBySku, sales, days: period.days };
}

export interface OrderMetrics {
  totalOrders: number;
  totalRevenue: number;
  currency: string;
  fbaOrders: number;
  pendingItems: number;
}

export function summarizeOrders(orders: OrderSummary[]): OrderMetrics {
  let totalRevenue = 0;
  let currency = "BRL";
  let fbaOrders = 0;
  let pendingItems = 0;

  for (const o of orders) {
    if (o.orderTotal) {
      totalRevenue += parseFloat(o.orderTotal.Amount) || 0;
      currency = o.orderTotal.CurrencyCode;
    }
    if (o.fulfillmentChannel === "AFN") fbaOrders++;
    pendingItems += o.numberOfItemsUnshipped ?? 0;
  }

  return {
    totalOrders: orders.length,
    totalRevenue,
    currency,
    fbaOrders,
    pendingItems,
  };
}
