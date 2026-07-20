import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/apiError";
import { resolvePeriod } from "@/lib/period";
import { getTrafficSummary } from "@/lib/traffic";
import { withAccountContext } from "@/lib/withAccount";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withAccountContext(req, async () => {
    try {
      const result = await getTrafficSummary(resolvePeriod(new URL(req.url).searchParams));
      if (result.status === "pending") {
        return NextResponse.json({ status: "pending" }, { status: 202 });
      }
      return NextResponse.json({ status: "ready", summary: result.summary });
    } catch (error) {
      return errorResponse(error);
    }
  });
}
