import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/apiError";
import { getAmazonProfitability } from "@/lib/amazonProfitability";
import { resolvePeriod } from "@/lib/period";
import { withAccountContext } from "@/lib/withAccount";
import { getAmazonOverviewCanonicalCached } from "@/lib/integrations/amazonOverviewCanonical";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withAccountContext(req, async () => {
    try {
      const period = resolvePeriod(new URL(req.url).searchParams);
      // Fase 5B: linhas de rentabilidade do canônico (SQL, até 1000 pedidos)
      // quando o período está coberto — substitui o cálculo ao vivo, que busca
      // itens pedido a pedido (limitado a 40) e é o mais lento do dashboard.
      const canonical = await getAmazonOverviewCanonicalCached(period);
      if (canonical?.covered) {
        return NextResponse.json({
          lines: canonical.profitabilityLines,
          coverage: {
            completeLines: canonical.profitabilityLines.filter((line) => line.complete).length,
            totalLines: canonical.profitabilityLines.length,
          },
          scope: canonical.profitabilityScope,
        });
      }
      return NextResponse.json(await getAmazonProfitability(period));
    } catch (error) {
      return errorResponse(error);
    }
  });
}
