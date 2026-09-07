import { NextRequest, NextResponse } from "next/server";
import { portaoDoCron } from "@/lib/portaoDoCronHttp";
import { runScheduledShopeeSync } from "@/lib/integrations/shopeeScheduler";
import { runComoFundo } from "@/lib/execucaoDeFundo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 240;

export async function GET(req: NextRequest) {
  const recusa = portaoDoCron(req);
  if (recusa) return recusa;

  return runComoFundo(async () => {
    const startedAt = performance.now();
    const results = await runScheduledShopeeSync();
    return NextResponse.json({
      ok: true,
      processed: results.length,
      durationMs: Math.round(performance.now() - startedAt),
      results,
    });
  });
}
