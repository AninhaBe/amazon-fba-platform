import { NextRequest, NextResponse } from "next/server";
import { runScheduledAmazonSync } from "@/lib/integrations/amazonScheduler";
import { runScheduledAmazonWarm } from "@/lib/integrations/amazonWarm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 240;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const startedAt = performance.now();
  const results = await runScheduledAmazonSync();
  // Aquece os caches dos períodos comuns após sincronizar (best-effort).
  const warmed = await runScheduledAmazonWarm().catch(() => 0);
  return NextResponse.json({
    ok: true,
    processed: results.length,
    warmed,
    durationMs: Math.round(performance.now() - startedAt),
    results,
  });
}
