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
// ⚠️ Ainda NÃO exercitado contra loja real. Quando a primeira conectar, é aqui
// que o ajuste acontece — não no sync.
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
}

export interface TiktokProduct {
  id?: string;
  title?: string;
  status?: string;
  skus?: Array<{
    id?: string;
    seller_sku?: string;
    price?: { sale_price?: string; currency?: string };
    inventory?: Array<{ quantity?: number }>;
  }>;
}

/**
 * Campos do pedido que NUNCA são persistidos. Descartados por nome, de
 * propósito: campo que hoje ninguém lê vira campo copiado sem querer amanhã.
 * Base legal: docs/compliance/personal-information-protection-standard.md.
 */
const CAMPOS_PII = [
  "buyer_avatar",
  "buyer_email",
  "buyer_message",
  "buyer_nickname",
  "cpf",
  "cpf_name",
  "recipient_address",
] as const;

/** Remove PII antes de o pedido bruto ir para a coluna `raw` (jsonb). */
export function sanitizeTiktokOrder(order: TiktokOrder): Record<string, unknown> {
  const copia: Record<string, unknown> = { ...order };
  for (const campo of CAMPOS_PII) delete copia[campo];
  return copia;
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
  return MAPA_STATUS[providerStatus] ?? "pending";
}

/**
 * Agrupa `line_items[]` por SKU para produzir itens canônicos com quantidade.
 * O TikTok emite uma linha por unidade; somar sem agrupar geraria N itens de
 * quantidade 1 e quebraria a leitura de "unidades vendidas por SKU".
 */
export function agruparItens(linhas: TiktokLineItem[]): CanonicalOrderItem[] {
  const porSku = new Map<string, CanonicalOrderItem>();

  for (const linha of linhas) {
    const externalProductId = String(linha.product_id ?? "");
    // A chave é sku_id (identificador do canal); seller_sku é o código do
    // vendedor e é o que casa com o custo cadastrado.
    const chave = `${externalProductId}::${linha.sku_id ?? ""}`;
    const unitPrice = paraNumero(linha.sale_price) ?? paraNumero(linha.original_price) ?? 0;

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
 * Extrato do pedido → taxas canônicas. Sinal: positivo = debitado do vendedor,
 * que é como o TikTok já devolve `fee_and_tax_amount` e `shipping_cost_amount`.
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
    // null = não veio (desconhecido) → não grava linha. Zero do frete é fato
    // relevante ("não houve frete") e entra; zero de comissão não vale linha.
    if (valor == null) continue;
    if (valor === 0 && campo !== "shipping_cost_amount") continue;
    taxas.push({
      feeType: tipo,
      providerFeeCode: campo,
      amount: round2(valor),
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
  const currency = order.payment?.currency
    ?? order.line_items?.[0]?.currency
    ?? statement?.currency
    ?? "BRL";

  const items = agruparItens(order.line_items ?? []);
  const gross = round2(items.reduce((soma, item) => soma + item.unitPrice * item.qty, 0));
  const providerStatus = order.status ?? "";

  return {
    externalOrderId: String(order.id),
    status: canonicalTiktokStatus(providerStatus),
    providerStatus,
    occurredAt: deEpoch(order.create_time) ?? new Date().toISOString(),
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

export function normalizeTiktokProduct(product: TiktokProduct): CanonicalProduct {
  const primeiroSku = product.skus?.[0];
  const providerStatus = product.status ?? "UNKNOWN";
  const disponivel = (product.skus ?? []).reduce(
    (soma, sku) => soma + (sku.inventory ?? []).reduce((s, i) => s + (i.quantity ?? 0), 0),
    0
  );

  return {
    externalProductId: String(product.id ?? ""),
    sku: primeiroSku?.seller_sku ?? null,
    title: product.title ?? String(product.id ?? ""),
    status: MAPA_STATUS_PRODUTO[providerStatus] ?? "paused",
    providerStatus,
    price: paraNumero(primeiroSku?.price?.sale_price) ?? 0,
    currency: primeiroSku?.price?.currency ?? "BRL",
    availableQty: disponivel,
    // Sem resposta real para confirmar como o TikTok expõe fulfillment e
    // vitrine no product/search, ambos ficam desconhecidos em vez de chutados.
    fulfillment: null,
    thumbnail: null,
    permalink: null,
    raw: product,
  };
}
