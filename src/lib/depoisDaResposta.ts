import { after } from "next/server";

import { medirTrabalhoDeFundo, runComoFundo } from "./execucaoDeFundo";

/**
 * A ÚNICA porta para trabalho que roda depois da resposta.
 *
 * ## Por que existe (29/08/2026)
 *
 * Oito rotas chamavam `after()` direto, e **nenhuma** passava por
 * `runComoFundo`. Ou seja: o sync que a TELA dispara a cada abertura rodava no
 * pool de **usuário** — os mesmos 8 slots de que a tela precisa para desenhar.
 *
 * A cerca que separou os pools de madrugada isolou o caminho FRIO (as cinco
 * rotas de cron) e deixou o QUENTE sem cerca. Isso explica o que nenhuma outra
 * hipótese explicava: por que o banco continuou apanhando depois de o agendador
 * ser desligado às 12:23 — desligar o agendador nunca desligou o sync das telas.
 *
 * ## Por que TODO `after()` é fundo, sem exceção
 *
 * `after()` roda **depois que a resposta já saiu**. Por definição, nada ali está
 * no caminho crítico de ninguém. Um corpo de `after()` no pool de usuário é uma
 * contradição: é trabalho que não serve mais o usuário, disputando o slot de
 * quem ainda está esperando a tela.
 *
 * ⚠️ Wrap manual site a site foi rejeitado de propósito: foi assim que as oito
 * escaparam da cerca. `tests/afterEhSempreFundo.test.mjs` falha se uma rota
 * importar `after` de `next/server` por fora daqui — a próxima rota não nasce
 * do lado de fora por esquecimento.
 *
 * ⚠️ O contexto de workspace/conta NÃO atravessa o `after()` sozinho: o
 * `AsyncLocalStorage` da requisição já morreu. Quem chama continua compondo o
 * `runWithWorkspace(id, ...)` dentro de `fn`, com o id capturado durante a
 * requisição.
 */
export function depoisDaResposta(nome: string, fn: () => Promise<unknown>): void {
  after(() =>
    runComoFundo(() =>
      medirTrabalhoDeFundo(nome, fn).catch((erro) => {
        // Falha aqui nunca chega à tela — ela já respondeu. Mas some do mundo se
        // não for registrada, e silêncio por desenho já custou caro hoje.
        console.error("[after] trabalho falhou", {
          trabalho: nome,
          motivo: erro instanceof Error ? erro.message.slice(0, 200) : "erro desconhecido",
        });
      })
    )
  );
}
