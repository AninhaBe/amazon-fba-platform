import type {
  CanonicalFee,
  CanonicalFeeType,
  CanonicalOrder,
  CanonicalOrderItem,
  CanonicalOrderStatus,
  CanonicalProduct,
} from "./canonical";

// Mapeamento TikTok Shop → modelo canônico (docs/tiktok-shop-integracao.md).
// Espelha shopeeCanonical.ts: este arquivo é o ÚNICO lugar que conhece o
// formato do TikTok; sync, lucro e dashboards só veem os tipos canônicos.
//
// Escrito contra o OAS oficial (endpoints e versões escolhidos em 07/08):
//   pedidos   GET  /order/202507/orders
//   taxas     GET  /finance/202501/orders/{order_id}/statement_transactions
//   produtos  POST /product/202502/products/search
// Validado contra a loja real Crystal Fancy em 10/08/2026. Status, agrupamento
// por SKU e sinal das taxas observados estão cobertos nos testes do parser.
//
// Três peculiaridades do canal que o mapeamento precisa respeitar:
//
// 1. **Valores monetários vêm como string**, não número. `paraNumero` devolve
//    null quando o campo não veio: desconhecido ≠ zero.
// 2. **`line_items[]` não tem quantidade** — cada linha é UMA unidade. O `qty`
//    canônico sai do agrupamento por `sku_id`.
// 3. **O detalhe do pedido traz PII** (CPF, e-mail, endereço). Nada disso entra
//    no canônico, e o `raw` persistido passa por `sanitizeTiktokOrder`.

/** Item de `line_items[]` — uma unidade vendida, não uma linha agregada. */
export interface TiktokLineItem {
  id?: string;
  product_id?: string;
  product_name?: string;
  sku_id?: string;
  sku_name?: string;
  seller_sku?: string;
  sale_price?: string;
  original_price?: string;
  seller_discount?: string;
  platform_discount?: string;
  currency?: string;
  package_id?: string;
  display_status?: string;
}

/** Bloco `payment` de GET /order/202507/orders. */
export interface TiktokPayment {
  currency?: string;
  sub_total?: string;
  shipping_fee?: string;
  total_amount?: string;
  original_total_product_price?: string;
  seller_discount?: string;
  platform_discount?: string;
  product_tax?: string;
  shipping_fee_tax?: string;
}

export interface TiktokOrder {
  id: string;
  status?: string;
  create_time?: number;
  paid_time?: number;
  delivery_time?: number;
  cancel_time?: number;
  fulfillment_type?: string;
  line_items?: TiktokLineItem[];
  payment?: TiktokPayment;
  packages?: Array<{ id?: string }>;
  [chave: string]: unknown;
}

/** Resposta de GET /finance/202501/orders/{order_id}/statement_transactions. */
export interface TiktokStatement {
  currency?: string;
  revenue_amount?: string;
  fee_and_tax_amount?: string;
  shipping_cost_amount?: string;
  settlement_amount?: string;
  sku_transactions?: Array<{
    product_name?: string;
    quantity?: string;
    revenue_amount?: string;
    fee_tax_amount?: string;
    shipping_cost_amount?: string;
    settlement_amount?: string;
  }>;
  total_count?: number;
  order_create_time?: number;
}

/** Extrato zerado sem transações é placeholder pré-settlement, não tarifa zero. */
export function tiktokStatementSettled(statement: TiktokStatement | null | undefined): boolean {
  if (!statement) return false;
  if ((statement.total_count ?? 0) > 0) return true;
  if ((statement.sku_transactions?.length ?? 0) > 0) return true;
  if ((statement.order_create_time ?? 0) > 0) return true;
  return [
    statement.revenue_amount,
    statement.fee_and_tax_amount,
    statement.shipping_cost_amount,
    statement.settlement_amount,
  ].some((value) => {
    const parsed = paraNumero(value);
    return parsed != null && parsed !== 0;
  });
}

export interface TiktokProduct {
  id?: string;
  title?: string;
  status?: string;
  skus?: Array<{
    id?: string;
    seller_sku?: string;
    price?: { sale_price?: string; tax_exclusive_price?: string; currency?: string };
    inventory?: Array<{ quantity?: number }>;
  }>;
}

