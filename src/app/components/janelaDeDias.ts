/**
 * O DIA-CALENDÁRIO DE BRASÍLIA, no cliente — e a janela de N dias que sai dele.
 *
 * ## O defeito que isto corrige (medido em 01/09/2026)
 *
 * O módulo do TikTok convertia `days` em datas assim:
 *
 * ```
 * const to = new Date(), from = new Date(to);
 * if (days !== "today") from.setDate(from.getDate() - (Number(days) - 1));
 * const iso = (d) => d.toISOString().slice(0, 10);
 * ```
 *
 * `toISOString()` é **UTC**. Brasília é UTC−3, então das **21:00 às 23:59** o
 * dia que sai dali é o de **amanhã** — e a rota (`periodRequest`) ancora o que
 * recebe em `-03:00` e usa como veio, sem reinterpretar. Medido, hora a hora:
 *
 * | janela | o cliente pedia às 22h | o que a rota assume |
 * |---|---|---|
 * | Hoje | 02/09..02/09 | 01/09..01/09 |
 * | 7 dias | 27/08..02/09 | 26/08..01/09 |
 * | 30 dias | 04/08..02/09 | 03/08..01/09 |
 *
 * Em **"Hoje" a janela inteira caía no futuro e a tela vinha VAZIA**; em 7, 15 e
 * 30 dias ela perdia o dia mais antigo e incluía um dia que ainda não
 * aconteceu. Três horas por dia, 13% do tempo — e justo o fim do dia, quando a
 * vendedora fecha o caixa e confere contra o painel do canal.
 *
 * É a mesma família registrada em `src/lib/period.ts` (22/08/2026): o "Hoje"
 * que discordava do Seller Central sobre qual é o dia. Lá era janela móvel de
 * 24h; aqui é fuso.
 *
 * ## ⚠️ ISTO É DÍVIDA COM PRAZO, e o prazo está escrito
 *
 * Regra de período do produto **não deveria viver no cliente** — ela mora em
 * `periodFromDays`, e é dela que os outros canais se servem, porque as rotas
 * deles aceitam `days`. As rotas de módulo do TikTok exigem `from`/`to` e
 * recusam `days` (`INVALID_PERIOD`), então enquanto for assim alguém tem de
 * converter, e a escolha é entre converter **certo** ou continuar convertendo
 * errado.
 *
 * **Quando a rota do TikTok aceitar `days`, este arquivo morre** e o módulo
 * passa a mandar `days` como os outros — pedido registrado com o backend em
 * 01/09/2026. Salvaguarda temporária que sobrevive ao limite que a justificou
 * deixa de proteger e passa a mentir (AGENTS.md).
 */

const TZ = "America/Sao_Paulo";

const FORMATADOR = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** `YYYY-MM-DD` do dia-calendário de Brasília, independente do fuso do navegador. */
export function diaEmBrasilia(instante: Date = new Date()): string {
  return FORMATADOR.format(instante);
}

/**
 * A janela dos últimos N dias-calendário de Brasília, terminando hoje.
 *
 * Mesma definição de `periodFromDays` em `src/lib/period.ts`: `N=1` é só hoje,
 * e a contagem é por dia-calendário, nunca por 24h móveis. Duas definições
 * divergem — a questão é só quando —, então esta existe para casar com aquela,
 * não para ter opinião própria.
 */
export function janelaDeDias(days: string, agora: Date = new Date()): { from: string; to: string } {
  const hoje = diaEmBrasilia(agora);
  const n = days === "today" ? 1 : Math.max(1, Math.round(Number(days)) || 30);
  // ⚠️ MEIO-DIA COMO ÂNCORA, e a justificativa honesta é esta: HOJE ela não muda
  // nada. Testei trocando por meia-noite e nenhum teste ficou vermelho, porque o
  // Brasil não tem horário de verão desde 2019 e o offset é fixo em −03:00 —
  // subtrair múltiplos exatos de 24h a partir da meia-noite sempre cai na
  // meia-noite de um dia anterior.
  //
  // Fica porque é a única linha que sobrevive se o offset voltar a variar: com
  // horário de verão, o dia de 23h faz a meia-noite atravessar para o dia
  // errado, e o meio-dia tem 11h de folga dos dois lados. Não é otimização nem
  // superstição, e não é coberto por teste — está escrito para quem for
  // "simplificar" isto saber o que está trocando.
  const inicio = new Date(`${hoje}T12:00:00-03:00`);
  inicio.setTime(inicio.getTime() - (n - 1) * 86_400_000);
  return { from: diaEmBrasilia(inicio), to: hoje };
}
