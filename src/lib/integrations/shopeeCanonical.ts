import type {
  CanonicalFee,
  CanonicalFeeType,
  CanonicalOrder,
  CanonicalOrderStatus,
  CanonicalProduct,
} from "./canonical";

// Normalização Shopee → canônico (docs/canonical-schema.md).
//
// Funções puras, sem rede: o sync entrega o que já buscou (detalhe do pedido +
// escrow) e aqui só se traduz. Toda a incerteza de mapeamento de campo mora
// NESTE arquivo — quando a primeira loja real conectar e algum nome divergir,
// o ajuste é aqui, não espalhado pelo sync.
//
// Campos conferidos na documentação oficial em 05/08/2026
// (v2.order.get_order_detail e v2.payment.get_escrow_detail).

export interface ShopeeOrderItem {
  item_id?: number;
  model_id?: number;
  item_sku?: string | null;
  model_sku?: string | null;
  item_name?: string;
  model_name?: string | null;
  model_quantity_purchased?: number;
  model_original_price?: number;
  model_discounted_price?: number;
}

export interface ShopeeOrderDetail {
  order_sn: string;
  order_status: string;
  create_time: number;
  update_time?: number;
  pay_time?: number | null;
  currency?: string;
  cod?: boolean;
  region?: string;
  total_amount?: number;
  actual_shipping_fee?: number | null;
  estimated_shipping_fee?: number | null;
  reverse_shipping_fee?: number | null;
  item_list?: ShopeeOrderItem[];
  package_list?: Array<{ shipping_carrier?: string; logistics_status?: string }>;
  fulfillment_flag?: string;
  invoice_data?: unknown;
}

/** Bloco `order_income` de v2.payment.get_escrow_detail. */
export interface ShopeeEscrowIncome {
  escrow_amount?: number;
  buyer_total_amount?: number;
  original_price?: number;
  seller_discount?: number;
  voucher_from_seller?: number;
  buyer_paid_shipping_fee?: number;
  actual_shipping_fee?: number;
  reverse_shipping_fee?: number;
  commission_fee?: number;
  service_fee?: number;
  seller_transaction_fee?: number;
  campaign_fee?: number;
  order_ams_commission_fee?: number;
  escrow_tax?: number;
  seller_return_refund?: number;
  final_escrow_product_gst?: number;
}

export interface ShopeeEscrowDetail {
  order_sn: string;
  order_income?: ShopeeEscrowIncome;
}

