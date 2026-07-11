import { NextRequest, NextResponse } from "next/server";
import { getDailySales } from "@/lib/sales";
import { resolvePeriod } from "@/lib/period";
import { withAccountContext } from "@/lib/withAccount";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withAccountContext(req, async () => {
    try {
      const series = await getDailySales(resolvePeriod(new URL(req.url).searchParams));
      return NextResponse.json({ series });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro desconhecido";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  });
}
