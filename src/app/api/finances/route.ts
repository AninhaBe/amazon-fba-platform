import { NextRequest, NextResponse } from "next/server";
import { getFinanceSummary } from "@/lib/finances";
import { resolvePeriod } from "@/lib/period";
import { withAccountContext } from "@/lib/withAccount";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withAccountContext(req, async () => {
    try {
      const summary = await getFinanceSummary(resolvePeriod(new URL(req.url).searchParams));
      return NextResponse.json({ summary });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro desconhecido";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  });
}
