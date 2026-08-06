import { NextRequest, NextResponse } from "next/server";
import { runScheduledShopeeSync } from "@/lib/integrations/shopeeScheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 240;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const startedAt = performance.now();
  const results = await runScheduledShopeeSync();
  return NextResponse.json({
    ok: true,
    processed: results.length,
    durationMs: Math.round(performance.now() - startedAt),
    results,
  });
}
