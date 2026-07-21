import { NextRequest, NextResponse } from "next/server";
import { runScheduledMercadoLivreSync } from "@/lib/integrations/mercadoLivreScheduler";

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
  return NextResponse.json({
    ok: true,
    processed: results.length,
    durationMs: Math.round(performance.now() - startedAt),
    results,
  });
}
