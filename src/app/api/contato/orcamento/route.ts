import { NextRequest, NextResponse } from "next/server";
import {
  DESTINO,
  REMETENTE,
  processarPedidoDeOrcamento,
  textoDoEmail,
  type PedidoDeOrcamento,
} from "./pedidoDeOrcamento";

/**
 * Pedido de orçamento da landing — rota PÚBLICA, sem sessão.
 *
 * Este arquivo é só o transporte: ler a requisição, chamar a decisão, devolver
 * a resposta. Toda a validação, o teto de flood e a regra de "não fingir que
 * enviou" moram em `pedidoDeOrcamento.ts`, que é testável de verdade — o runner
 * de teste não resolve `next/server`, e um teste que só lê o fonte não prova
 * comportamento nenhum (AGENTS.md).
 */

/** Envio pelo Resend. Devolve `null` em sucesso, ou o detalhe do erro para o log. */
async function enviarPeloResend(chave: string, pedido: PedidoDeOrcamento): Promise<string | null> {
  try {
    const resposta = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${chave}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: REMETENTE,
        to: [DESTINO],
        reply_to: pedido.email,
        subject: `Orçamento: ${pedido.nome} — ${pedido.faixaDePedidos}`,
        text: textoDoEmail(pedido),
      }),
    });
    if (resposta.ok) return null;
    return `Resend respondeu ${resposta.status}: ${await resposta.text().catch(() => "")}`;
  } catch (motivo) {
    return `falha de rede ao chamar o Resend: ${motivo instanceof Error ? motivo.message : String(motivo)}`;
  }
}

/**
 * IP de quem chamou, pelo primeiro salto do `x-forwarded-for`.
 *
 * ⚠️ Só o PRIMEIRO valor é do cliente; o resto são proxies, e quem posta direto
 * pode escrever o que quiser no cabeçalho. Isso não torna o limite inútil — ele
 * encarece o flood ingênuo —, mas é a razão de o TETO GLOBAL existir ao lado:
 * ele não depende de identificar ninguém.
 */
function ipDaRequisicao(req: NextRequest) {
  const encaminhado = req.headers.get("x-forwarded-for") ?? "";
  const primeiro = encaminhado.split(",")[0]?.trim();
  return primeiro || req.headers.get("fly-client-ip") || "desconhecido";
}

export async function POST(req: NextRequest) {
  const chave = process.env.RESEND_API_KEY ?? null;
  const { status, corpo } = await processarPedidoDeOrcamento({
    corpoBruto: await req.text().catch(() => null),
    ip: ipDaRequisicao(req),
    agora: Date.now(),
    chave,
    enviar: (pedido) => enviarPeloResend(chave ?? "", pedido),
    registrar: (mensagem, detalhe) => console.error("[contato/orcamento]", mensagem, detalhe ?? ""),
  });
  return NextResponse.json(corpo, { status });
}

/**
 * ⚠️ Só POST. Sem isto, um GET responderia 405 do framework — o que é correto,
 * mas deixar explícito evita que alguém "resolva" um 405 adicionando um GET que
 * dispara e-mail por link, que é o jeito clássico de virar máquina de spam.
 */
export async function GET() {
  return NextResponse.json({ error: "Método não permitido." }, { status: 405 });
}
