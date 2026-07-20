import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/apiError";
import { resolvePeriod } from "@/lib/period";
import { getTransactionSummary } from "@/lib/transactions";
import { withAccountContext } from "@/lib/withAccount";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withAccountContext(req, async () => {
    try {
      const summary = await getTransactionSummary(resolvePeriod(new URL(req.url).searchParams));
      return NextResponse.json({ summary });
    } catch (error) {
      return errorResponse(error);
    }
  });
}