export interface ShopeeProductItem {
  item_id: number;
  item_sku?: string | null;
  item_name?: string;
  item_status?: string;
  currency?: string;
  stock_info_v2?: { summary_info?: { total_available_stock?: number } };
  price_info?: Array<{ current_price?: number; original_price?: number; currency?: string }>;
  image?: { image_url_list?: string[] };
  has_model?: boolean;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** epoch em segundos → ISO. */
function fromEpoch(seconds: number | null | undefined): string | null {
  if (!seconds) return null;
  return new Date(seconds * 1000).toISOString();
}

// Status v2 da Shopee → canônico. INVOICE_PENDING é peculiaridade do Brasil:
// o pedido já está pago, só falta a NF-e — por isso conta como receita.
const STATUS_MAP: Record<string, CanonicalOrderStatus> = {
  UNPAID: "pending",
  READY_TO_SHIP: "paid",
  PROCESSED: "paid",
  INVOICE_PENDING: "paid",
  RETRY_SHIP: "paid",
  SHIPPED: "shipped",
  TO_CONFIRM_RECEIVE: "shipped",
  COMPLETED: "delivered",
  IN_CANCEL: "paid",
  CANCELLED: "cancelled",
  TO_RETURN: "refunded",
};

export function canonicalShopeeStatus(providerStatus: string): CanonicalOrderStatus {
  return STATUS_MAP[providerStatus] ?? "pending";
}

/**
 * Taxas do escrow → taxonomia canônica. O código original é preservado em
 * `providerFeeCode` para conferência contra o extrato da Shopee.
 *
 * Sinal: no canônico, positivo = debitado do vendedor. A Shopee já devolve
 * essas taxas como valores positivos a descontar, então o sinal se mantém.
 */
const FEE_MAP: Array<{ field: keyof ShopeeEscrowIncome; type: CanonicalFeeType }> = [
  { field: "commission_fee", type: "commission" },
  { field: "service_fee", type: "commission" },
  { field: "seller_transaction_fee", type: "payment" },
  { field: "actual_shipping_fee", type: "shipping_seller" },
  { field: "reverse_shipping_fee", type: "shipping_seller" },
  { field: "campaign_fee", type: "ads" },
  { field: "order_ams_commission_fee", type: "ads" },
  { field: "escrow_tax", type: "taxes_withheld" },
  { field: "final_escrow_product_gst", type: "taxes_withheld" },
  { field: "seller_return_refund", type: "refund" },
];

export function canonicalShopeeFees(income: ShopeeEscrowIncome, currency: string): CanonicalFee[] {
  const fees: CanonicalFee[] = [];
  for (const { field, type } of FEE_MAP) {
    const value = income[field];
    // undefined = campo não veio (desconhecido). 0 = fato conhecido, mas não
    // vale gravar linha zerada — exceto o frete, cuja ausência muda a leitura
    // de cobertura no dashboard.
    if (value == null) continue;
    if (value === 0 && field !== "actual_shipping_fee") continue;
    fees.push({
      feeType: type,
      providerFeeCode: field,
      amount: round2(Number(value)),
      currency,
    });
  }
  return fees;
}

export interface NormalizeShopeeOrderOptions {
  /**
   * Escrow do pedido. undefined/null = ainda não disponível (a Shopee só fecha
   * o escrow depois do pagamento) → o pedido entra sem tarifa e o dashboard o
   * marca como incompleto, em vez de assumir tarifa zero.
   */
  escrow?: ShopeeEscrowDetail | null;
}

export function normalizeShopeeOrder(
  order: ShopeeOrderDetail,
  { escrow }: NormalizeShopeeOrderOptions = {}
): CanonicalOrder {
  const currency = order.currency ?? "BRL";
  const items = (order.item_list ?? []).map((line) => ({
    externalProductId: String(line.item_id ?? ""),
    // model_sku é o SKU da variação; item_sku é o do anúncio pai.
    sku: line.model_sku || line.item_sku || null,
    title: [line.item_name, line.model_name].filter(Boolean).join(" - ") || String(line.item_id ?? ""),
    qty: line.model_quantity_purchased ?? 1,
    // discounted_price é o efetivamente cobrado; original_price é a lista.
    unitPrice: Number(line.model_discounted_price ?? line.model_original_price ?? 0),
  }));

  const gross = round2(items.reduce((sum, item) => sum + item.unitPrice * item.qty, 0));
  const income = escrow?.order_income;

  return {
    externalOrderId: order.order_sn,
    status: canonicalShopeeStatus(order.order_status),
    providerStatus: order.order_status,
    occurredAt: fromEpoch(order.create_time) ?? new Date().toISOString(),
    closedAt: order.order_status === "COMPLETED" ? fromEpoch(order.update_time) : null,
    currency,
    gross,
    // Frete pago pelo comprador só é confiável pelo escrow; sem ele fica
    // desconhecido (null), nunca zero.
    buyerShipping: income?.buyer_paid_shipping_fee == null
      ? null
      : round2(Number(income.buyer_paid_shipping_fee)),
    // A Shopee não separa fulfillment próprio do vendedor nesse endpoint;
    // package_list traz a transportadora, o que não é a mesma informação.
    fulfillment: null,
    packId: null,
    items,
    fees: income ? canonicalShopeeFees(income, currency) : [],
    raw: order,
  };
}

const PRODUCT_STATUS_MAP: Record<string, CanonicalProduct["status"]> = {
  NORMAL: "active",
  UNLIST: "paused",
  BANNED: "closed",
  DELETED: "closed",
  REVIEWING: "paused",
};

export function normalizeShopeeProduct(product: ShopeeProductItem): CanonicalProduct {
  const price = product.price_info?.[0];
  return {
    externalProductId: String(product.item_id),
    sku: product.item_sku || null,
    title: product.item_name ?? String(product.item_id),
    status: PRODUCT_STATUS_MAP[product.item_status ?? ""] ?? "paused",
    providerStatus: product.item_status ?? "UNKNOWN",
    price: Number(price?.current_price ?? 0),
    currency: price?.currency ?? product.currency ?? "BRL",
    availableQty: product.stock_info_v2?.summary_info?.total_available_stock ?? 0,
    fulfillment: null,
    thumbnail: product.image?.image_url_list?.[0] ?? null,
    permalink: null,
    raw: product,
  };
}
