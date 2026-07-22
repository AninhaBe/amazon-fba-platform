import { after } from "next/server";
import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/apiError";
import { getOrders, summarizeOrders } from "@/lib/orders";
import { cached } from "@/lib/cache";
import { resolvePeriod } from "@/lib/period";
import { withAccountContext } from "@/lib/withAccount";
import { getDailySales } from "@/lib/sales";
import { currentAccount } from "@/lib/accountContext";
import { runAmazonSyncBatch } from "@/lib/integrations/amazonSync";
import { currentWorkspaceId, runWithWorkspace } from "@/lib/workspaceScope";
import { hasDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withAccountContext(req, async () => {
  try {
    const period = resolvePeriod(new URL(req.url).searchParams);

    // Fase 5 da migração canônica: cada visita ao dashboard empurra a
    // ingestão de pedidos da Amazon em segundo plano, fora da resposta.
    const account = currentAccount();
    if (hasDb() && account) {
      const workspaceId = currentWorkspaceId();
      after(() => runWithWorkspace(workspaceId, () =>
        runAmazonSyncBatch(account).catch((error) => {
          console.error("Falha ao avançar sincronização da Amazon", {
            sellerId: account.sellerId,
            reason: error instanceof Error ? error.message : "Erro desconhecido",
          });
        })
      ));
    }

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
