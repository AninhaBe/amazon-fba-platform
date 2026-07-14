import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/apiError";
import { getProfitSummary } from "@/lib/profit";
import { resolvePeriod } from "@/lib/period";
import { withAccountContext } from "@/lib/withAccount";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withAccountContext(req, async () => {
    try {
      const summary = await getProfitSummary(resolvePeriod(new URL(req.url).searchParams));
      return NextResponse.json({ summary });
    } catch (err) {
      return errorResponse(err);
    }
  });
}
