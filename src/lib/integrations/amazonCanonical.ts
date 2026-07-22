import type { OrderSummary } from "../amazonOrder";
import type { AmazonOrderItem } from "../orders";
import type { CanonicalOrder, CanonicalOrderItem, CanonicalOrderStatus } from "./canonical";

// Normalização Amazon → canônico (docs/canonical-schema.md). Funções puras.
// O header do pedido chega primeiro (getOrders, rápido); os itens chegam por
// conciliação (getOrderItems é por pedido e rate-limitado). Até os itens
// chegarem, gross usa o OrderTotal como aproximação — ele inclui frete e
// impostos do comprador, e é refinado quando as linhas são aplicadas.

const STATUS_MAP: Record<string, CanonicalOrderStatus> = {
  Pending: "pending",
  PendingAvailability: "pending",
  Unshipped: "paid",
  PartiallyShipped: "shipped",
  Shipped: "shipped",
  InvoiceUnconfirmed: "shipped",
  Canceled: "cancelled",
  Unfulfillable: "cancelled",
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function moneyOf(value?: { Amount?: string }): number {
  const amount = Number(value?.Amount);
  return Number.isFinite(amount) ? amount : 0;
}

export function normalizeAmazonOrderHeader(order: OrderSummary): CanonicalOrder {
  return {
    externalOrderId: order.amazonOrderId,
    status: STATUS_MAP[order.orderStatus] ?? "pending",
    providerStatus: order.orderStatus,
    occurredAt: order.purchaseDate,
    closedAt: null,
    currency: order.orderTotal?.CurrencyCode ?? "BRL",
    gross: round2(moneyOf(order.orderTotal)),
    buyerShipping: null,
    fulfillment: order.fulfillmentChannel === "AFN" ? "platform" : order.fulfillmentChannel === "MFN" ? "seller" : null,
    packId: null,
    items: [],
    fees: [],
    raw: order,
  };
}

export interface NormalizedAmazonItems {
  items: CanonicalOrderItem[];
  /** Receita dos produtos (ItemPrice − promoções), sem frete do comprador. */
  gross: number;
  buyerShipping: number;
  currency: string | null;
}

export function normalizeAmazonOrderItems(orderItems: AmazonOrderItem[]): NormalizedAmazonItems {
  const items: CanonicalOrderItem[] = [];
  let gross = 0;
  let buyerShipping = 0;
  let currency: string | null = null;
  for (const item of orderItems) {
    const qty = item.QuantityOrdered ?? 0;
    if (qty <= 0) continue;
    const revenue = Math.max(0, moneyOf(item.ItemPrice) - moneyOf(item.PromotionDiscount));
    currency = currency ?? item.ItemPrice?.CurrencyCode ?? null;
    gross += revenue;
    buyerShipping += moneyOf(item.ShippingPrice);
    items.push({
      externalProductId: item.ASIN || item.SellerSKU || item.OrderItemId || "desconhecido",
      sku: item.SellerSKU ?? null,
      title: item.Title ?? item.SellerSKU ?? item.ASIN ?? "Item Amazon",
      qty,
      unitPrice: round2(revenue / qty),
    });
  }
  return { items, gross: round2(gross), buyerShipping: round2(buyerShipping), currency };
}
