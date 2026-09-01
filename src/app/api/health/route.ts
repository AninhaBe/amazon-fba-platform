import { NextResponse } from "next/server";

import { dbQuery, hasDb } from "@/lib/db";
import { medirSilencioDoWebhook } from "@/lib/integrations/silencioDoWebhook";

/**
 * Health check — e ele TOCA O BANCO, de propósito.
 *
 * ## Por que mudou (incidente de 29/08/2026, 02:10–02:17Z)
 *
 * Este endpoint era `return NextResponse.json({ ok: true })` e nada mais.
 * Durante 7 minutos em que o app **não conseguia nenhuma conexão** — log da
 * máquina cheio de `ECHECKOUTTIMEOUT ... FATAL`, os quatro syncs falhando, toda
 * tela com dado quebrada — ele respondeu **200 em ~1s, várias vezes**. Duas
 * pessoas leram esse verde como "o app está de pé" e escreveram isso em reporte.
 *
 * **Um health check que não toca a dependência não é health check: é um teste de
 * que o processo subiu.** E ele foi lido como disponibilidade justamente porque
 * deu verde na hora em que se queria verde.
 * Ver `docs/postmortem-2026-08-29-pool-esgotado.md`.
 *
 * ## O que ele faz agora
 *
 * Uma consulta trivial (`SELECT 1`) com **timeout curto**, e **503** quando o
 * banco não responde. O timeout é curto de propósito: health que espera 15s pelo
 * `checkout` vira mais um cliente na fila do pool que já está saturado — o
 * remédio não pode alimentar a doença.
 *
 * Sem `DATABASE_URL` (dev local sem banco), responde 200 e diz que não checou —
 * afirmar saúde de uma dependência que não existe seria a mesma mentira ao
 * contrário.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Curto de propósito: ver a nota acima. */
const TIMEOUT_MS = 3_000;

/**
 * O COMMIT QUE ESTÁ NO AR — para "a versão X contém o commit Y?" ser FATO.
 *
 * ⚠️ Nasceu de um caso concreto (01/09/2026): perguntado se a v220 continha um
 * commit, a resposta só podia ser inferência ("o deploy saiu de uma worktree
 * naquele commit"). A inferência estava certa — e ir verificar pelo COMPORTAMENTO
 * em vez de aceitá-la foi o que revelou 7 pedidos perdidos. Expor o hash mata
 * essa classe inteira de dúvida.
 *
 * Só o hash CURTO: `/api/health` é rota pública, e mais que isso é superfície
 * sem ganho.
 */
// ⚠️ `DEPLOYMENT_VERSION` PRIMEIRO, e a ordem importa: a primeira versão disto
// lia `FLY_MACHINE_VERSION` antes, e o campo saiu em produção mostrando
// "01M1F1S15ZKZ" — identificador de máquina do Fly, que NÃO responde "qual
// commit está no ar". Um campo que parece responder e não responde é pior que
// campo nenhum, porque quem lê para de perguntar.
const COMMIT = (process.env.DEPLOYMENT_VERSION || "desconhecido").slice(0, 12);

export async function GET() {
  if (!hasDb()) {
    return NextResponse.json({ ok: true, banco: "nao-configurado" });
  }

  const inicio = Date.now();
  try {
    await Promise.race([
      dbQuery("SELECT 1", []),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`banco nao respondeu em ${TIMEOUT_MS}ms`)), TIMEOUT_MS)
      ),
    ]);
    // ⚠️ O SILÊNCIO DO WEBHOOK É DEGRADAÇÃO, NÃO FALHA — e isso é deliberado.
    //
    // `ok` continua sendo sobre o BANCO. Se o silêncio derrubasse o health, uma
    // parada do Mercado Livre viraria reinício da máquina pelo orquestrador do
    // Fly, e o remédio pioraria a doença — o mesmo mecanismo do incidente de
    // 29/08 descrito acima, por outra porta.
    //
    // Ele também não pode DERRUBAR a resposta se falhar: uma consulta a mais no
    // health não vale um 503. Por isso o catch devolve `null` em vez de propagar.
    const webhook = await medirSilencioDoWebhook().catch(() => null);
    return NextResponse.json({
      ok: true,
      banco: "ok",
      bancoMs: Date.now() - inicio,
      commit: COMMIT,
      ...(webhook ? { webhook } : {}),
    });
  } catch (erro) {
    // 503 é o ponto da mudança: sem isso o monitoramento continua vendo verde.
    return NextResponse.json(
      {
        ok: false,
        banco: "indisponivel",
        bancoMs: Date.now() - inicio,
        // Mensagem técnica, sem credencial: a string de conexão nunca entra aqui.
        detalhe: erro instanceof Error ? erro.message.slice(0, 120) : "falha desconhecida",
      },
      { status: 503 }
    );
  }
}
