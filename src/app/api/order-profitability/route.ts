import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/apiError";
import { getAmazonProfitability } from "@/lib/amazonProfitability";
import { resolvePeriod } from "@/lib/period";
import { withAccountContext } from "@/lib/withAccount";
import { getAmazonOverviewCanonicalCached } from "@/lib/integrations/amazonOverviewCanonical";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function canonicalLines(canonical: NonNullable<Awaited<ReturnType<typeof getAmazonOverviewCanonicalCached>>>) {
  return {
    lines: canonical.profitabilityLines,
    coverage: {
      completeLines: canonical.profitabilityLines.filter((line) => line.complete).length,
      totalLines: canonical.profitabilityLines.length,
    },
    scope: canonical.profitabilityScope,
  };
}

export async function GET(req: NextRequest) {
  const requestedPeriod = resolvePeriod(new URL(req.url).searchParams);
  return withAccountContext(req, async () => {
    try {
      const period = requestedPeriod;
      // Fase 5B: linhas de rentabilidade do canônico (SQL, até 1000 pedidos)
      // quando o período está coberto — substitui o cálculo ao vivo, que busca
      // itens pedido a pedido (limitado a 40) e é o mais lento do dashboard.
      const canonical = await getAmazonOverviewCanonicalCached(period);
      if (canonical?.covered) {
        return NextResponse.json(canonicalLines(canonical));
      }
      return NextResponse.json(await getAmazonProfitability(period));
    } catch (error) {
      return errorResponse(error);
    }
  }, {
    // Sem conta SP-API o cálculo ao vivo é impossível, mas as linhas do
    // canônico saem por SQL puro e não dependem de credencial.
    onMissingAccount: async () => {
      const canonical = await getAmazonOverviewCanonicalCached(requestedPeriod);
      if (!canonical) return null;
      return NextResponse.json(canonicalLines(canonical));
    },
  });
}