export function sanitizeTiktokProduct(product: TiktokProduct): Record<string, unknown> {
  return JSON.parse(JSON.stringify({
    id: product.id,
    title: product.title,
    status: product.status,
    skus: (product.skus ?? []).map((sku) => ({
      id: sku.id,
      seller_sku: sku.seller_sku,
      price: sku.price ? { sale_price: sku.price.sale_price, tax_exclusive_price: sku.price.tax_exclusive_price, currency: sku.price.currency } : undefined,
      inventory: (sku.inventory ?? []).map((entry) => ({ quantity: entry.quantity })),
    })),
  })) as Record<string, unknown>;
}

/**
 * Allowlist exaustiva do que pode entrar em `raw`. Não fazemos sanitização por
 * denylist: campos novos, desconhecidos ou aninhados são descartados por padrão.
 */
export function sanitizeTiktokOrder(order: TiktokOrder): Record<string, unknown> {
  const raw: Record<string, unknown> = {
    id: order.id,
    status: order.status,
    create_time: order.create_time,
    paid_time: order.paid_time,
    delivery_time: order.delivery_time,
    cancel_time: order.cancel_time,
    fulfillment_type: order.fulfillment_type,
  };
  if (order.payment) {
    raw.payment = {
      currency: order.payment.currency,
      sub_total: order.payment.sub_total,
      shipping_fee: order.payment.shipping_fee,
      total_amount: order.payment.total_amount,
      original_total_product_price: order.payment.original_total_product_price,
      seller_discount: order.payment.seller_discount,
      platform_discount: order.payment.platform_discount,
      product_tax: order.payment.product_tax,
      shipping_fee_tax: order.payment.shipping_fee_tax,
    };
  }
  raw.line_items = (order.line_items ?? []).map((item) => ({
    id: item.id,
    product_id: item.product_id,
    product_name: item.product_name,
    sku_id: item.sku_id,
    sku_name: item.sku_name,
    seller_sku: item.seller_sku,
    sale_price: item.sale_price,
    original_price: item.original_price,
    seller_discount: item.seller_discount,
    platform_discount: item.platform_discount,
    currency: item.currency,
    package_id: item.package_id,
    display_status: item.display_status,
  }));
  raw.packages = (order.packages ?? []).map((pkg) => ({ id: pkg.id }));
  return JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
}

function round2(valor: number): number {
  return Math.round(valor * 100) / 100;
}

/** String monetária do TikTok → número. Ausente/ilegível vira null, não zero. */
function paraNumero(valor: string | number | null | undefined): number | null {
  if (valor == null || valor === "") return null;
  const n = typeof valor === "number" ? valor : Number(valor);
  return Number.isFinite(n) ? n : null;
}

function deEpoch(segundos: number | null | undefined): string | null {
  if (!segundos) return null;
  return new Date(segundos * 1000).toISOString();
}

// ⚠️ Estes valores vêm da documentação em prosa do Partner Center, NÃO do
// schema OAS — o OAS declara `status` apenas como string, sem enum. Conferir
// contra a primeira resposta real e corrigir aqui.
const MAPA_STATUS: Record<string, CanonicalOrderStatus> = {
  UNPAID: "pending",
  ON_HOLD: "pending",
  AWAITING_SHIPMENT: "paid",
  PARTIALLY_SHIPPING: "shipped",
  AWAITING_COLLECTION: "paid",
  IN_TRANSIT: "shipped",
  DELIVERED: "delivered",
  COMPLETED: "delivered",
  CANCELLED: "cancelled",
};

export function canonicalTiktokStatus(providerStatus: string): CanonicalOrderStatus {
  const status = MAPA_STATUS[providerStatus];
  if (!status) {
    throw new RangeError(`Status de pedido TikTok ainda não mapeado: ${providerStatus || "(vazio)"}.`);
  }
  return status;
}

/** Recusa payload incompleto antes da persistência canônica. */
export function validateTiktokOrderForSync(order: TiktokOrder): void {
  if (!String(order.id ?? "").trim()) {
    throw new TypeError("Pedido TikTok sem identificador.");
  }
  if (!order.create_time || !Number.isFinite(order.create_time)) {
    throw new TypeError(`Pedido TikTok ${order.id} sem data de criação válida.`);
  }
  canonicalTiktokStatus(order.status ?? "");
}

/**
 * Agrupa `line_items[]` por SKU para produzir itens canônicos com quantidade.
 * O TikTok emite uma linha por unidade; somar sem agrupar geraria N itens de
 * quantidade 1 e quebraria a leitura de "unidades vendidas por SKU".
 */
