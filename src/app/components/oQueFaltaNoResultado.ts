/**
 * O QUE FALTA PARA O RESULTADO — SINAL AO LADO DO NUMERO, NUNCA NO LUGAR DELE.
 *
 * ⚠️ DECISAO DA VENDEDORA, 30/08/2026, revertendo a nossa:
 *
 *   "as 3 unidades sem custo — ISSO NAO PODE EXISTIR. Tem que mostrar a margem
 *    independente de se tem algo nao cadastrado. E se tiver algum SKU sem
 *    cadastrar custo naquele dia ou periodo, basta sinalizar pra cadastrar. Mas
 *    isso nao pode impedir de mostrar a margem parcial. Voce nao precisa tomar
 *    essa responsabilidade de entregar dados errados. O erro e do seller que nao
 *    cadastrou o custo."
 *
 * Antes disso, UMA unidade sem custo apagava lucro, margem e ROI do periodo
 * inteiro. A tela escondia o numero para nao arriscar um numero incompleto — e
 * quem esconde decide pela dona do negocio o que ela pode ver.
 *
 * ⚠️ O NUMERO NUNCA APARECE SOZINHO quando ha pendencia. Isso e condicao, nao
 * enfeite: margem sem custo de um SKU sai MAIOR que a verdade, e numero maior
 * que a verdade sem aviso e a coisa que este projeto passou o dia 29/08 tirando
 * da tela. O sinal fica COLADO no bloco do numero — nao numa faixa do outro lado
 * que ela pode nao olhar.
 *
 * ⚠️ SKU, NAO UNIDADE. Ela cadastra custo por SKU; unidade vendida e consequencia.
 * Medido na UTILEIRA em 30/08: "3 unidades sem custo" eram **2 SKUs** (um vendido
 * duas vezes) — a tela pedia 3 cadastros para um trabalho de 2, inflando em 50%
 * a tarefa dela.
 *
 * ⚠️ DUAS CAUSAS, DUAS FRASES. Custo faltando e responsabilidade dela e ela
 * resolve hoje: chama para acao, com link. Tarifa faltando e a nossa fila ainda
 * drenando e ela nao pode fazer nada: avisa que o numero muda sozinho, sem link
 * — link para o que nao se pode resolver e ruido. Mandar a acao errada e fazer a
 * pessoa trabalhar a toa (a mesma regra ja escrita em `TikTokWorkspaceModel`).
 */

export type TomDoSinal = "acao" | "progresso";

export interface SinalDoResultado {
  chave: "custo" | "tarifa" | "conciliacao";
  /** Numero + o que falta. Nunca adjetivo, nunca "parcial". */
  texto: string;
  /** So existe quando ha o que ela POSSA fazer. */
  href?: string;
  tom: TomDoSinal;
}

export interface EstadoDoResultado {
  /** SKUs distintos vendidos no periodo sem custo cadastrado. Preferido. */
  skusWithoutCost?: number;
  /**
   * Unidades sem custo. Usado SO quando o canal nao consegue contar SKU (a linha
   * de item da TikTok nao carrega sku). Dizer "unidade" quando e unidade e mais
   * honesto que converter em SKU por chute — e a palavra muda no texto.
   */
  unitsWithoutCost?: number;
  /** Pedidos do periodo com tarifa registrada. */
  ordersWithFees?: number;
  /** Pedidos do periodo com detalhe processado. */
  ordersProcessed?: number;
  /** Pedidos pagos do periodo. */
  paidOrders?: number;
  /** Para onde ela vai cadastrar custo, neste canal. */
  hrefDeCustos: string;
}

/**
 * TODOS os sinais, nao o primeiro. Cada linha explica uma PARTE diferente da
 * distancia entre o numero exibido e a verdade — omitir uma esconde metade.
 * Custo vem primeiro por ser o unico que ela pode resolver agora.
 */
export function sinaisDoResultado(estado: EstadoDoResultado): SinalDoResultado[] {
  const sinais: SinalDoResultado[] = [];
  const skus = estado.skusWithoutCost ?? 0;
  const unidades = estado.unitsWithoutCost ?? 0;
  if (skus > 0 || unidades > 0) {
    const texto = skus > 0
      ? `${skus} SKU${skus > 1 ? "s" : ""} sem custo cadastrado`
      : `${unidades} unidade${unidades > 1 ? "s" : ""} sem custo cadastrado`;
    sinais.push({ chave: "custo", texto, href: estado.hrefDeCustos, tom: "acao" });
  }
  const comTarifa = estado.ordersWithFees;
  const processados = estado.ordersProcessed;
  if (comTarifa != null && processados != null && comTarifa < processados) {
    sinais.push({
      chave: "tarifa",
      texto: `tarifa de ${comTarifa} de ${processados} vendas — a margem ainda cai`,
      tom: "progresso",
    });
  }
  const pagos = estado.paidOrders;
  if (processados != null && pagos != null && processados < pagos) {
    sinais.push({
      chave: "conciliacao",
      texto: `${processados} de ${pagos} vendas detalhadas — a margem ainda cai`,
      tom: "progresso",
    });
  }
  return sinais;
}

/**
 * Fica `true` quando ha numero E ha pendencia — ou seja, quando o sinal e
 * OBRIGATORIO. Renderizar o numero com isto `true` e sem sinal e o defeito que
 * o teste tranca.
 */
export function sinalObrigatorio(valor: number | null | undefined, sinais: SinalDoResultado[]): boolean {
  return valor != null && sinais.length > 0;
}

/** O rodape do card de Taxas: completo nao fala em espera; parcial fala com NUMERO. */
export function rodapeDasTaxas(estado: {
  feesComplete: boolean;
  ordersWithFees: number;
  ordersProcessed: number;
}): string {
  if (estado.feesComplete) return "tarifa de todas as vendas do período";
  return `tarifa de ${estado.ordersWithFees} de ${estado.ordersProcessed} vendas`;
}
