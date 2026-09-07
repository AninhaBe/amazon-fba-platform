import { NextRequest, NextResponse } from "next/server";
import { processarWebhookStripe } from "@/lib/billing/webhookStripe";
import { dependenciasDeAssinatura, registroDeEventos, webhookPronto } from "@/lib/billing/runtime";
import { LIMITE_DE_CORPO } from "@/lib/limiteDeCorpo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Recebimento dos eventos de cobrança da Stripe: é isto que libera e corta o
// acesso ao produto. Toda a decisão mora em `src/lib/billing`; aqui só entra o
// que é HTTP.
//
// ⚠️ O corpo é lido com `req.text()`, nunca já parseado. A assinatura da Stripe
// é HMAC sobre os bytes exatos que chegaram — passar por JSON e voltar muda
// espaços e escapes, e a assinatura nunca mais fecha.

export async function GET() {
  // Espelha o webhook do Mercado Livre: diz se o endpoint está de pé sem
  // revelar segredo nenhum.
  return NextResponse.json({
    service: "stripe-webhook",
    configured: Boolean(process.env.STRIPE_WEBHOOK_SECRET && webhookPronto()),
  });
}

export async function POST(req: NextRequest) {
  if (!webhookPronto()) {
    return NextResponse.json({ error: "Webhooks exigem DATABASE_URL configurada." }, { status: 503 });
  }

  // ⚠️ TETO DE BYTES ANTES DE QUALQUER TRABALHO. A verificação de assinatura já
  // recusaria o corpo forjado, mas `req.text()` bufferiza tudo ANTES de a
  // assinatura ser conferida — então sem teto o custo é pago mesmo por quem vai
  // ser recusado. Achado na auditoria de superfície de 07/09/2026.
  const bruto = await req.text();
  if (bruto.length > LIMITE_DE_CORPO) {
    return NextResponse.json({ error: "Corpo grande demais." }, { status: 413 });
  }

  const { status, corpo } = await processarWebhookStripe(
    {
      corpo: bruto,
      cabecalhoAssinatura: req.headers.get("stripe-signature"),
      segredo: process.env.STRIPE_WEBHOOK_SECRET,
    },
    { registro: registroDeEventos(), assinatura: dependenciasDeAssinatura() }
  );
  return NextResponse.json(corpo, { status });
}
