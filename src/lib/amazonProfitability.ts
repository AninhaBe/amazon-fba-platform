import { cached } from "./cache";
import { costAt, getCosts } from "./costStore";
import { getOrderItems, getOrders } from "./orders";
import { getOrderFinancialsFromTransactions } from "./transactions";
import { allocateByWeight, calculateContribution, type ProfitabilityLine, type ProfitabilityResult } from "./profitability";
import type { Period } from "./period";

function amount(value?: { Amount?: string }): number {
  return Number(value?.Amount ?? 0) || 0;
}

export function getAmazonProfitability(period: Period): Promise<ProfitabilityResult> {
  return cached(`order-profitability:${period.key}`, 5 * 60_000, async () => {
    // Taxas por pedido vêm da Transactions API (a Finances v0 devolve zerado);
    // a receita por item continua vindo do Order Items.
    const [page, orderFinancials, costs] = await Promise.all([
      getOrders({ createdAfter: period.startISO, createdBefore: period.endISO, maxResults: 50 }),
      getOrderFinancialsFromTransactions(period),
      getCosts(),
    ]);
    const orders = page.orders.filter((order) => order.orderStatus !== "Canceled").slice(0, 40);
    const lines: ProfitabilityLine[] = [];

    for (const order of orders) {
      const items = await getOrderItems(order.amazonOrderId);
      // Taxa total do pedido (da Amazon) rateada entre os itens por receita.
      const orderFin = orderFinancials[order.amazonOrderId];
      const itemRevenues = items.map((item) => amount(item.ItemPrice));
      const feeShares = orderFin ? allocateByWeight(orderFin.fees, itemRevenues) : null;
      items.forEach((item, index) => {
        const quantity = item.QuantityOrdered ?? item.QuantityShipped ?? 0;
        // Pedido `Pending` vem SEM `ItemPrice` e sem `OrderTotal` — a Amazon só
        // libera o valor quando envia. `amount()` devolveria 0, e a tela exibia
        // "Venda R$ 0,00", afirmando que a venda não rendeu nada.
        const revenueKnown = item.ItemPrice?.Amount != null;
        // Receita é o que o comprador PAGOU — `ItemPrice` é preço de tabela e
        // `OrderTotal` já vem líquido do cupom (22,11 − 2,21 = 19,90, confirmado
        // na API em 15/08/2026). Mesma definição de `amazonCanonical.ts`, que já
        // fazia certo; este caminho ao vivo é que estava fora do padrão e exibia
        // duas vendas idênticas de R$ 19,90 com margens de 59,16% e 65,73%.
        const listPrice = amount(item.ItemPrice);
        const promotions = amount(item.PromotionDiscount);
        const revenue = Math.max(0, listPrice - promotions);
        const sku = item.SellerSKU ?? null;
        const costEntry = (sku ? costs[sku] : undefined) ?? (item.ASIN ? costs[item.ASIN] : undefined);
        const productCost = costEntry && costEntry.cost > 0 ? costAt(costEntry, order.purchaseDate) * quantity : null;
        const fees = feeShares ? feeShares[index] : null;
        // Frete do comprador LÍQUIDO do que a vendedora bancou. Em frete grátis a
        // Amazon cobra `ShippingPrice` e devolve o mesmo valor em `ShippingDiscount`;
        // somar só o primeiro punha na margem um dinheiro que nunca entrou — a venda
        // de R$ 19,90 aparecia com margem de R$ 21,98, maior que a própria venda.
        const freteLiquido = amount(item.ShippingPrice) - amount(item.ShippingDiscount);
        const buyerShipping = freteLiquido || null;
        const currency = item.ItemPrice?.CurrencyCode || order.orderTotal?.CurrencyCode || orderFin?.currency || "BRL";
        // Sem `promotions` aqui: `revenue` já está líquido dele. Passar os dois
        // descontaria o cupom duas vezes.
        const result = calculateContribution({ revenue, buyerShipping, productCost, marketplaceFees: fees });
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
          revenueKnown,
          currency,
          productCost,
          marketplaceFees: fees,
          buyerShipping,
          sellerShipping: null,
          tax: null,
          listPrice: promotions > 0 ? listPrice : null,
          promotions: promotions || null,
          contribution: result.contribution,
          marginPct: result.marginPct,
          complete: result.complete,
        });
      });
    }
    return {
      lines: lines.sort((a, b) => b.date.localeCompare(a.date)),
      coverage: { completeLines: lines.filter((line) => line.complete).length, totalLines: lines.length },
      scope: { processedOrders: orders.length, completePeriod: !page.nextToken && page.orders.filter((order) => order.orderStatus !== "Canceled").length <= 40 },
    };
  });
}
