import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/apiError";
import { resolvePeriod } from "@/lib/period";
import { withAccountContext } from "@/lib/withAccount";
import { getAmazonOverviewCanonicalCached } from "@/lib/integrations/amazonOverviewCanonical";
import { getStockRadar } from "@/lib/radar";
import { dbQuery } from "@/lib/db";
import { currentWorkspaceId } from "@/lib/workspaceScope";

// Rota agregadora do dashboard Amazon — ver ADR-017.
//
// Uma tela = uma chamada: o navegador fazia 6 requisições por troca de período,
// e as bibliotecas por trás delas consultavam a SP-API ao vivo, paginando
// pedidos — por isso o tempo de tela crescia com o tamanho da conta (segundos
// numa conta de 21 mil pedidos) e ficava refém do throttling da Amazon.
//
// Aqui tudo vem do banco canônico: pedidos e série diária de
// `workspace_channel_orders`, tarifas por tipo de `workspace_channel_order_fees`
// (medido em 19/08/2026: 9.262 pedidos agregados em 21ms).
//
// ⚠️ Exceção documentada: o RADAR de estoque depende do inventário FBA, que não
// tem casa no canônico — vem da SP-API com SWR de 10 minutos (src/lib/inventory).
// É chamada leve (sem paginação de pedidos) e falha dela não derruba a tela:
// radar sai `null`. A velocidade de venda, que era a parte cara, vem do canônico.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface FeeRow {
  fee_type: string;
  total: string | null;
}
interface ShippingRow {
  buyer_shipping: string | null;
}

export async function GET(req: NextRequest) {
  return withAccountContext(req, async () => {
    try {
      const period = resolvePeriod(req.nextUrl.searchParams);
      const t0 = performance.now();

      const canonical = await getAmazonOverviewCanonicalCached(period);
      if (!canonical) {
        // Sem cobertura canônica não há o que agregar. Dizer isso é melhor que
        // cair silenciosamente na SP-API — é o gap aparecendo (ADR-017).
        return NextResponse.json(
          { error: "O sync ainda não cobriu este período. Aguarde a próxima sincronização ou dispare uma atualização." },
          { status: 503 }
        );
      }

      const workspaceId = currentWorkspaceId();
      const scope = [workspaceId, canonical.connectionId, period.startISO, period.endISO];

      // Tarifas por tipo e frete do comprador, em paralelo com o radar. Os nomes
      // canônicos (commission, fulfillment, refund) casam com os padrões que os
      // cartões financeiros usam para categorizar (amazonFinancialCards.ts).
      const [feeRows, shippingRows, radar] = await Promise.all([
        dbQuery<FeeRow>(
          `SELECT f.fee_type, SUM(f.amount)::text AS total
             FROM workspace_channel_order_fees f
             JOIN workspace_channel_orders o
               ON o.workspace_id = f.workspace_id
              AND o.provider = f.provider
              AND o.connection_id = f.connection_id
              AND o.external_order_id = f.external_order_id
            WHERE f.workspace_id = $1 AND f.provider = 'amazon' AND f.connection_id = $2
              AND o.occurred_at BETWEEN $3 AND $4
            GROUP BY f.fee_type`,
          scope
        ),
        dbQuery<ShippingRow>(
          `SELECT SUM(buyer_shipping)::text AS buyer_shipping
             FROM workspace_channel_orders
            WHERE workspace_id = $1 AND provider = 'amazon' AND connection_id = $2
              AND occurred_at BETWEEN $3 AND $4
              AND status <> 'cancelled'`,
          scope
        ),
        getStockRadar(period, canonical.velocityBySku).catch(() => null),
      ]);

      const feeBreakdown = feeRows
        .map((r) => ({ type: r.fee_type, amount: Math.abs(Number(r.total ?? 0)) }))
        .filter((f) => f.amount > 0);
      const refunds = feeBreakdown.find((f) => /refund/i.test(f.type))?.amount ?? 0;
      // "Taxas" é a autoridade sobre o total; estorno é devolução, não tarifa.
      const fees = +feeBreakdown
        .filter((f) => !/refund/i.test(f.type))
        .reduce((sum, f) => sum + f.amount, 0)
        .toFixed(2);
      const buyerShipping = Number(shippingRows[0]?.buyer_shipping ?? 0);

      const durationMs = Math.round(performance.now() - t0);
      return NextResponse.json({
        source: "canonical" as const,
        covered: canonical.covered,
        currency: canonical.currency,
        metrics: canonical.metrics,
        dailySales: canonical.dailySales,
        topProducts: canonical.topProducts,
        profit: canonical.profit,
        // O formato que os cartões financeiros já consomem (ProfitData.finance).
        finance: {
          revenue: canonical.profit.revenueProcessed,
          fees,
          refunds,
          netProceeds: +(canonical.profit.revenueProcessed - fees).toFixed(2),
          currency: canonical.currency,
          orderCount: canonical.metrics.paidOrders,
          units: canonical.profit.unitsWithCost + canonical.profit.unitsWithoutCost,
          daily: canonical.dailySales.map((d) => ({ date: d.date, revenue: d.revenue, orders: d.orders, units: d.units })),
          buyerShipping,
          feeBreakdown,
        },
        profitabilityLines: canonical.profitabilityLines,
        profitabilityScope: canonical.profitabilityScope,
        recentOrders: canonical.recentOrders,
        radar,
        durationMs,
      });
    } catch (error) {
      return errorResponse(error);
    }
  });
}
