import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/apiError";
import { getAmazonProfitability } from "@/lib/amazonProfitability";
import { resolvePeriod } from "@/lib/period";
import { withAccountContext } from "@/lib/withAccount";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withAccountContext(req, async () => {
    try {
      return NextResponse.json(await getAmazonProfitability(resolvePeriod(new URL(req.url).searchParams)));
    } catch (error) {
      return errorResponse(error);
    }
  });
}
