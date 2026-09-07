// ⚠️ LOGICA PURA EM `.ts`, NAO DENTRO DO `.tsx`, pelo mesmo motivo de
// `composicaoFinanceira.ts` e `serieDoLucroPorDia.ts`: o runner de `npm test`
// (`node --experimental-strip-types`) nao carrega `.tsx`, e estas contas
// precisam ser testadas pelo COMPORTAMENTO — chamar e conferir a saida — e nao
// por casamento no fonte, que e a familia de teste decorativo que o AGENTS.md
// proibe.

/**
 * ⚠️ AS DUAS CONTAS DA FAIXA DE 4 ETAPAS, e o cuidado inteiro esta no `null`.
 *
 * O canvas do Caminho do Dinheiro mostra "Custou R$ 2.482,82" e, embaixo, as
 * quatro parcelas. Nenhum produtor entrega esse total: ele e a soma de `cogs`,
 * `sellerShipping`, `fees` e `taxes`. E `taxes` e `null` sempre que a aliquota
 * nao esta cadastrada.
 *
 * Somar `null` como zero daria um total MENOR do que o real, com a autoridade
 * de um numero exato — a vendedora leria "custou 2.229" quando custou mais, e o
 * "Sobrou" ao lado pareceria melhor do que e. E o defeito que a casa proibe, na
 * sua forma mais cara: nao some nada da tela, so fica errado.
 *
 * Entao: QUALQUER parcela desconhecida torna o total desconhecido, e a peca diz
 * O QUE falta, com nome — no padrao da casa, apontar em vez de se desculpar.
 *
 * ⚠️ UMA EXCECAO NOMEADA, decidida pela Ana em 07/09/2026: ALIQUOTA DE
 * IMPOSTO NAO CADASTRADA VALE ZERO NA CONTA. Ela nao e mais uma parcela
 * desconhecida — e uma parcela conhecida e igual a zero, e a soma fecha.
 *
 * O que sustenta a excecao e que o rastro NAO se perde: `taxRateKnown` vem
 * `false` do produtor e a pendencia "Alíquota não configurada → Configurar"
 * continua na fila. Sem esse sinal a excecao seria um `?? 0` disfarcado, que e
 * exatamente o defeito que este modulo existe para impedir.
 *
 * ⚠️ E ELA VALE SO PARA O IMPOSTO. Tarifa, frete e custo continuam
 * apagando o total quando sao `null`, porque ali o desconhecido e desconhecido
 * mesmo: ninguem decidiu que valem zero, a fonte e que ainda nao publicou.
 */

export interface ParcelaDeCusto {
  /** O nome que aparece na tela quando esta parcela e a que falta. */
  rotulo: string;
  valor: number | null | undefined;
}

export interface TotalDeCustos {
  /** `null` quando qualquer parcela e desconhecida. Nunca uma soma parcial. */
  total: number | null;
  /** Os rotulos das parcelas desconhecidas, na ordem em que entraram. */
  faltando: string[];
}

export function somaDosCustos(parcelas: ParcelaDeCusto[]): TotalDeCustos {
  const faltando = parcelas.filter((p) => p.valor == null || !Number.isFinite(p.valor)).map((p) => p.rotulo);
  if (faltando.length > 0) return { total: null, faltando };
  const total = parcelas.reduce((soma, p) => soma + (p.valor as number), 0);
  return { total, faltando: [] };
}

/**
 * Quanto uma parcela representa do faturamento, em pontos percentuais.
 *
 * ⚠️ SEM DIVISOR VALIDO NAO HA PORCENTAGEM — devolve `null`, e a tela nao
 * escreve nada. Um `parte / 0` produz `Infinity` e um `parte / null` produz
 * `NaN`; os dois chegariam a tela como "Infinity%" e "NaN%", que e pior que
 * ausencia porque parece um numero. Base zero tambem nao e "0%": e "nao da para
 * dizer", que e outra coisa.
 */
