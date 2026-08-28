import type {
  CanonicalFee,
  CanonicalOrder,
  CanonicalOrderStatus,
  CanonicalProduct,
} from "./canonical";
import type {
  MercadoLivreOrder,
  MercadoLivreProduct,
  MercadoLivreShipmentCosts,
} from "./mercadoLivre";

// Normalização Mercado Livre → canônico (docs/canonical-schema.md).
// Funções puras: recebem o que o sync já tem em mãos (pedido + custos do
// shipment) e nunca chamam rede — o backfill reprocessa payloads salvos.

const STATUS_MAP: Record<string, CanonicalOrderStatus> = {
  paid: "paid",
  partially_paid: "paid",
  // Reembolso PARCIAL não muda o estágio do pedido (docs/canonical-schema.md:
  // "Status único"): a receita aconteceu e o estorno entra como fee `refund`.
  // Sem esta linha o pedido caía no default `pending` e R$ 2.213 de receita
  // real de 34 pedidos ficavam FORA do faturamento (medido em 28/08/2026).
  partially_refunded: "paid",
  confirmed: "pending",
  payment_required: "pending",
  payment_in_process: "pending",
  cancelled: "cancelled",
  invalid: "cancelled",
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function canonicalOrderStatus(order: MercadoLivreOrder): CanonicalOrderStatus {
  const base = STATUS_MAP[order.status] ?? "pending";
  // O ML não expõe envio/entrega no status do pedido; as tags cobrem isso.
  if (base === "paid" && order.tags?.includes("delivered")) return "delivered";
  return base;
}

/**
 * Custos de um shipment sob a ótica do vendedor. Mesma regra do overview:
 * custo do sender da conta; sem match, soma de todos os senders.
 */
export function canonicalShipmentCosts(
  shipment: MercadoLivreShipmentCosts,
  sellerId: string
): { sellerShipping: number; buyerShipping: number } {
  const accountSender = shipment.senders?.find((sender) => String(sender.user_id) === sellerId);
  const sellerCost = Number(
    accountSender?.cost
      ?? shipment.senders?.reduce((sum, sender) => sum + Number(sender.cost ?? 0), 0)
      ?? 0
  );
  return {
    sellerShipping: round2(sellerCost),
    buyerShipping: round2(Number(shipment.receiver?.cost ?? 0)),
  };
}

export interface NormalizeMercadoLivreOrderOptions {
  /**
   * Custos do shipment do pedido (GET /shipments/:id/costs). undefined/null =
   * ainda não sincronizado → frete fica desconhecido (null), não zero.
   */
  shipment?: MercadoLivreShipmentCosts | null;
  /** externalAccountId da conexão, para achar o sender da conta. */
  sellerId: string;
}

export function normalizeMercadoLivreOrder(
  order: MercadoLivreOrder,
  { shipment, sellerId }: NormalizeMercadoLivreOrderOptions
): CanonicalOrder {
  const currency = order.currency_id;
  const items = order.order_items.map((line) => ({
    externalProductId: line.item.id,
    sku: line.item.seller_sku ?? null,
    title: line.item.title,
    qty: line.quantity,
    unitPrice: line.unit_price,
  }));
  const gross = round2(
    order.order_items.reduce((sum, line) => sum + line.unit_price * line.quantity, 0)
  );

  const fees: CanonicalFee[] = [];
  // sale_fee null = tarifa ainda desconhecida. Só emitimos a comissão quando
  // todas as linhas a informam; a ausência da linha é o que marca o pedido
  // como "não processado" na cobertura de lucro.
  if (order.order_items.every((line) => line.sale_fee != null)) {
    fees.push({
      feeType: "commission",
      providerFeeCode: "sale_fee",
      amount: round2(
        order.order_items.reduce((sum, line) => sum + (line.sale_fee ?? 0) * line.quantity, 0)
      ),
      currency,
    });
  }

  let buyerShipping: number | null = null;
  if (shipment) {
    const costs = canonicalShipmentCosts(shipment, sellerId);
    // 0 também é fato ("vendedor não pagou frete") — a presença da linha é o
    // que distingue "conhecido" de "ainda não sincronizado".
    fees.push({
      feeType: "shipping_seller",
      providerFeeCode: "shipment_sender_cost",
      amount: costs.sellerShipping,
      currency,
    });
    buyerShipping = costs.buyerShipping;
  } else if (order.shipping?.id == null) {
    // Pedido sem shipment (retirada, acordo direto): frete conhecido e zero —
    // diferente de "shipment existe mas os custos ainda não sincronizaram".
    fees.push({ feeType: "shipping_seller", providerFeeCode: "no_shipment", amount: 0, currency });
    buyerShipping = 0;
  }

  return {
    externalOrderId: String(order.id),
    status: canonicalOrderStatus(order),
    providerStatus: order.status,
    occurredAt: order.date_created,
    closedAt: order.date_closed ?? null,
    currency,
    gross,
    buyerShipping,
    fulfillment: order.tags?.includes("fulfilled") ? "platform" : null,
    packId: order.pack_id == null ? null : String(order.pack_id),
    items,
    fees,
    raw: order,
  };
}

const PRODUCT_STATUS_MAP: Record<string, CanonicalProduct["status"]> = {
  active: "active",
  paused: "paused",
  closed: "closed",
};

export function normalizeMercadoLivreProduct(product: MercadoLivreProduct): CanonicalProduct {
  return {
    externalProductId: product.id,
    sku: product.sku,
    title: product.title,
    status: PRODUCT_STATUS_MAP[product.status] ?? "paused",
    providerStatus: product.status,
    price: product.price,
    currency: product.currency,
    availableQty: product.availableQuantity,
    fulfillment:
      product.logisticType == null
        ? null
        : product.logisticType === "fulfillment"
          ? "platform"
          : "seller",
    thumbnail: product.thumbnail,
    permalink: product.permalink,
    raw: product,
  };
}
