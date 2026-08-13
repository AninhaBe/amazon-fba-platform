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

/**
 * Allowlist do payload Shopee persistido no canônico. Endereço, comprador,
 * telefone e documentos fiscais nunca entram em `raw`, mesmo que a API passe
 * a devolvê-los por padrão em algum endpoint.
 */
export function sanitizeShopeeOrder(order: ShopeeOrderDetail): Record<string, unknown> {
  return JSON.parse(JSON.stringify({
    order_sn: order.order_sn,
    order_status: order.order_status,
    create_time: order.create_time,
    update_time: order.update_time,
    pay_time: order.pay_time,
    currency: order.currency,
    cod: order.cod,
    region: order.region,
    total_amount: order.total_amount,
    actual_shipping_fee: order.actual_shipping_fee,
    estimated_shipping_fee: order.estimated_shipping_fee,
    reverse_shipping_fee: order.reverse_shipping_fee,
    fulfillment_flag: order.fulfillment_flag,
    item_list: (order.item_list ?? []).map((item) => ({
      item_id: item.item_id,
      model_id: item.model_id,
      item_sku: item.item_sku,
      model_sku: item.model_sku,
      item_name: item.item_name,
      model_name: item.model_name,
      model_quantity_purchased: item.model_quantity_purchased,
      model_original_price: item.model_original_price,
      model_discounted_price: item.model_discounted_price,
    })),
    package_list: (order.package_list ?? []).map((pkg) => ({
      shipping_carrier: pkg.shipping_carrier,
      logistics_status: pkg.logistics_status,
    })),
  })) as Record<string, unknown>;
}

export function sanitizeShopeeProduct(product: ShopeeProductItem): Record<string, unknown> {
  return JSON.parse(JSON.stringify({
    item_id: product.item_id,
    item_sku: product.item_sku,
    item_name: product.item_name,
    item_status: product.item_status,
    currency: product.currency,
    stock_info_v2: product.stock_info_v2 ? {
      summary_info: product.stock_info_v2.summary_info ? {
        total_available_stock: product.stock_info_v2.summary_info.total_available_stock,
      } : undefined,
    } : undefined,
    price_info: (product.price_info ?? []).map((price) => ({
      current_price: price.current_price,
      original_price: price.original_price,
      currency: price.currency,
    })),
    image: product.image ? { image_url_list: product.image.image_url_list } : undefined,
    has_model: product.has_model,
  })) as Record<string, unknown>;
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
  const status = STATUS_MAP[providerStatus];
  if (!status) throw new Error(`Status de pedido Shopee desconhecido: ${providerStatus || "ausente"}.`);
  return status;
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
  const status = canonicalShopeeStatus(order.order_status);
  const occurredAt = requiredEpoch(order.create_time, "create_time", order.order_sn);
  const revenueBearing = ["READY_TO_SHIP", "PROCESSED", "INVOICE_PENDING", "RETRY_SHIP", "SHIPPED", "TO_CONFIRM_RECEIVE", "COMPLETED", "IN_CANCEL"].includes(order.order_status);
  if (revenueBearing && !order.item_list?.length) {
    throw new Error(`Pedido Shopee ${order.order_sn} pago sem item_list; receita não pode ser inferida.`);
  }
  const items = (order.item_list ?? []).map((line) => ({
    externalProductId: requiredIdentity(line.item_id, "item_id", order.order_sn),
    // model_sku é o SKU da variação; item_sku é o do anúncio pai.
    sku: line.model_sku || line.item_sku || null,
    title: [line.item_name, line.model_name].filter(Boolean).join(" - ") || String(line.item_id ?? ""),
    qty: requiredPositive(line.model_quantity_purchased, "model_quantity_purchased", order.order_sn),
    // discounted_price é o efetivamente cobrado; original_price é a lista.
    unitPrice: requiredNonNegative(line.model_discounted_price ?? line.model_original_price, "model_discounted_price", order.order_sn),
  }));

  const gross = round2(items.reduce((sum, item) => sum + item.unitPrice * item.qty, 0));
  const income = escrow?.order_income;

  return {
    externalOrderId: order.order_sn,
    status,
    providerStatus: order.order_status,
    occurredAt,
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
    raw: sanitizeShopeeOrder(order),
  };
}

function requiredNonNegative(value: number | null | undefined, field: string, identity: string): number {
  if (value == null || !Number.isFinite(Number(value)) || Number(value) < 0) {
    throw new Error(`Shopee não informou ${field} válido para ${identity}; zero não será fabricado.`);
  }
  return Number(value);
}

function requiredPositive(value: number | null | undefined, field: string, identity: string): number {
  const parsed = requiredNonNegative(value, field, identity);
  if (parsed <= 0) throw new Error(`Shopee não informou ${field} positivo para ${identity}.`);
  return parsed;
}

function requiredIdentity(value: number | string | null | undefined, field: string, identity: string): string {
  const parsed = String(value ?? "").trim();
  if (!parsed) throw new Error(`Shopee não informou ${field} válido para ${identity}.`);
  return parsed;
}

function requiredEpoch(value: number | null | undefined, field: string, identity: string): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Shopee não informou ${field} válido para ${identity}; data atual não será fabricada.`);
  }
  const date = new Date(value * 1000);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`Shopee não informou ${field} válido para ${identity}; data atual não será fabricada.`);
  }
  return date.toISOString();
}

const PRODUCT_STATUS_MAP: Record<string, CanonicalProduct["status"]> = {
  NORMAL: "active",
  UNLIST: "paused",
  BANNED: "closed",
  DELETED: "closed",
  REVIEWING: "paused",
};

export function normalizeShopeeProduct(product: ShopeeProductItem): CanonicalProduct {
  const externalProductId = requiredIdentity(product.item_id, "item_id", "produto");
  const providerStatus = product.item_status ?? "";
  const status = PRODUCT_STATUS_MAP[providerStatus];
  if (!status) throw new Error(`Status de produto Shopee desconhecido: ${providerStatus || "ausente"}.`);
  const price = product.price_info?.[0];
  const currentPrice = requiredNonNegative(price?.current_price, "price_info.current_price", String(product.item_id));
  const availableQty = requiredNonNegative(
    product.stock_info_v2?.summary_info?.total_available_stock,
    "stock_info_v2.summary_info.total_available_stock",
    String(product.item_id)
  );
  return {
    externalProductId,
    sku: product.item_sku || null,
    title: product.item_name ?? String(product.item_id),
    status,
    providerStatus,
    price: currentPrice,
    currency: price?.currency ?? product.currency ?? "BRL",
    availableQty,
    fulfillment: null,
    thumbnail: product.image?.image_url_list?.[0] ?? null,
    permalink: null,
    raw: sanitizeShopeeProduct(product),
  };
}
