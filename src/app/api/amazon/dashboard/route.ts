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
interface BillingRow {
  pedidos: string;
  receita: string | null;
  frete: string | null;
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

      let radarMs = 0;
      const workspaceId = currentWorkspaceId();
      const scope = [workspaceId, canonical.connectionId, period.startISO, period.endISO];

      // Tarifas por tipo e frete do comprador, em paralelo com o radar. Os nomes
      // canônicos (commission, fulfillment, refund) casam com os padrões que os
      // cartões financeiros usam para categorizar (amazonFinancialCards.ts).
      const [feeRows, billingRows, radar] = await Promise.all([
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
              -- Só pedidos JÁ conciliados por item: a cascata do "Financeiro
              -- conciliado" tem de somar receita e tarifa do MESMO conjunto.
              -- Sem este filtro, tarifas de 1.536 pedidos apareciam ao lado da
              -- receita de 883 — e a tela exibia "Taxas > Faturamento" (20/08).
              AND EXISTS (
                SELECT 1 FROM workspace_channel_order_items i
                 WHERE i.workspace_id = o.workspace_id AND i.provider = o.provider
                   AND i.connection_id = o.connection_id AND i.external_order_id = o.external_order_id
              )
            GROUP BY f.fee_type`,
          scope
        ),
        // FATURAMENTO BRUTO — espelha o "Vendas brutas" do Seller Central, que é
        // a visão que a vendedora conhece e usa para conferir (ADR-020): pedidos
        // NÃO cancelados (inclui pendentes), somando produto + frete do comprador.
        // Medido 20/08: R$ 36.033 canônico contra R$ 36.523 da Sales API — a
        // diferença são pendentes ainda sem valor postado pela Amazon.
        //
        // ⚠️ É pergunta DIFERENTE da receita conciliada (só aprovadas, com item e
        // tarifa casados), que vive na seção "Financeiro conciliado" e é a visão
        // que o marketplace NÃO oferece. Emparelhar as duas produziu
        // "Taxas > Faturamento" na tela (20/08).
        dbQuery<BillingRow>(
          `SELECT COUNT(*)::text AS pedidos,
                  COALESCE(SUM(gross), 0)::text AS receita,
                  COALESCE(SUM(buyer_shipping), 0)::text AS frete
             FROM workspace_channel_orders
            WHERE workspace_id = $1 AND provider = 'amazon' AND connection_id = $2
              AND occurred_at BETWEEN $3 AND $4
              AND status <> 'cancelled'`,
          scope
        ),
        (async () => {
          const t = performance.now();
          const r = await getStockRadar(period, canonical.velocityBySku).catch(() => null);
          radarMs = Math.round(performance.now() - t);
          return r;
        })(),
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
      const buyerShipping = Number(billingRows[0]?.frete ?? 0);
      // Bruto inclui o frete do comprador para espelhar o Seller Central (ADR-020).
      const faturamento = +(Number(billingRows[0]?.receita ?? 0) + buyerShipping).toFixed(2);
      const pedidosFaturados = Number(billingRows[0]?.pedidos ?? 0);

      const durationMs = Math.round(performance.now() - t0);
      // ADR-017 fixou orçamento de 1s por interação, com < 200ms para a camada de
      // dados. Sem registrar, "está rápido?" vira opinião — e o custo real só
      // aparece na conta grande, que ninguém abre por acidente. `radarMs` separa
      // a única ida externa que sobrou (inventário FBA, SWR de 10 min): quando o
      // cache expira, ela entra no caminho da tela.
      const acima = durationMs > 800 ? " ⚠️ ACIMA DO ORÇAMENTO" : "";
      console.log(
        `[dashboard/amazon] ${durationMs}ms (radar ${radarMs}ms, ${canonical.metrics.totalOrders} pedidos no período)${acima}`
      );
      return NextResponse.json({
        source: "canonical" as const,
        covered: canonical.covered,
        currency: canonical.currency,
        // Faturamento do período — a MESMA definição em toda tela do produto.
        billing: { revenue: faturamento, orders: pedidosFaturados },
        // Canceladas: somadas no bruto (ADR-020) e exibidas à parte, como no ML.
        cancelled: {
          revenue: canonical.metrics.cancelledRevenue,
          orders: canonical.metrics.cancelledOrders,
        },
        metrics: canonical.metrics,
        dailySales: canonical.dailySales,
        topProducts: canonical.topProducts,
        profit: canonical.profit,
        // O formato que os cartões financeiros já consomem (ProfitData.finance).
        // Cascata do conciliado: receita, tarifas e repasse do MESMO conjunto de
        // pedidos (os que já têm item e tarifa casados). Subconjunto do
        // faturamento acima — a seção da tela declara a cobertura.
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
