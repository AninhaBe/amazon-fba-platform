import { NextRequest, NextResponse } from "next/server";
import { getOrders, summarizeOrders } from "@/lib/orders";
import { cached } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const days = Math.max(1, Math.min(90, Number(searchParams.get("days") || 30)));

    // Cache/dedupe: monitor e dashboard pedem a mesma lista ao mesmo tempo.
    const orders = await cached(`orders-list:${days}`, 120_000, async () => {
      // A SP-API exige que CreatedAfter seja pelo menos 2 minutos antes de agora.
      const createdAfter = new Date(Date.now() - days * 86_400_000).toISOString();
      const res = await getOrders({ createdAfter, maxResults: 50 });
      return res.orders;
    });
    const metrics = summarizeOrders(orders);

    return NextResponse.json({ metrics, orders });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
