import { NextRequest, NextResponse } from "next/server";
import { portaoDoCron } from "@/lib/portaoDoCronHttp";
import {
  runScheduledMercadoLivreReverify,
  runScheduledMercadoLivreSync,
} from "@/lib/integrations/mercadoLivreScheduler";
import { retomarEventosPresosMercadoLivre } from "@/lib/integrations/mercadoLivreWebhook";
import { runScheduledMercadoLivreAds } from "@/lib/integrations/mercadoLivreAdsScheduler";
import { runComoFundo } from "@/lib/execucaoDeFundo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 240;

export async function GET(req: NextRequest) {
  const recusa = portaoDoCron(req);
  if (recusa) return recusa;

  return runComoFundo(async () => {
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
      // ⚠️ A REDE DE SEGURANCA PRECISA CONTAR QUANTAS VEZES SALVOU O PRINCIPAL.
      //
      // Em 29/08/2026 havia 207 eventos parados ha TREZE HORAS e ninguem
      // percebeu — porque esta varredura encobria a falha do push em silencio.
      // Mecanismo de reserva que nao se anuncia vira anestesia: quanto melhor
      // ele funciona, mais tempo o defeito principal fica escondido.
      if (eventosRetomados > 0) {
        console.warn(
          `[ml] varredura retomou ${eventosRetomados} evento(s) preso(s) — ` +
          "isso e o push falhando e sendo encoberto; investigar se repetir."
        );
      }
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
  });
}
