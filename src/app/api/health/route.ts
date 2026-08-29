import { NextResponse } from "next/server";

import { dbQuery, hasDb } from "@/lib/db";

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
    return NextResponse.json({ ok: true, banco: "ok", bancoMs: Date.now() - inicio });
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