export function agruparItens(linhas: TiktokLineItem[]): CanonicalOrderItem[] {
  const porSku = new Map<string, CanonicalOrderItem>();

  for (const linha of linhas) {
    const parentProductId = String(linha.product_id ?? "");
    const skuId = String(linha.sku_id ?? "").trim();
    const externalProductId = skuId ? tiktokVariantProductId(parentProductId, skuId) : parentProductId;
    // A chave é sku_id (identificador do canal); seller_sku é o código do
    // vendedor e é o que casa com o custo cadastrado.
    const chave = `${externalProductId}::${linha.sku_id ?? ""}`;
    const unitPrice = paraNumero(linha.sale_price) ?? paraNumero(linha.original_price);
    if (unitPrice == null) {
      throw new TypeError(`Item TikTok ${skuId || parentProductId || "(sem id)"} sem preço comprovável.`);
    }

    const existente = porSku.get(chave);
    if (existente) {
      existente.qty += 1;
      continue;
    }
    porSku.set(chave, {
      externalProductId,
      sku: linha.seller_sku || linha.sku_id || null,
      title: [linha.product_name, linha.sku_name].filter(Boolean).join(" - ")
        || externalProductId,
      qty: 1,
      unitPrice,
    });
  }

  return [...porSku.values()];
}

/**
 * Extrato do pedido → taxas canônicas. Sinal canônico: positivo = debitado do
 * vendedor. A TikTok devolveu os custos com sinal negativo na amostra real.
 *
 * O `settlement_amount` NÃO vira taxa: ele é o resultado, não um custo.
 */
const MAPA_TAXAS: Array<{ campo: keyof TiktokStatement; tipo: CanonicalFeeType }> = [
  { campo: "fee_and_tax_amount", tipo: "commission" },
  { campo: "shipping_cost_amount", tipo: "shipping_seller" },
];

export function canonicalTiktokFees(extrato: TiktokStatement, currency: string): CanonicalFee[] {
  const taxas: CanonicalFee[] = [];
  for (const { campo, tipo } of MAPA_TAXAS) {
    const valor = paraNumero(extrato[campo] as string | undefined);
    // null = não veio (desconhecido) → não grava linha. Zero é um fato conhecido
    // e entra para não ser confundido com uma tarifa ainda indisponível.
    if (valor == null) continue;
    taxas.push({
      feeType: tipo,
      providerFeeCode: campo,
      // ⚠️ O TikTok devolve o que ELE cobra com sinal NEGATIVO — confirmado no
      // extrato real do pedido 583985901599294689 (`fee_and_tax_amount: "-9.13"`
      // sobre `revenue_amount: "23.9"`, fechando em `settlement_amount: "14.77"`).
      // O canônico grava taxa como POSITIVA (positivo = debitado do vendedor),
      // então o sinal é invertido aqui. Sem isso, a comissão somaria ao lucro em
      // vez de subtrair — erro de duas vezes o valor da taxa, para mais.
      amount: round2(Math.abs(valor)),
      currency,
    });
  }
  return taxas;
}

export interface NormalizeTiktokOrderOptions {
  /**
   * Extrato financeiro do pedido. undefined/null = ainda indisponível (o
   * TikTok só fecha depois do settlement) → o pedido entra sem tarifa e o
   * dashboard o marca como incompleto, em vez de assumir tarifa zero.
   */
  statement?: TiktokStatement | null;
}

