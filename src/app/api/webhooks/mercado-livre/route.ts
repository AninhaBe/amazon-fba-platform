import { NextRequest, NextResponse } from "next/server";
import {
  enqueueMercadoLivreNotification,
  processMercadoLivreEvent,
  type QueuedMercadoLivreEvent,
} from "@/lib/integrations/mercadoLivreWebhook";
import {
  MercadoLivreWebhookConfigurationError,
  parseMercadoLivreNotification,
} from "@/lib/integrations/mercadoLivreNotification";
import { depoisDaResposta } from "@/lib/depoisDaResposta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    service: "mercado-livre-webhook",
    configured: Boolean(process.env.MELI_CLIENT_ID && process.env.DATABASE_URL),
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as unknown;
    const candidates = body && typeof body === "object" && Array.isArray((body as { messages?: unknown[] }).messages)
      ? (body as { messages: unknown[] }).messages
      : [body];
    if (!candidates.length) throw new RangeError("Lote de notificações vazio.");
    if (candidates.length > 100) throw new RangeError("Lote de notificações excede o limite de 100 eventos.");
    const notifications = candidates.map(parseMercadoLivreNotification);
    const queued: QueuedMercadoLivreEvent[] = [];
    for (const notification of notifications) {
      queued.push(...await enqueueMercadoLivreNotification(notification));
    }

    if (queued.length) {
      depoisDaResposta("webhook-ml:processa", async () => {
        for (const event of queued) {
          try {
            await processMercadoLivreEvent(event);
          } catch (error) {
            console.error("Falha ao processar webhook do Mercado Livre", {
              eventKey: event.eventKey,
              reason: error instanceof Error ? error.message : "Erro desconhecido",
            });
          }
        }
      });
    }

    // O Mercado Livre recomenda confirmação imediata para evitar reentregas.
    return NextResponse.json({ received: true, queued: queued.length });
  } catch (error) {
    const invalid = error instanceof RangeError;
    const misconfigured = error instanceof MercadoLivreWebhookConfigurationError;
    return NextResponse.json(
      { error: invalid || misconfigured ? error.message : "Não foi possível receber a notificação." },
      { status: invalid ? 400 : 503 }
    );
  }
}
