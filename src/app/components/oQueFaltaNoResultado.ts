/**
 * O QUE FALTA PARA O RESULTADO E PARA A MARGEM — em numero, nunca em adjetivo.
 *
 * ⚠️ NASCEU DE DOIS TEXTOS QUE MENTIAM (30/08/2026, print da Ana).
 *
 * A tela da Shopee, filtro HOJE, mostrava:
 *   Taxas   R$ 2.770,98  "aguardando fechamento do extrato financeiro"
 *   Margem  —            "aguardando conciliacao completa"
 *
 * As duas frases eram FALSAS. Medido no mesmo instante: 219 de 219 pedidos com
 * tarifa registrada, os cinco componentes financeiros nao-nulos, periodo
 * coberto. Nao havia extrato pendente nem conciliacao aguardando. O que faltava
 * era o custo de TRES unidades de 240 — cadastro que a propria vendedora faz em
 * dois minutos.
 *
 * O preco de mentir assim e concreto: a tela dizia a ela que o problema era da
 * Shopee, quando o problema era dela e resolvivel. Mesma familia do "a Shopee
 * ainda nao postou" que ja foi corrigido por culpar o fornecedor no escuro.
 *
 * Regra da casa (23/08/2026): nao diga "parcial", diga O QUE FALTA, com numero e
 * link. Adjetivo que se desculpa nao vira acao; "3 unidades sem custo
 * cadastrado →" vira.
 *
 * ⚠️ NAO MUDA NUMERO NENHUM. Nenhum valor exibido muda por causa deste arquivo:
 * ele so troca a explicacao de por que um travessao esta ali. A decisao de
 * mostrar margem sobre custo parcial foi avaliada e RECUSADA pelo cerebro em
 * 30/08/2026, e o motivo esta registrado: a pendencia aqui e resolvivel pela
 * vendedora em dois minutos, e nesse caso a resposta certa e apontar a acao, nao
 * estimar por cima. Margem com 3 de 240 unidades sem custo sairia melhor que a
 * verdade, e margem e uma RAZAO — somar parcial informa, dividir por parcial
 * engana.
 */

export interface PendenciaDoResultado {
  /** Texto curto, com numero. Nunca adjetivo. */
  texto: string;
  /** Para onde a vendedora vai resolver, quando ela PODE resolver. */
  href?: string;
}

/**
 * A PRIMEIRA pendencia que segura o resultado, em ordem de quem pode agir.
 *
 * A ordem nao e estetica: o que a vendedora resolve sozinha vem antes do que
 * depende de nos ou do marketplace. Listar tudo de uma vez faria a acao dela
 * competir com informacao que ela nao pode usar.
 */
export function oQueFaltaParaOResultado(estado: {
  unitsWithoutCost: number;
  ordersWithFees: number;
  ordersProcessed: number;
  paidOrders: number;
  hrefDeCustos: string;
}): PendenciaDoResultado | null {
  // 1. Custo: dela, e resolvivel agora.
  if (estado.unitsWithoutCost > 0) {
    return {
      texto: `${estado.unitsWithoutCost} unidade(s) sem custo cadastrado`,
      href: estado.hrefDeCustos,
    };
  }
  // 2. Tarifa que ainda nao chegou: nossa fila, com o tamanho dito.
  if (estado.ordersWithFees < estado.ordersProcessed) {
    return { texto: `tarifa de ${estado.ordersWithFees} de ${estado.ordersProcessed} vendas` };
  }
  // 3. Venda ainda nao detalhada: idem.
  if (estado.ordersProcessed < estado.paidOrders) {
    return { texto: `${estado.ordersProcessed} de ${estado.paidOrders} vendas detalhadas` };
  }
  return null;
}

/**
 * O rodape do card de Taxas. Completo NAO fala em espera; parcial fala com
 * NUMERO, nunca "aguardando fechamento do extrato".
 */
export function rodapeDasTaxas(estado: {
  feesComplete: boolean;
  ordersWithFees: number;
  ordersProcessed: number;
}): string {
  if (estado.feesComplete) return "tarifa de todas as vendas do período";
  return `tarifa de ${estado.ordersWithFees} de ${estado.ordersProcessed} vendas`;
}
