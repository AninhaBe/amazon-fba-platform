/**
 * A decisão do efeito de troca de número — sem JSX, de propósito.
 *
 * ⚠️ MORA NUM ARQUIVO `.ts` E NÃO NO COMPONENTE porque o runner
 * de teste do repo não carrega `.tsx`: JSX não passa pelo type stripper do
 * Node. Lógica que precisa de teste não pode morar em arquivo de componente — e
 * esta precisa, porque a ordem da dona do produto (12/09/2026) foi manter o
 * efeito, e guarda que casa nome de classe não prova efeito nenhum.
 */

/**
 * Identidade estável de um recorte, a partir do período que a API devolve.
 *
 * ⚠️ Não use `to` cru. Medido em 28/08/2026: as rotas de overview devolvem
 * `to` = agora, com milissegundos (`2026-08-28T22:24:40.014Z`). Duas respostas
 * do MESMO recorte — a do cache e a da revalidação que chega logo atrás —
 * carregam `to` diferente, e para o componente isso parecia troca de período:
 * a contagem reiniciava do zero no meio, e sob `prefers-reduced-motion` dava
 * um piscar de R$ 0,00 sem movimento nenhum para explicá-lo.
 *
 * O dia basta para separar os recortes que existem (os presets são janelas de
 * dias inteiros) e é igual entre as duas respostas.
 */
export function identidadeDePeriodo(from: string, to: string): string {
  return `${from}|${to.slice(0, 10)}`;
}

/**
 * De onde a contagem parte — a decisão inteira do efeito, num lugar testável.
 *
 * ⚠️ EXTRAIDA EM 12/09/2026 SEM MUDAR UMA VIRGULA da expressão
 * que já estava dentro do componente. O motivo é a ordem da dona do produto de
 * manter o efeito de troca de número: guarda que casa nome de classe não prova
 * efeito nenhum — a única forma de provar é exercitar a TROCA DE VALOR, e para
 * isso a decisão precisa ser chamável fora do React.
 *
 * Os quatro casos, cada um com razão própria:
 *   estreia (sem memória) — entra no valor real, sem contar: contar do zero na
 *     estreia, em valor alto, parecia defeito;
 *   mesmo período, valor novo — conta A PARTIR DO ANTERIOR. É o efeito que ela
 *     pediu para preservar;
 *   período diferente — conta a partir do ZERO, porque o número anterior é de
 *     outro recorte, e afirmá-lo sob o rótulo novo foi o defeito medido em
 *     28/08/2026 (R$ 325,91 de "hoje" embaixo de "7 dias");
 *   sem período declarado — não herda nada: quem não declara o recorte nunca
 *     conta a partir do número de outro.
 */
export function sementeDaContagem(
  lembrado: { valor: number; periodo: string | undefined } | undefined,
  periodo: string | undefined,
  value: number,
): number {
  const trocaDeRecorte = lembrado !== undefined && periodo !== undefined && lembrado.periodo !== periodo;
  return trocaDeRecorte ? 0 : periodo !== undefined && lembrado?.periodo === periodo ? lembrado.valor : value;
}