export function normalizeTiktokOrder(
  order: TiktokOrder,
  { statement }: NormalizeTiktokOrderOptions = {}
): CanonicalOrder {
  validateTiktokOrderForSync(order);
  const currency = order.payment?.currency
    ?? order.line_items?.[0]?.currency
    ?? statement?.currency
    ?? "BRL";

  const items = agruparItens(order.line_items ?? []);
  const itemGross = items.length
    ? items.reduce((soma, item) => soma + item.unitPrice * item.qty, 0)
    : null;
  const paymentGross = paraNumero(order.payment?.sub_total);
  const grossSource = itemGross ?? paymentGross;
  if (grossSource == null) {
    throw new TypeError(`Pedido TikTok ${order.id} sem itens ou subtotal confiável.`);
  }
  const gross = round2(grossSource);
  const providerStatus = order.status ?? "";

  return {
    externalOrderId: String(order.id),
    status: canonicalTiktokStatus(providerStatus),
    providerStatus,
    occurredAt: deEpoch(order.create_time)!,
    closedAt: providerStatus === "COMPLETED"
      ? deEpoch(order.delivery_time)
      : providerStatus === "CANCELLED"
      ? deEpoch(order.cancel_time)
      : null,
    currency,
    gross,
    // Frete pago pelo comprador. Ausente = desconhecido (null), nunca zero.
    buyerShipping: paraNumero(order.payment?.shipping_fee),
    // `fulfillment_type` distingue quem envia; sem resposta real para conferir
    // os valores possíveis, não arriscamos classificar errado.
    fulfillment: null,
    packId: order.packages?.[0]?.id ?? null,
    items,
    fees: statement ? canonicalTiktokFees(statement, currency) : [],
    raw: sanitizeTiktokOrder(order),
  };
}

const MAPA_STATUS_PRODUTO: Record<string, CanonicalProduct["status"]> = {
  ACTIVATE: "active",
  DRAFT: "paused",
  PENDING: "paused",
  FAILED: "paused",
  SELLER_DEACTIVATED: "paused",
  PLATFORM_DEACTIVATED: "paused",
  FREEZE: "paused",
  DELETED: "closed",
};

export function canonicalTiktokProductStatus(providerStatus: string): CanonicalProduct["status"] {
  const status = MAPA_STATUS_PRODUTO[providerStatus];
  if (!status) {
    throw new RangeError(`Status de produto TikTok ainda não mapeado: ${providerStatus || "(vazio)"}.`);
  }
  return status;
}

export function tiktokVariantProductId(productId: string, skuId: string): string {
  return `${productId}::sku:${skuId}`;
}

/**
 * Uma oferta canônica por variação. A PK do catálogo é
 * `external_product_id`, portanto usar apenas o product_id faria uma variação
 * sobrescrever a outra (ou, pior, associaria o estoque agregado ao primeiro
 * SKU). O identificador composto é determinístico e o product_id pai continua
 * preservado no raw sanitizado.
 */
export function normalizeTiktokProducts(product: TiktokProduct): CanonicalProduct[] {
  const productId = String(product.id ?? "").trim();
  if (!productId) throw new TypeError("Produto TikTok sem identificador.");
  const providerStatus = product.status ?? "UNKNOWN";
  const raw = sanitizeTiktokProduct(product);
  const skus = product.skus ?? [];
  if (!skus.length) {
    throw new TypeError(`Produto TikTok ${productId} sem variações; preço e estoque não podem ser inferidos.`);
  }
  return skus.map((sku, index) => {
    const skuId = String(sku.id ?? "").trim();
    if (!skuId) throw new TypeError(`Produto TikTok ${productId} possui variação sem identificador.`);
    // product/search 202502 respondeu `tax_exclusive_price` na loja BR real.
    const price = paraNumero(sku.price?.sale_price) ?? paraNumero(sku.price?.tax_exclusive_price);
    if (price == null) throw new TypeError(`Variação TikTok ${skuId} sem preço conhecido.`);
    if (!sku.inventory?.length || sku.inventory.some((item) => !Number.isFinite(item.quantity))) {
      throw new TypeError(`Variação TikTok ${skuId} sem estoque conhecido.`);
    }
    const availableQty = sku.inventory.reduce((total, item) => total + item.quantity!, 0);
    return {
      externalProductId: tiktokVariantProductId(productId, skuId),
      sku: sku.seller_sku || skuId,
      title: skus.length > 1 ? `${product.title ?? productId} · ${sku.seller_sku || `Variação ${index + 1}`}` : (product.title ?? productId),
      status: canonicalTiktokProductStatus(providerStatus), providerStatus,
      price,
      currency: sku.price?.currency ?? "BRL",
      availableQty, fulfillment: null, thumbnail: null, permalink: null, raw,
    };
  });
}

/** Compatibilidade para consumidores antigos; somente produtos mono-SKU. */
export function normalizeTiktokProduct(product: TiktokProduct): CanonicalProduct {
  const normalized = normalizeTiktokProducts(product);
  if (normalized.length !== 1) {
    throw new TypeError(`Produto TikTok ${product.id ?? ""} possui múltiplas variações; use normalizeTiktokProducts.`);
  }
  return normalized[0];
}
