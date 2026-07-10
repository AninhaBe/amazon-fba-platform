import { NextRequest, NextResponse } from "next/server";
import { getProfitSummary } from "@/lib/profit";
import { withAccountContext } from "@/lib/withAccount";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withAccountContext(req, async () => {
    try {
      const days = Math.max(1, Math.min(180, Number(new URL(req.url).searchParams.get("days") || 30)));
      const summary = await getProfitSummary(days);
      return NextResponse.json({ summary });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro desconhecido";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  });
}
