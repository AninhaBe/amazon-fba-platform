export interface ProfitabilityLine {
  id: string;
  orderId: string;
  product: string;
  sku: string | null;
  date: string;
  status: string;
  fulfillment: string | null;
  unitPrice: number;
  quantity: number;
  /**
   * SEMPRE o que o comprador pagou, líquido de cupom — nunca preço de tabela.
   * É a base da margem %, e misturar as duas coisas fazia duas vendas idênticas
   * de R$ 19,90 exibirem 59,16% e 65,73%.
   */
  revenue: number;
  /**
   * `false` quando o marketplace ainda NÃO informou o valor da venda — o caso da
   * Amazon com pedido `Pending`, que omite `ItemPrice` e `OrderTotal` até enviar.
   * Sem isto, `revenue: 0` era exibido como "R$ 0,00", afirmando que a venda não
   * rendeu nada quando o certo é "ainda não sei".
   */
  revenueKnown?: boolean;
  currency: string;
  productCost: number | null;
  marketplaceFees: number | null;
  buyerShipping: number | null;
  buyerShippingIsRevenue?: boolean;
  sellerShipping: number | null;
  netReceived?: number | null;
  tax: number | null;
  /**
   * Preço de tabela, só quando houve desconto. INFORMATIVO — não entra na conta;
   * serve para a tela mostrar de onde veio o abatimento.
   */
  listPrice?: number | null;
  /**
   * Cupom concedido: `listPrice − revenue`. INFORMATIVO, **não é custo** — já
   * está abatido de `revenue`. Somá-lo às deduções desconta o cupom duas vezes.
   */
  promotions?: number | null;
  contribution: number | null;
  marginPct: number | null;
  complete: boolean;
}

export function allocateByWeight(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const positiveWeights = weights.map((weight) => Math.max(0, weight));
  const weightTotal = positiveWeights.reduce((sum, weight) => sum + weight, 0);
  if (weightTotal <= 0) return positiveWeights.map(() => 0);
  const totalCents = Math.round(total * 100);
  const rawShares = positiveWeights.map((weight) => totalCents * weight / weightTotal);
  const cents = rawShares.map(Math.floor);
  const remainder = totalCents - cents.reduce((sum, value) => sum + value, 0);
  const priority = rawShares
    .map((share, index) => ({ index, fraction: share - Math.floor(share) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let index = 0; index < remainder; index += 1) cents[priority[index].index] += 1;
  return cents.map((value) => value / 100);
}

export interface ProfitabilityResult {
  lines: ProfitabilityLine[];
  coverage: { completeLines: number; totalLines: number };
}

export function calculateContribution(input: {
  revenue: number;
  buyerShipping?: number | null;
  productCost: number | null;
  marketplaceFees: number | null;
  sellerShipping?: number | null;
  tax?: number | null;
  // ⚠️ NÃO existe parâmetro `promotions` aqui, e não é esquecimento.
  //
  // `revenue` já é LÍQUIDO de cupom — é o que o comprador pagou. O campo
  // `promotions` de `ProfitabilityLine` é informativo (`listPrice − revenue`),
  // serve para a tela mostrar "Cupom aplicado" e nada mais. Subtraí-lo aqui
  // desconta o cupom DUAS VEZES e corta a margem pela metade.
  //
  // O parâmetro existiu e subtraía. Nenhum caller o passava, então o defeito
  // nunca chegou à tela — mas ficou armado por meses esperando quem lesse o
  // campo da linha e o ligasse aqui de boa-fé (removido em 23/08/2026).
}): { contribution: number | null; marginPct: number | null; complete: boolean } {
  if (input.productCost == null || input.marketplaceFees == null) {
    return { contribution: null, marginPct: null, complete: false };
  }
  const contribution = input.revenue
    + (input.buyerShipping ?? 0)
    - input.productCost
    - input.marketplaceFees
    - (input.sellerShipping ?? 0)
    - (input.tax ?? 0);
  return {
    contribution: +contribution.toFixed(2),
    marginPct: input.revenue > 0 ? +(contribution / input.revenue * 100).toFixed(2) : null,
    complete: true,
  };
}
