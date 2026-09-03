// ⚠️ LOGICA PURA EM `.ts`, NAO DENTRO DO `.tsx` — mesmo motivo de
// `composicaoFinanceira.ts`: o runner de `npm test`
// (`node --experimental-strip-types`) nao carrega `.tsx`, e esta escolha precisa
// ser testada pelo COMPORTAMENTO (chamar e conferir a saida) e nao por
// casamento no fonte, que e a familia de teste decorativo que o AGENTS.md
// proibe. Dentro do componente, so daria para olhar o texto do arquivo.

/** A query do filtro "7 dias" e a do "Hoje" — as mesmas strings que a URL usa. */
export const JANELA_DE_SETE_DIAS = "days=7";
export const FILTRO_DE_HOJE = "days=today";

/**
 * De onde o bloco "Lucro por dia — últimos 7" tira as colunas.
 *
 * ⚠️ O DEFEITO QUE ISTO CORRIGE (03/09/2026): o bloco lia a série do período
 * selecionado. Com o filtro "Hoje" isso é UM ponto, e uma barra sozinha se
 * estica pela régua inteira — o título prometia sete e a tela mostrava uma.
 * Verbatim da dona: *"no filtro de hoje (mercadolivre), o layout mostre o lucro
 * por dia nos últimos 7 dias, e não só hoje."*
 *
 * ⚠️ SÓ O FILTRO "HOJE" TROCA DE FONTE. Nos outros a série continua sendo a do
 * período, inclusive quando a janela de sete dias já está carregada na memória —
 * ela não pode vazar para o 15 nem para o personalizado, que não foram pedidos.
 *
 * ⚠️ E ENQUANTO A JANELA NÃO CHEGOU, a resposta é vazia em vez da série de um
 * dia: o bloco não se desenha por um instante, o que é melhor do que aparecer
 * com uma coluna sob um título que promete sete.
 */
export function serieDoBlocoDeLucro<T>({
  filtro,
  serieDoPeriodo,
  janelaDeSeteDias,
}: {
  filtro: string;
  serieDoPeriodo: T[];
  /** `null` quando o filtro não é "Hoje", ou quando a janela ainda não chegou. */
  janelaDeSeteDias: T[] | null;
}): T[] {
  if (filtro === FILTRO_DE_HOJE) {
    return janelaDeSeteDias == null ? [] : janelaDeSeteDias.slice(-7);
  }
  return serieDoPeriodo.slice(-7);
}
