import { NextRequest, NextResponse } from "next/server";
import {
  runScheduledMercadoLivreReverify,
  runScheduledMercadoLivreSync,
} from "@/lib/integrations/mercadoLivreScheduler";
import { retomarEventosPresosMercadoLivre } from "@/lib/integrations/mercadoLivreWebhook";
import { runScheduledMercadoLivreAds } from "@/lib/integrations/mercadoLivreAdsScheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 240;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const startedAt = performance.now();
  const results = await runScheduledMercadoLivreSync();
  // Re-verificação é complementar e best-effort: nunca deixa a ingestão principal cair.
  let reverify: Awaited<ReturnType<typeof runScheduledMercadoLivreReverify>> = [];
  try {
    reverify = await runScheduledMercadoLivreReverify();
  } catch {
    /* reverify é best-effort — uma falha aqui não quebra o cron */
  }
  // Eventos de webhook presos (processing órfão / error retryável): o ML não
  // reenvia notificação antiga, então a varredura é o único caminho de volta.
  // Best-effort, como o reverify.
  let eventosRetomados = 0;
  try {
    eventosRetomados = await retomarEventosPresosMercadoLivre();
  } catch {
    /* varredura é best-effort — uma falha aqui não quebra o cron */
  }
  // Product Ads: síncrono (sem o vaivém da Amazon) e complementar — anúncio que
  // falha não pode derrubar a ingestão de pedidos, que é o que paga a conta.
  let ads: Awaited<ReturnType<typeof runScheduledMercadoLivreAds>> = [];
  try {
    ads = await runScheduledMercadoLivreAds();
  } catch {
    /* idem: best-effort */
  }
  return NextResponse.json({
    ok: true,
    processed: results.length,
    reverified: reverify.length,
    eventosRetomados,
    ads,
    durationMs: Math.round(performance.now() - startedAt),
    results,
    reverify,
  });
}
