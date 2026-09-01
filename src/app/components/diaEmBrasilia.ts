/**
 * O DIA-CALENDÁRIO DE BRASÍLIA, no cliente.
 *
 * Serve para uma coisa só: o teto dos campos de data do filtro de período, que
 * não pode deixar escolher um dia que ainda não começou aqui.
 *
 * ⚠️ ISTO NÃO CONVERTE PERÍODO, e a distinção custou caro. Até 01/09/2026 este
 * arquivo também transformava `days` em `from`/`to` para os módulos do TikTok,
 * porque as rotas de lá recusavam `days`. Era dívida com prazo declarado — e o
 * prazo venceu no mesmo dia: `periodRequest` passou a aceitar `days` (commit
 * e8b87ba) e a conversão foi apagada em vez de sobreviver ao limite que a
 * justificava.
 *
 * Quem precisar de janela a partir de `days` **manda `days`**: a regra é do
 * servidor (`periodFromDays` / `periodRequest`), e conversão que não existe não
 * erra de fuso.
 *
 * O defeito que a conversão causou, para ninguém trazer de volta: `toISOString()`
 * é UTC, e das 21:00 às 23:59 de Brasília ela devolvia o dia seguinte. A janela
 * ia para o FUTURO e a aba do TikTok aparecia VAZIA à noite, voltando ao normal
 * de manhã — 13% de todo dia, todos os dias, e um defeito que se conserta
 * sozinho de manhã é dos piores de diagnosticar.
 */

const FORMATADOR = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** `YYYY-MM-DD` do dia de hoje em Brasília, independente do fuso do navegador. */
export function diaEmBrasilia(instante: Date = new Date()): string {
  return FORMATADOR.format(instante);
}
