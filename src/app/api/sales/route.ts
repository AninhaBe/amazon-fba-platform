import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/apiError";
import { getDailySales } from "@/lib/sales";
import { resolvePeriod } from "@/lib/period";
import { withAccountContext } from "@/lib/withAccount";
import { getAmazonOverviewCanonicalCached } from "@/lib/integrations/amazonOverviewCanonical";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const period = resolvePeriod(new URL(req.url).searchParams);
  return withAccountContext(
    req,
    async () => {
      try {
        const series = await getDailySales(period);
        return NextResponse.json({ series, source: "sales_api" });
      } catch (err) {
        return errorResponse(err);
      }
    },
    {
      // Sem conta SP-API o faturamento oficial (orderMetrics) é inalcançável.
      // Em vez de 409 com o painel vazio, serve o gross do canônico e diz que a
      // origem é outra — quem consome precisa saber que este número NÃO é o que
      // bate ao centavo com o Seller Central (docs/api-amazon-sp-api.md).
      onMissingAccount: async () => {
        const canonical = await getAmazonOverviewCanonicalCached(period);
        if (!canonical) return null;
        const points = canonical.dailySales;
        return NextResponse.json({
          series: {
            currency: canonical.currency,
            points,
            totalRevenue: +canonical.metrics.revenue.toFixed(2),
            totalOrders: canonical.metrics.paidOrders,
            totalUnits: points.reduce((total, point) => total + point.units, 0),
          },
          source: "canonical",
        });
      },
    }
  );
}
