// Modelo canônico multicanal (ver docs/canonical-schema.md).
// Todo adaptador de canal converge para estes tipos na ingestão; o restante da
// plataforma (lucro, radar, dashboards) nunca vê formatos específicos de canal.

export type CanonicalOrderStatus =
  | "pending"
  | "paid"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "refunded";

/** Status que contam como receita nos dashboards. */
export const REVENUE_STATUSES: ReadonlySet<CanonicalOrderStatus> = new Set([
  "paid",
  "shipped",
  "delivered",
]);

export type CanonicalFeeType =
  | "commission"
  | "shipping_seller"
  | "fulfillment"
  | "payment"
  | "ads"
  | "taxes_withheld"
  | "refund"
  | "other";

export interface CanonicalFee {
  feeType: CanonicalFeeType;
  /** Código original do canal ('sale_fee', 'FBAPerUnitFulfillmentFee', …). */
  providerFeeCode: string;
  /** Positivo = debitado do vendedor; crédito entra negativo. */
  amount: number;
  currency: string;
}

export interface CanonicalOrderItem {
  /**
   * Id do produto no canal. Quando o canal tem variacao, vem COMPOSTO
   * (`<anuncio>::sku:<variacao>`) — o mesmo formato do catalogo, senao a juncao
   * catalogo x venda nao fecha. Ver `variantProductId.ts` e ADR-029.
   */
  externalProductId: string;
  /**
   * Identificador da VARIACAO no canal (`model_id` na Shopee, `sku.id` no
   * TikTok). `null` quando o canal nao tem variacao ou quando o pedido antigo
   * nao trouxe o dado. E a chave ESTAVEL: `sku` textual o vendedor renomeia.
   */
  modelId?: string | null;
  /** seller_sku do canal; nunca assumir único entre canais. */
  sku: string | null;
  title: string;
  qty: number;
  /** Líquido de desconto — é dele que saem margem e lucro. */
  /**
   * Preço unitário praticado. `null` = a fonte ainda não expôs — pedido
   * `Pending` na Amazon devolve o item sem `ItemPrice` (migration 0021).
   *
   * ⚠️ Quem soma `qty * unitPrice` tem de EXCLUIR a linha sem preço, nunca
   * coalescer para zero: zero é o fato "não custou nada", e coalescer recria a
   * mentira que a coluna nullable existe para remover.
   */
  unitPrice: number | null;
  /**
   * Preço de tabela por unidade, antes de promoção. `null` = canal não informa.
   * Guardar as parcelas (e não só o líquido) é o que permite responder "usaram
   * cupom?" sem abrir pedido a pedido no painel do marketplace.
   */
  listPrice?: number | null;
  /** Desconto por unidade. `null` = desconhecido; `0` = houve e foi zero. */
  promotionDiscount?: number | null;
  /** Identificador da campanha, quando o canal informa. */
  promotionIds?: string | null;
}

export interface CanonicalOrder {
  externalOrderId: string;
  status: CanonicalOrderStatus;
  providerStatus: string;
  occurredAt: string;
  closedAt: string | null;
  currency: string;
  /** Soma dos itens (unit_price × qty), sem frete do comprador. */
  /**
   * Receita bruta do pedido. `null` = **desconhecido**, não zero (AGENTS.md).
   * A Amazon omite `OrderTotal` enquanto o pedido está `Pending`; gravar 0 ali
   * afirmaria que a venda não teve receita.
   */
  gross: number | null;
  /**
   * Frete pago pelo comprador. null = ainda desconhecido (ex.: custos do
   * shipment não sincronizados) — diferente de 0 (grátis/sem frete).
   */
  buyerShipping: number | null;
  fulfillment: "platform" | "seller" | null;
  packId: string | null;
  items: CanonicalOrderItem[];
  /** Pode chegar parcial; canais como Amazon/TikTok completam depois. */
  fees: CanonicalFee[];
  raw: unknown;
}

export interface CanonicalProduct {
  externalProductId: string;
  sku: string | null;
  title: string;
  status: "active" | "paused" | "closed";
  providerStatus: string;
  price: number;
  currency: string;
  availableQty: number;
  fulfillment: "platform" | "seller" | null;
  thumbnail: string | null;
  permalink: string | null;
  raw: unknown;
}
