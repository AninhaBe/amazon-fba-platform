import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/apiError";
import { getOrders, summarizeOrders } from "@/lib/orders";
import { cached } from "@/lib/cache";
import { resolvePeriod } from "@/lib/period";
import { withAccountContext } from "@/lib/withAccount";
import { getDailySales } from "@/lib/sales";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withAccountContext(req, async () => {
  try {
    const period = resolvePeriod(new URL(req.url).searchParams);

    // Cache/dedupe: monitor e dashboard pedem a mesma lista ao mesmo tempo.
    const [orders, sales] = await Promise.all([cached(`orders-list:${period.key}`, 120_000, async () => {
      const res = await getOrders({
        createdAfter: period.startISO,
        createdBefore: period.endISO,
        maxResults: 50,
      });
      return res.orders;
    }), getDailySales(period)]);
    const recentMetrics = summarizeOrders(orders);
    const metrics = {
      ...recentMetrics,
      totalOrders: sales.totalOrders,
      totalRevenue: sales.totalRevenue,
      currency: sales.currency,
      recentOrderCount: orders.length,
    };

    return NextResponse.json({ metrics, orders });
  } catch (err) {
    return errorResponse(err);
  }
  });
}
