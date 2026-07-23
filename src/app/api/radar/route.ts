import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/apiError";
import { getStockRadar } from "@/lib/radar";
import { resolvePeriod } from "@/lib/period";
import { withAccountContext } from "@/lib/withAccount";
import { getAmazonOverviewCanonicalCached } from "@/lib/integrations/amazonOverviewCanonical";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withAccountContext(req, async () => {
    try {
      const period = resolvePeriod(new URL(req.url).searchParams);
      // Fase 5B: velocidade do canônico (SQL rápido) quando o período está
      // coberto pelo sync; senão cai na Sales Velocity ao vivo. O estoque
      // atual continua vindo do FBA Inventory (não há tabela canônica dele).
      const canonical = await getAmazonOverviewCanonicalCached(period);
      const rows = await getStockRadar(period, canonical?.covered ? canonical.velocityBySku : undefined);
      return NextResponse.json({ rows, windowDays: period.days });
    } catch (err) {
      return errorResponse(err);
    }
  });
}
