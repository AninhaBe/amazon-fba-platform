import { NextResponse } from "next/server";

/**
 * LIVENESS — "o processo está vivo?". Não toca o banco, de propósito.
 *
 * ## Por que existe (29/08/2026, incidente das 12:43–12:45Z)
 *
 * De manhã o `/api/health` passou a devolver **503** quando o banco não
 * responde. Isso é honesto e a gente precisa dessa informação — o health antigo
 * mentiu verde durante sete minutos de app quebrado.
 *
 * Só que o check do Fly apontava para ele, e **a máquina é uma só**. Então um
 * soluço de banco virava:
 *
 * ```
 * banco lento -> /api/health devolve 503 -> Fly marca a UNICA instancia como
 * critical -> o proxy nao tem para onde mandar -> "could not find a good
 * candidate within 40 attempts" -> a requisicao gira ~18s no proxy
 * ```
 *
 * Medido: uma requisição de health levou **19,29s** enquanto o banco respondia
 * em **360ms** — os 18,9s não estavam no banco nem no processo (de dentro da
 * máquina o mesmo endpoint responde em 0–1ms). Estavam no roteamento.
 *
 * **Uma correção certa em isolado virou destrutiva no sistema em que foi
 * instalada.** Health check que reprova por dependência externa é o desenho
 * certo quando existe para onde fazer failover; com instância única, é
 * autoagressão: transforma degradação em apagão.
 *
 * ## A divisão
 *
 * - `/api/vivo` (aqui): **liveness**. Só prova que o processo responde. É o que
 *   o `fly.toml` usa — quem decide derrubar a máquina não pode ser uma
 *   dependência externa enquanto a máquina for uma só.
 * - `/api/health`: **readiness**. Continua tocando o banco e devolvendo 503,
 *   porque essa informação é verdadeira e é dela que a gente precisa para saber
 *   que o banco caiu.
 *
 * ⚠️ Quando existir uma segunda máquina, reavaliar: com failover possível, faz
 * sentido o check voltar a considerar a dependência.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ ok: true, processo: "vivo" });
}
