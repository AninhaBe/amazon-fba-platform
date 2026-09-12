import { amazonTaxAmount } from "./amazonSettings";

/**
 * LUCRO POR DIA da Amazon — a parte PURA, separada do produtor de propósito:
 * é ela que os testes exercitam com valores fabricados dos dois lados de cada
 * fronteira (dia completo, dia com pedido sem valor, dia depois do `ateDia`,
 * dia só de estorno), como manda a regra da casa.
 *
 * Contrato fechado com a Vitrine em 12/09/2026:
 *   - `profit: number | null` com a semântica do v3 do ML: 0 é fato, null é
 *     "não apurável" e vira contorno;
 *   - `profitEstimated: true` quando a tarifa do dia inclui estimativa ADR-027;
 *   - `refunds` presente quando houve estorno POSTADO no dia (> 0), para a
 *     dica explicar barra derrubada por venda de semanas atrás.
 */

export interface PontoDiario {
  date: string;
  revenue: number;
  orders: number;
  units: number;
}

export interface PontoDiarioComLucro extends PontoDiario {
  profit: number | null;
  profitEstimated?: boolean;
  refunds?: number;
}

/** O recorte por pedido que o produtor já monta para o resultado do período. */
export interface PedidoDoDia {
  dia: string;
  /** Valor publicado pela Amazon; `null` = ainda não publicou. */
  valor: number | null;
  /** Preço de tabela acumulado das linhas com estimativa (0 = nenhum). */
  tabela: number;
  /** Tarifa efetiva (real ou estimada); `null` = nenhuma linha na view. */
  tarifa: number | null;
  custo: number;
  temCusto: boolean;
  tarifaEstimada: boolean;
}

export interface JanelaDeAnuncio {
  /** O anúncio já veio como tarifa no extrato — gasto por fora vale 0, fato. */
  jaNoExtrato: boolean;
  /** Primeiro dia com métrica na conta. `null` = canal nunca anunciou. */
  primeiroDia: string | null;
  /** Último dia com métrica DENTRO do período. */
  ateDia: string | null;
  gastoPorDia: Record<string, number>;
}

/**
 * Gasto de anúncio de UM dia. `null` = desconhecido — nunca zero otimista.
 * Espelha a semântica de `anuncioDoCanal` no grão do dia: antes da primeira
 * coleta não havia o que saber (0, fato); dentro da janela coletada, dia sem
 * linha é 0 (o SUM do período já afirma isso); depois do último dia coletado,
 * desconhecido.
 */
export function gastoDeAnuncioDoDia(janela: JanelaDeAnuncio, date: string): number | null {
  if (janela.jaNoExtrato) return 0;
  if (janela.primeiroDia == null) return 0;
  if (date < janela.primeiroDia) return 0;
  if (janela.ateDia != null && date <= janela.ateDia) return janela.gastoPorDia[date] ?? 0;
  return null;
}

export function lucroPorDiaDaAmazon(entrada: {
  pontos: PontoDiario[];
  pedidos: Iterable<PedidoDoDia>;
  /** Estorno POSTADO por dia (data do lançamento, não do pedido). */
  estornoPorDia: Map<string, number>;
  anuncio: JanelaDeAnuncio;
  /** Alíquota ADR-038: ausente = imposto 0 com rastro em `taxRateKnown` — a
   *  regra DESTE canal, não a do ML (que anula o dia). */
  taxRate: number | null;
}): PontoDiarioComLucro[] {
  const porDia = new Map<string, { receita: number; tarifa: number; custo: number; pedidos: number; completos: number; temEstimativa: boolean }>();
  for (const pedido of entrada.pedidos) {
    const alvo = porDia.get(pedido.dia) ?? { receita: 0, tarifa: 0, custo: 0, pedidos: 0, completos: 0, temEstimativa: false };
    alvo.pedidos += 1;
    // A MESMA regra de coerência do resultado do período, no recorte do dia:
    // valor publicado ou preço de tabela, tarifa efetiva e custo completo.
    const receita = pedido.valor != null ? pedido.valor : (pedido.tabela > 0 ? pedido.tabela : null);
    if (pedido.temCusto && pedido.tarifa != null && receita != null) {
      alvo.completos += 1;
      alvo.receita += receita;
      alvo.tarifa += pedido.tarifa;
      alvo.custo += pedido.custo;
      if (pedido.tarifaEstimada) alvo.temEstimativa = true;
    }
    porDia.set(pedido.dia, alvo);
  }

  return entrada.pontos.map((ponto) => {
    const dia = porDia.get(ponto.date);
    const estorno = entrada.estornoPorDia.get(ponto.date) ?? 0;
    const ads = gastoDeAnuncioDoDia(entrada.anuncio, ponto.date);
    const extra = estorno > 0 ? { refunds: +estorno.toFixed(2) } : {};
    // Anúncio desconhecido anula o dia inteiro — inclusive o dia sem venda,
    // que pode ter gasto. Mesma razão do período (descontarAnuncio).
    if (ads == null) return { ...ponto, profit: null, ...extra };
    if (!dia || dia.pedidos === 0) {
      // Dia sem venda: receita zero é FATO — menos o que saiu no dia (anúncio,
      // estorno postado). Sem nada disso, lucro 0, como no ML.
      return { ...ponto, profit: +(0 - ads - estorno).toFixed(2), ...extra };
    }
    // UM pedido do dia fora da coerência (sem valor, sem tarifa ou com unidade
    // sem custo) torna o dia não apurável: somar só os completos engoliria a
    // parcela desconhecida — a soma que o null existe para impedir.
    if (dia.completos < dia.pedidos) return { ...ponto, profit: null, ...extra };
    const imposto = amazonTaxAmount(dia.receita, entrada.taxRate);
    const profit = +(dia.receita - dia.tarifa - dia.custo - imposto - ads - estorno).toFixed(2);
    return { ...ponto, profit, ...(dia.temEstimativa ? { profitEstimated: true } : {}), ...extra };
  });
}
