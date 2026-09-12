// ⚠️ LOGICA PURA EM `.ts`, NAO DENTRO DO `.tsx` — mesmo motivo de
// `composicaoFinanceira.ts`: o runner de `npm test`
// (`node --experimental-strip-types`) nao carrega `.tsx`, e esta escolha precisa
// ser testada pelo COMPORTAMENTO (chamar e conferir a saida) e nao por
// casamento no fonte, que e a familia de teste decorativo que o AGENTS.md
// proibe. Dentro do componente, so daria para olhar o texto do arquivo.

/** A query do filtro "7 dias" e a do "Hoje" — as mesmas strings que a URL usa. */
export const JANELA_DE_SETE_DIAS = "days=7";

/**
 * De onde o bloco "Ritmo dos últimos 7 dias" tira as colunas: SEMPRE da janela
 * de sete dias que termina hoje, qualquer que seja o filtro de data.
 *
 * ⚠️ ESTA REGRA JÁ FOI O CONTRÁRIO, e a inversão é decisão da dona
 * (09/09/2026): *"sobre o ritmo dos últimos 7 dias, vai ser a única coisa que
 * não vai mudar com base no filtro de data, vai ficar últimos 7 dias sempre"*.
 *
 * O que valia antes, para quem abrir o histórico: só o filtro "Hoje" trocava de
 * fonte (correção de 03/09/2026, quando um único ponto virava uma coluna
 * gigante sob um título que prometia sete). Nos demais filtros o bloco cortava
 * `serieDoPeriodo.slice(-7)`.
 *
 * ⚠️ POR QUE AQUILO ERA DEFEITO E NÃO SÓ "OUTRA ESCOLHA": o título
 * do bloco é fixo — "Ritmo dos últimos 7 dias". Com 15 ou 30 dias o corte
 * coincidia com os últimos sete de verdade e ninguém via nada. Com
 * **Personalizado** (ex.: 1 a 20 de agosto) o bloco mostrava os últimos sete
 * dias DAQUELA janela sob um título dizendo "últimos 7 dias". É a mesma família
 * do `from`/`to` da Shopee que o AGENTS.md registra: controle marcado exibindo
 * outro período. Agora título e dado nascem da mesma regra.
 *
 * ⚠️ E ENQUANTO A JANELA NÃO CHEGOU, a resposta é vazia: o bloco não
 * se desenha por um instante, o que é melhor do que aparecer com as colunas do
 * período sob um título que promete sete.
 */
export function serieDoBlocoDeLucro<T>({
  janelaDeSeteDias,
}: {
  /** `null` enquanto a janela ainda não chegou. */
  janelaDeSeteDias: T[] | null;
}): T[] {
  return janelaDeSeteDias == null ? [] : janelaDeSeteDias.slice(-7);
}
