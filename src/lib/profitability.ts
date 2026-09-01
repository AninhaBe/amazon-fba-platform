export interface ProfitabilityLine {
  id: string;
  orderId: string;
  product: string;
  sku: string | null;
  date: string;
  status: string;
  fulfillment: string | null;
  /** `null` = a fonte ainda não expôs o preço (pedido `Pending`, migration 0021). */
  unitPrice: number | null;
  quantity: number;
  /**
   * SEMPRE o que o comprador pagou, líquido de cupom — nunca preço de tabela.
   * É a base da margem %, e misturar as duas coisas fazia duas vendas idênticas
   * de R$ 19,90 exibirem 59,16% e 65,73%.
   */
  /** `null` = receita desconhecida — nunca zero. */
  revenue: number | null;
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
  /**
   * A LINHA CARREGA TARIFA ESTIMADA? (ADR-027 Emenda II, 01/09/2026)
   *
   * `true` quando alguma parte de `marketplaceFees` veio da Product Fees API em
   * vez do extrato. A tela usa isto para o selo colado ao número — e o selo é o
   * que nos separa do concorrente, que exibe tarifa de tabela sem marca nenhuma
   * e nunca reconcilia (medido no Gestor Seller em 31/08/2026).
   *
   * ⚠️ `false` NÃO É "tudo oficial": pode ser que a Amazon não tenha postado
   * nada e não tenhamos conseguido estimar. Quem distingue é `marketplaceFees`
   * ser `null` — ausência —, e não este campo.
   */
  feesEstimadas?: boolean;
  /**
   * Quanto da comissão desta linha é estimativa. `null` = a comissão é oficial,
   * ou não há comissão conhecida. Serve para a procedência do tooltip
   * ("comissão R$ X + FBA R$ Y"), com o número que a fonte devolveu.
   */
  comissaoEstimada?: number | null;
  /** Idem para a logística (FBA). Os dois são independentes: a Amazon posta em
   * partes — 95,3% dos pedidos com tarifa real têm comissão e nenhuma logística. */
  fbaEstimada?: number | null;
  /**
   * DE ONDE a estimativa desta linha veio, para a tela poder dizer em vez de
   * pedir confiança. Vem da coluna `source` de `workspace_channel_order_fee_estimates`:
   *
   *  - `observada` — a tarifa que a Amazon JÁ COBROU deste mesmo ASIN no nosso
   *    próprio extrato, normalizada por unidade. É a mais forte: número da fonte,
   *    medido, não publicado nem calculado por nós;
   *  - `product_fees_api` — a Product Fees API respondeu para este pedido;
   *  - `tabela` — percentual publicado pela Amazon para a categoria do produto.
   *
   * `null` = a linha não tem estimativa (a tarifa é oficial, ou não há tarifa).
   *
   * ⚠️ NÃO EXISTE UM VALOR PARA "MÉDIA NOSSA", e a ausência é a regra: média
   * histórica calculada por nós continua proibida pela ADR-027. Se um dia
   * aparecer um `source` que não seja um destes três, a tela deve tratá-lo como
   * desconhecido em vez de exibir o nome cru.
   */
  origemDaTarifa?: string | null;
  /**
   * A data da observação que produziu a estimativa (`YYYY-MM-DD`), só para
   * `origemDaTarifa === "observada"`. É o que torna a procedência VERIFICÁVEL:
   * "a Amazon cobrou isto deste produto em tal dia" é uma afirmação que se
   * confere no extrato, diferente de "estimamos".
   */
  observadaEm?: string | null;
  /**
   * O percentual da categoria, **em FRAÇÃO** — `0.1201` para 12,01%.
   *
   * ⚠️ FRAÇÃO, NÃO PERCENTUAL, e isto é contrato acordado com a Vitrine em
   * 01/09/2026: a conversão acontece num ponto só, na tela. O canônico já
   * emitiu percentual uma vez e a peça formatava cru — teria exibido "0,12%".
   *
   * `null` fora da origem `tabela`: comissão observada e Product Fees vêm em
   * valor absoluto, e dividir pelo preço produziria um percentual que ninguém
   * publicou. Número sem significado é pior que campo vazio.
   */
  percentualDaCategoria?: number | null;
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
  /** `null` = receita ainda desconhecida (pedido `Pending`). Sem ela não há contribuição. */
  revenue: number | null;
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
  // ⚠️ RECEITA DESCONHECIDA ENTRA NA MESMA PORTA QUE CUSTO E TARIFA (31/08/2026).
  //
  // Desde a migration 0021 a linha de um pedido `Pending` chega sem preço. Sem
  // receita não existe contribuição — e tratar `null` como zero produziria uma
  // contribuição NEGATIVA do tamanho do custo, que é pior que não mostrar nada.
  if (input.revenue == null || input.productCost == null || input.marketplaceFees == null) {
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
