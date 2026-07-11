import { NextRequest, NextResponse } from "next/server";
import { getOrders, summarizeOrders } from "@/lib/orders";
import { cached } from "@/lib/cache";
import { resolvePeriod } from "@/lib/period";
import { withAccountContext } from "@/lib/withAccount";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withAccountContext(req, async () => {
  try {
    const period = resolvePeriod(new URL(req.url).searchParams);

    // Cache/dedupe: monitor e dashboard pedem a mesma lista ao mesmo tempo.
    const orders = await cached(`orders-list:${period.key}`, 120_000, async () => {
      const res = await getOrders({
        createdAfter: period.startISO,
        createdBefore: period.endISO,
        maxResults: 50,
      });
      return res.orders;
    });
    const metrics = summarizeOrders(orders);

    return NextResponse.json({ metrics, orders });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
  });
}
