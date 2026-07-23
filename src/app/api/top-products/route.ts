import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/apiError";
import { getTopProducts } from "@/lib/topProducts";
import { resolvePeriod } from "@/lib/period";
import { withAccountContext } from "@/lib/withAccount";
import { getAmazonOverviewCanonicalCached } from "@/lib/integrations/amazonOverviewCanonical";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withAccountContext(req, async () => {
    try {
      const period = resolvePeriod(new URL(req.url).searchParams);
      // Fase 5B: top produtos do canônico (SQL) quando o período está coberto;
      // senão cai no cálculo ao vivo.
      const canonical = await getAmazonOverviewCanonicalCached(period);
      const products = canonical?.covered ? canonical.topProducts : await getTopProducts(period, 10);
      return NextResponse.json({ products });
    } catch (err) {
      return errorResponse(err);
    }
  });
}
