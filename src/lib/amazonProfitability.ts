import { cached } from "./cache";
import { costAt, getCosts } from "./costStore";
import { getFinanceSummary } from "./finances";
import { getOrderItems, getOrders } from "./orders";
import type { Period } from "./period";
import { calculateContribution, type ProfitabilityLine, type ProfitabilityResult } from "./profitability";

function amount(value?: { Amount?: string }): number {
  return Number(value?.Amount ?? 0) || 0;
}

export function getAmazonProfitability(period: Period): Promise<ProfitabilityResult> {
  return cached(`order-profitability:${period.key}`, 5 * 60_000, async () => {
    const [page, finance, costs] = await Promise.all([
      getOrders({ createdAfter: period.startISO, createdBefore: period.endISO, maxResults: 50 }),
      getFinanceSummary(period),
      getCosts(),
    ]);
    const orders = page.orders.filter((order) => order.orderStatus !== "Canceled").slice(0, 40);
    const lines: ProfitabilityLine[] = [];

    for (const order of orders) {
      const items = await getOrderItems(order.amazonOrderId);
      for (const item of items) {
        const quantity = item.QuantityOrdered ?? item.QuantityShipped ?? 0;
        const revenue = amount(item.ItemPrice);
        const sku = item.SellerSKU ?? null;
        const costEntry = (sku ? costs[sku] : undefined) ?? (item.ASIN ? costs[item.ASIN] : undefined);
        const productCost = costEntry && costEntry.cost > 0 ? costAt(costEntry, order.purchaseDate) * quantity : null;
        const financial = (finance.itemLines ?? []).find((line) =>
          line.orderId === order.amazonOrderId && (
            (item.OrderItemId && line.orderItemId === item.OrderItemId) ||
            (!item.OrderItemId && sku && line.sku === sku) ||
            (sku && line.sku === sku)
          )
        );
        const fees = financial?.fees ?? null;
        const buyerShipping = financial?.buyerShipping ?? (amount(item.ShippingPrice) || null);
        const promotions = financial?.promotions ?? amount(item.PromotionDiscount);
        const result = calculateContribution({ revenue, buyerShipping, productCost, marketplaceFees: fees, promotions });
        lines.push({
          id: `${order.amazonOrderId}:${item.OrderItemId || sku || item.ASIN || lines.length}`,
          orderId: order.amazonOrderId,
          product: item.Title || sku || item.ASIN || "Produto sem identificação",
          sku,
          date: order.purchaseDate,
          status: order.orderStatus,
          fulfillment: order.fulfillmentChannel === "AFN" ? "FBA" : order.fulfillmentChannel === "MFN" ? "Próprio" : null,
          unitPrice: quantity > 0 ? revenue / quantity : revenue,
          quantity,
          revenue,
          currency: item.ItemPrice?.CurrencyCode || order.orderTotal?.CurrencyCode || finance.currency,
          productCost,
          marketplaceFees: fees,
          buyerShipping,
          sellerShipping: null,
          tax: null,
          contribution: result.contribution,
          marginPct: result.marginPct,
          complete: result.complete,
        });
      }
    }
    return {
      lines: lines.sort((a, b) => b.date.localeCompare(a.date)),
      coverage: { completeLines: lines.filter((line) => line.complete).length, totalLines: lines.length },
    };
  });
}
