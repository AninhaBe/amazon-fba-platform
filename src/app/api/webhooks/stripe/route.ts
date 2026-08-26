import { NextRequest, NextResponse } from "next/server";
import { processarWebhookStripe } from "@/lib/billing/webhookStripe";
import { dependenciasDeAssinatura, registroDeEventos, webhookPronto } from "@/lib/billing/runtime";

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

  const { status, corpo } = await processarWebhookStripe(
    {
      corpo: await req.text(),
      cabecalhoAssinatura: req.headers.get("stripe-signature"),
      segredo: process.env.STRIPE_WEBHOOK_SECRET,
    },
    { registro: registroDeEventos(), assinatura: dependenciasDeAssinatura() }
  );
  return NextResponse.json(corpo, { status });
}
