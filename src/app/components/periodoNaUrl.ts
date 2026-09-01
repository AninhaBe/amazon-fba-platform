/**
 * A ESCOLHA DE PERÍODO VAI PARA A URL — e é ela que volta no recarregamento.
 *
 * ⚠️ O defeito que isto corrige (revisão da aba de Ads em 31/08/2026): a tela
 * chamava `useDashboardPeriod()` sem argumento, então `?days=30` no endereço era
 * IGNORADO e clicar num preset não mudava o endereço. Duas consequências, e a
 * segunda é a que enganou o revisor:
 *
 *   1. quem abria `/ads?days=30` (de um link, do histórico ou de um F5) caía em
 *      "Hoje" sem nada dizendo que o pedido tinha sido descartado;
 *   2. num período em que os quatro canais estão sem dado, trocar de preset não
 *      muda NADA na tela — nem o conteúdo, nem o endereço. O botão funciona e
 *      parece morto, que é pior que um botão que falha com erro.
 *
 * `useDashboardPeriod` já sabe ler a URL (é o primeiro argumento) e já sabe
 * avisar quando a pessoa escolhe (é o segundo). O que faltava era ligar os dois
 * nesta tela. Esta função é a metade que faltava: dada a query atual e a escolha
 * do filtro, devolve a próxima query — preservando tudo que não é período.
 *
 * Os dois modos são EXCLUDENTES: preset limpa `from`/`to`, intervalo limpa
 * `days`. Deixar os dois no endereço faria o servidor e a tela discordarem —
 * `resolvePeriod` prefere `from`/`to`, o filtro prefere o que ele acabou de
 * escolher, e a pessoa veria o número de um período com o botão de outro.
 */
export function periodoNaUrl(atual: string, escolha: string): string {
  const proxima = new URLSearchParams(atual);
  const escolhida = new URLSearchParams(escolha);
  const de = escolhida.get("from");
  const ate = escolhida.get("to");
  if (de && ate) {
    proxima.set("from", de);
    proxima.set("to", ate);
    proxima.delete("days");
  } else {
    // O mesmo padrão de `useDashboardPeriod` — quem não escolheu vê "Hoje".
    proxima.set("days", escolhida.get("days") ?? "today");
    proxima.delete("from");
    proxima.delete("to");
  }
  return proxima.toString();
}
