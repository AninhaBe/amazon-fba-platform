import { NextRequest, NextResponse } from "next/server";
import {
  runScheduledMercadoLivreReverify,
  runScheduledMercadoLivreSync,
} from "@/lib/integrations/mercadoLivreScheduler";

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
  return NextResponse.json({
    ok: true,
    processed: results.length,
    reverified: reverify.length,
    durationMs: Math.round(performance.now() - startedAt),
    results,
    reverify,
  });
}
