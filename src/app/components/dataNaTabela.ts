import { brDate, brTime } from "../../lib/datetime";

/**
 * A DATA COMO ELA APARECE NUMA TABELA — um lugar só, para os quatro canais.
 *
 * ⚠️ O DEFEITO QUE ISTO CORRIGE (02/09/2026, reportado pela vendedora com print):
 * a coluna "Data" da aba Pedidos do monitor da Shopee mostrava o ISO cru —
 * `2026-09-02T19:16:44.000Z`. Não é só feio: o `Z` é UTC, e o pedido das 16:16
 * dela aparecia como 19:16.
 *
 * A causa era um recorte por NOME: a célula só formatava chaves terminadas em
 * `At` (`key.endsWith("At")`), e a coluna se chama `date`. Formatação escolhida
 * por sufixo de nome é a família de "casar o nome não prova nada" — a próxima
 * coluna de data com outro nome nasce crua de novo.
 *
 * ⚠️ POR QUE ESTA PEÇA MORA AQUI E NÃO EM `src/lib/datetime.ts`: a VERDADE DO
 * FUSO continua lá, em `brDate`/`brTime`, e é de lá que ela sai — esta função
 * não converte nada, ela só COMPÕE a forma de exibição, que é decisão de
 * renderização. `src/lib/` é do backend, e dividir o commit não deixaria
 * nenhuma tela mentindo (a função ficaria só sem uso), então o escape de
 * atomicidade não caberia aqui.
 */

const ISO_COMPLETO = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
const SOMENTE_DATA = /^\d{4}-\d{2}-\d{2}$/;

/** `2026-09-02T19:16:44Z` → `02/09/2026 16:16` (fuso de Brasília). */
export function dataHoraNaTabela(valor: unknown): string | null {
  if (typeof valor !== "string" || valor === "") return null;
  const texto = valor;
  // ⚠️ A FORMA E CONFERIDA ANTES DO PARSE, e nao depois: `new Date("42")`
  // devolve o ano de 2042 em vez de invalido, entao "checar se deu NaN" aceita
  // lixo numerico e imprime uma data que ninguem tem. So ISO passa.
  if (!ISO_COMPLETO.test(texto) && !SOMENTE_DATA.test(texto)) return null;
  const quando = new Date(texto);
  if (Number.isNaN(quando.getTime())) return null;
  // Data pura ("2026-09-02") não tem hora para mostrar — inventar "00:00"
  // afirmaria um horário que a fonte não deu.
  if (SOMENTE_DATA.test(texto)) return brDate(texto);
  return `${brDate(quando)} ${brTime(quando)}`;
}

/**
 * A coluna carrega data? Decidido pelo VALOR, não pelo nome da chave.
 *
 * Um ISO completo tem forma reconhecível, e é isso que se testa. Assim uma
 * coluna nova chamada `quando`, `dataDoRepasse` ou `postedAt` nasce formatada
 * sem ninguém lembrar de acrescentá-la a uma lista.
 */
export function pareceData(valor: unknown): boolean {
  return typeof valor === "string" && ISO_COMPLETO.test(valor);
}
