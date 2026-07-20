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

export interface AmazonOrderResponse {
  AmazonOrderId?: string;
  PurchaseDate?: string;
  OrderStatus?: string;
  FulfillmentChannel?: string;
  SalesChannel?: string;
  NumberOfItemsShipped?: number;
  NumberOfItemsUnshipped?: number;
  OrderTotal?: { CurrencyCode: string; Amount: string };
  // Mantém compatibilidade com fixtures/sandbox que já estejam normalizados.
  amazonOrderId?: string;
  purchaseDate?: string;
  orderStatus?: string;
  fulfillmentChannel?: string;
  salesChannel?: string;
  numberOfItemsShipped?: number;
  numberOfItemsUnshipped?: number;
  orderTotal?: { CurrencyCode: string; Amount: string };
}

/** Converte o contrato oficial (PascalCase) para o modelo interno do SellerCore. */
export function normalizeAmazonOrder(order: AmazonOrderResponse): OrderSummary | null {
  const amazonOrderId = order.amazonOrderId ?? order.AmazonOrderId;
  const purchaseDate = order.purchaseDate ?? order.PurchaseDate;
  if (!amazonOrderId || !purchaseDate) return null;

  return {
    amazonOrderId,
    purchaseDate,
    orderStatus: order.orderStatus ?? order.OrderStatus ?? "Unknown",
    fulfillmentChannel: order.fulfillmentChannel ?? order.FulfillmentChannel,
    salesChannel: order.salesChannel ?? order.SalesChannel,
    numberOfItemsShipped: order.numberOfItemsShipped ?? order.NumberOfItemsShipped,
    numberOfItemsUnshipped: order.numberOfItemsUnshipped ?? order.NumberOfItemsUnshipped,
    orderTotal: order.orderTotal ?? order.OrderTotal,
  };
}
