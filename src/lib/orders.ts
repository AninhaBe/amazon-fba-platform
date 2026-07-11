import { spapiFetch, defaultMarketplaceId } from "./spapi";
import { cached } from "./cache";
import type { Period } from "./period";

export interface OrderSummary {
  amazonOrderId: string;
  purchaseDate: string;
  orderStatus: string;
  fulfillmentChannel?: string; // AFN = FBA, MFN = próprio
  salesChannel?: string;
  numberOfItemsShipped?: number;
  numberOfItemsUnshipped?: number;
  orderTotal?: { CurrencyCode: string; Amount: string };
}

interface GetOrdersResponse {
  payload: {
    Orders: OrderSummary[];
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
    orders: data.payload?.Orders ?? [],
    nextToken: data.payload?.NextToken,
  };
}

interface OrderItemsResponse {
  payload?: {
    OrderItems?: { SellerSKU?: string; ASIN?: string; QuantityOrdered?: number }[];
    NextToken?: string;
  };
}

export interface SalesVelocity {
  unitsBySku: Record<string, number>; // unidades vendidas por SKU no período
  days: number;
}

/**
 * Calcula unidades vendidas por SKU nos últimos N dias (para velocidade de venda).
 * Percorre os pedidos e soma os itens. Ignora pedidos cancelados.
 * Nota: faz 1 chamada de itens por pedido (getOrderItems), então é limitado a
 * maxOrders para respeitar rate limits.
 */
export function getSalesVelocity(params: {
  period: Period;
  marketplaceId?: string;
  maxOrders?: number;
}): Promise<SalesVelocity> {
  const { period, marketplaceId = defaultMarketplaceId(), maxOrders = 100 } = params;
  // Cache/dedupe: profit e radar pedem isso ao mesmo tempo — compartilham 1 chamada.
  return cached(`velocity:${period.key}:${marketplaceId}:${maxOrders}`, 120_000, () =>
    computeSalesVelocity(period, marketplaceId, maxOrders)
  );
}

async function computeSalesVelocity(
  period: Period,
  marketplaceId: string,
  maxOrders: number
): Promise<SalesVelocity> {
  const unitsBySku: Record<string, number> = {};
  let nextToken: string | undefined;
  let processed = 0;
  let guard = 0;

  do {
    const page = await getOrders({
      createdAfter: period.startISO,
      createdBefore: period.endISO,
      marketplaceId,
      orderStatuses: ["Shipped", "Unshipped", "PartiallyShipped"],
      maxResults: 50,
      nextToken,
    });

    for (const order of page.orders) {
      if (processed >= maxOrders) break;
      processed++;
      const data = await spapiFetch<OrderItemsResponse>(
        `/orders/v0/orders/${encodeURIComponent(order.amazonOrderId)}/orderItems`
      );
      for (const it of data.payload?.OrderItems ?? []) {
        const sku = it.SellerSKU;
        if (!sku) continue;
        unitsBySku[sku] = (unitsBySku[sku] || 0) + (it.QuantityOrdered ?? 0);
      }
    }

    nextToken = processed >= maxOrders ? undefined : page.nextToken;
  } while (nextToken && ++guard < 20);

  return { unitsBySku, days: period.days };
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
