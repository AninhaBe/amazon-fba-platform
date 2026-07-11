import { NextRequest, NextResponse } from "next/server";
import { getStockRadar } from "@/lib/radar";
import { resolvePeriod } from "@/lib/period";
import { withAccountContext } from "@/lib/withAccount";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withAccountContext(req, async () => {
    try {
      const period = resolvePeriod(new URL(req.url).searchParams);
      const rows = await getStockRadar(period);
      return NextResponse.json({ rows, windowDays: period.days });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro desconhecido";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  });
}
