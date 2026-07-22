import type { OrderSummary } from "../amazonOrder";
import type { AmazonOrderItem } from "../orders";
import type { FinanceFee, FinanceMoney, OrderFinancialEvents } from "../finances";
import type { CanonicalFee, CanonicalFeeType, CanonicalOrder, CanonicalOrderItem, CanonicalOrderStatus } from "./canonical";

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

// Taxonomia canônica (docs/canonical-schema.md). O código original do FeeType
// sempre vai em provider_fee_code; aqui só se decide a categoria.
function feeTypeOf(providerFeeType: string): CanonicalFeeType {
  if (providerFeeType === "Commission") return "commission";
  if (providerFeeType === "RefundCommission") return "refund";
  if (providerFeeType.startsWith("FBA")) return "fulfillment";
  if (providerFeeType.startsWith("Shipping")) return "shipping_seller";
  if (providerFeeType.includes("Tax")) return "taxes_withheld";
  return "other";
}

function financeAmount(money?: FinanceMoney): number {
  const amount = Number(money?.Amount);
  return Number.isFinite(amount) ? amount : 0;
}

/**
 * Converte os eventos financeiros de UM pedido em fees canônicas agregadas por
 * (fee_type, provider_fee_code). Na Finances API, cobrança vem negativa;
 * no canônico, positivo = debitado do vendedor — por isso o sinal inverte.
 * Estornos de principal entram como fee `refund` (valor devolvido ao cliente);
 * ajustes de tarifa em estornos entram na própria categoria, como crédito.
 */
export function normalizeAmazonFinanceFees(
  events: OrderFinancialEvents,
  currency = "BRL"
): CanonicalFee[] {
  const totals = new Map<string, CanonicalFee>();
  const add = (feeType: CanonicalFeeType, providerFeeCode: string, amount: number) => {
    if (amount === 0) return;
    const key = `${feeType}:${providerFeeCode}`;
    const current = totals.get(key) ?? { feeType, providerFeeCode, amount: 0, currency };
    current.amount = round2(current.amount + amount);
    totals.set(key, current);
  };
  const addFees = (fees: FinanceFee[] | undefined) => {
    for (const fee of fees ?? []) {
      const code = fee.FeeType ?? "desconhecido";
      add(feeTypeOf(code), code, -financeAmount(fee.FeeAmount));
    }
  };

  for (const event of events.ShipmentEventList ?? []) {
    for (const item of event.ShipmentItemList ?? []) addFees(item.ItemFeeList);
  }
  for (const event of events.RefundEventList ?? []) {
    for (const item of event.ShipmentItemAdjustmentList ?? []) {
      addFees(item.ItemFeeAdjustmentList ?? item.ItemFeeList);
      for (const charge of item.ItemChargeAdjustmentList ?? item.ItemChargeList ?? []) {
        // Principal devolvido chega negativo; a fee refund registra o débito.
        if (charge.ChargeType === "Principal") add("refund", "RefundPrincipal", -financeAmount(charge.ChargeAmount));
      }
    }
  }
  return [...totals.values()].filter((fee) => fee.amount !== 0);
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