export function sobreAVenda(parte: number | null | undefined, base: number | null | undefined): number | null {
  if (parte == null || !Number.isFinite(parte)) return null;
  if (base == null || !Number.isFinite(base) || base === 0) return null;
  return (parte / base) * 100;
}

/**
 * ⚠️ ORDENA POR MARGEM COM `null` NO FIM, e isso e uma decisao de justica, nao
 * de arrumacao.
 *
 * Ordenar `null` como 0% poria o produto sem custo cadastrado entre os piores —
 * a tela ACUSARIA de prejuizo um item sobre o qual nada se sabe. O desconhecido
 * vai para o fim da lista e chega marcado, para a vendedora ver que ele esta
 * fora do ranking em vez de achar que perdeu a corrida.
 *
 * A ordem entre os desconhecidos preserva a de entrada (a do produtor), para
 * dois `null` nao trocarem de lugar a cada render.
 */
export function ordenaPorMargem<T extends { marginPct: number | null }>(itens: T[]): T[] {
  const conhecidos = itens.filter((item) => item.marginPct != null && Number.isFinite(item.marginPct));
  const desconhecidos = itens.filter((item) => item.marginPct == null || !Number.isFinite(item.marginPct));
  conhecidos.sort((a, b) => (b.marginPct as number) - (a.marginPct as number));
  return [...conhecidos, ...desconhecidos];
}

/**
 * O que a venda custou: o que entrou menos o que sobrou.
 *
 * ⚠️ A TABELA MOSTRA "CUSTOS" E O PRODUTOR NAO ENTREGA ESSE CAMPO — ele
 * entrega a receita e a contribuicao. Derivar aqui, e nao no JSX, e o que
 * permite testar o caso que importa: com receita OU contribuicao desconhecida,
 * o custo e desconhecido. Um `(revenue ?? 0) - (contribution ?? 0)` daria um
 * numero exato e errado, e a linha inteira pareceria conferida.
 */
export function custoDaVenda(receita: number | null | undefined, sobrou: number | null | undefined): number | null {
  if (receita == null || !Number.isFinite(receita)) return null;
  if (sobrou == null || !Number.isFinite(sobrou)) return null;
  return receita - sobrou;
}

/**
 * A fatia do "Sobrou" na barra do custo — e ela SO existe quando a conta fecha.
 *
 * ⚠️ HIBRIDO DELIBERADO (decisao de 06/09/2026), e as duas metades tem
 * motivo:
 *
 *   TODAS as parcelas conhecidas -> a fatia verde entra e a barra fecha 100%.
 *     E o que o canvas desenhou, e conta a historia inteira: venda = custo +
 *     sobra.
 *
 *   QUALQUER parcela desconhecida -> a fatia verde SOME, e o branco que sobra
 *     significa "o que ainda nao se sabe". Uma fatia verde calculada por
 *     diferenca com o imposto faltando afirmaria um lucro que nao esta fechado
 *     — e afirmaria com a autoridade de um desenho, que e pior que um numero,
 *     porque ninguem confere um desenho.
 *
 * ⚠️ O IMPOSTO NAO BLOQUEIA MAIS A FATIA (07/09/2026): aliquota nao
 * cadastrada vale zero, entao a conta fecha com ele. Quem chama passa o imposto
 * ja resolvido em zero; as outras tres parcelas continuam bloqueando.
 *
 * Devolve a largura em pontos percentuais, ou `null` quando a fatia nao deve
 * existir.
 */
export function fatiaDoSobrou({ parcelas, lucro, base }: {
  parcelas: Array<number | null | undefined>;
  lucro: number | null | undefined;
  base: number | null | undefined;
}): number | null {
  const algumaDesconhecida = parcelas.some((valor) => valor == null || !Number.isFinite(valor));
  if (algumaDesconhecida) return null;
  // Prejuizo tambem nao vira fatia: a barra mede o que a venda virou, e uma
  // largura negativa nao existe. O branco continua dizendo o que falta.
  if (lucro == null || !Number.isFinite(lucro) || lucro <= 0) return null;
  return sobreAVenda(lucro, base);
}
