import { after } from "next/server";
import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/apiError";
import { resolvePeriod } from "@/lib/period";
import { withAccountContext } from "@/lib/withAccount";
import { getAmazonOverviewCanonicalCached } from "@/lib/integrations/amazonOverviewCanonical";
import { getStockRadar } from "@/lib/radar";
import { dbQuery } from "@/lib/db";
import { currentWorkspaceId, runWithWorkspace } from "@/lib/workspaceScope";
import { currentAccount, runWithAccount } from "@/lib/accountContext";
import { runAmazonSyncBatch } from "@/lib/integrations/amazonSync";
import { getDailySales } from "@/lib/sales";
import { defaultMarketplaceId } from "@/lib/spapi";

// Frescor aceitável antes de buscar de novo ao abrir a tela.
//
// O agendador de fundo só reconsidera uma conexão `complete` a cada 6 HORAS
// (amazonScheduler.ts). Como abrir /amazon não disparava nada, o painel podia
// mostrar dado de horas atrás sem qualquer aviso — medido em 21/08/2026 na conta
// do sócio: último pedido ingerido às 16:05, tela aberta às 20:24, R$ 204 de
// vendas simplesmente ausentes. O Mercado Livre já dispara sync ao abrir a
// visão; a Amazon não, e era essa a origem de "os números não batem".
//
// Cinco minutos é o piso: abrir a tela dez vezes seguidas não vira dez varreduras
// na SP-API, que é rate-limited de verdade.
const FRESCOR_MAXIMO_MINUTOS = 5;

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
  /** Quantos dos `pedidos` já têm valor conhecido. Menor que `pedidos` = há pendente sem valor. */
  pedidos_com_valor: string;
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
      const [feeRows, billingRows, radar, pedidosFeitos, frescorRows] = await Promise.all([
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
                  -- Quantos desses pedidos TÊM valor. COUNT(*) conta todos e
                  -- SUM(gross) soma só quem tem — emparelhar os dois no cartão
                  -- produzia "R$ 0,00 · 1 pedido", que se contradiz na própria
                  -- linha (visto em 22/08/2026, com o único pedido do dia ainda
                  -- pendente). O cartão precisa poder dizer quantos faltam.
                  COUNT(COALESCE(gross, ordered_gross))::text AS pedidos_com_valor,
                  -- COALESCE com ordered_gross: a Amazon omite OrderTotal enquanto
                  -- o pedido está Pending, mas o valor de TABELA foi capturado do
                  -- relatório (migrations/0010). Sem isto, a tela mostrava
                  -- "R$ 0,00" para uma venda que o Seller Central já exibia com
                  -- valor — 22/08/2026, venda de R$ 21,90 às 17:32.
                  COALESCE(SUM(COALESCE(gross, ordered_gross)), 0)::text AS receita,
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
        // PEDIDOS FEITOS — o número do Seller Central ("Vendas de produtos
        // solicitadas"), que INCLUI pendentes e cancelados.
        //
        // Vem da Sales API porque o canônico não consegue produzir este número: a
        // Amazon omite `OrderTotal` enquanto o pedido está `Pending`, então os
        // pendentes existem no banco sem valor. Medido em 21/08/2026 na conta dela:
        // R$ 360,99 conciliado contra R$ 516,27 no Seller Central — a diferença
        // eram 4 pedidos sem valor, e ela passou a noite conferindo à mão porque a
        // tela mostrava um número só, sem dizer qual era.
        //
        // Não fura o orçamento de 1s (ADR-017): `getDailySales` já tem SWR de 10
        // min, então o caminho quente lê do cache. Falha aqui devolve `null` e a
        // tela mostra só o conciliado — degradação limpa, nunca zero.
        getDailySales(period, defaultMarketplaceId()).catch((error) => {
          console.error("[dashboard/amazon] orderMetrics indisponivel", error);
          return null;
        }),
        // Frescor do sync desta conexão. Vai no mesmo Promise.all das outras
        // consultas para não somar ida ao banco no caminho da tela.
        dbQuery<{ velho: boolean }>(
          `SELECT COALESCE(last_success_at, updated_at) < now() - ($3 || ' minutes')::interval AS velho
             FROM workspace_marketplace_syncs
            WHERE workspace_id = $1 AND provider = 'amazon' AND connection_id = $2`,
          [workspaceId, canonical.connectionId, String(FRESCOR_MAXIMO_MINUTOS)]
        ),
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
      const pedidosComValor = Number(billingRows[0]?.pedidos_com_valor ?? 0);

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

      // Busca sob demanda, DEPOIS de responder — `after` não entra no orçamento
      // de 1s do ADR-017. A tela sai com o dado que já existe; a próxima abertura
      // pega o que esta varredura trouxer.
      // Sem linha de sync ainda = conexão nova, então buscar é o certo.
      const sincronizacaoVelha = frescorRows[0]?.velho ?? true;
      const conta = currentAccount();
      if (conta?.refreshToken && sincronizacaoVelha) {
        after(() =>
          runWithWorkspace(workspaceId, () =>
            runWithAccount(conta, async () => {
              try {
                // 3 passos, não os 6 do cron: aqui o objetivo é alcançar o que
                // chegou nas últimas horas, não varrer histórico.
                //
                // O terceiro argumento (forçar janela) é o que faz isto funcionar:
                // sem ele o sync vê `status = complete`, recusa abrir janela nova
                // por causa do FRESH_FOR_MS de 6h, e só reconcilia itens — a tela
                // continuava presa em dado de horas atrás (21/08/2026).
                await runAmazonSyncBatch(conta, 3, true);
              } catch (error) {
                // Falha aqui não pode afetar a tela — ela já respondeu.
                console.error("[dashboard/amazon] sync sob demanda falhou", error);
              }
            })
          )
        );
      }

      return NextResponse.json({
        source: "canonical" as const,
        covered: canonical.covered,
        currency: canonical.currency,
        // Faturamento do período — a MESMA definição em toda tela do produto.
        billing: { revenue: faturamento, orders: pedidosFaturados, ordersWithValue: pedidosComValor },
        // PEDIDOS FEITOS — o mesmo número do Seller Central, com pendentes e
        // cancelados dentro. Fica ao lado do conciliado, nunca no lugar dele:
        // são perguntas diferentes (ADR-020) e a tela precisa dizer qual é qual.
        // `null` quando a Sales API não respondeu — a tela omite o card em vez de
        // inventar zero.
        ordered: pedidosFeitos
          ? {
              revenue: pedidosFeitos.totalRevenue,
              orders: pedidosFeitos.totalOrders,
              units: pedidosFeitos.totalUnits,
              // A série diária vai junto: o gráfico se chama "pedidos recebidos" e
              // vinha do canônico, que só conta aprovadas. Resultado — 21/08/2026,
              // 22:58: a vendedora tinha um pedido feito às 21:12 e o gráfico
              // marcava ZERO no dia, porque o pedido ainda estava `pending` e
              // pendente não tem valor no canônico.
              points: pedidosFeitos.points,
            }
          : null,
        // Canceladas: somadas no bruto (ADR-020) e exibidas à parte, como no ML.
        cancelled: {
          revenue: canonical.metrics.cancelledRevenue,
          orders: canonical.metrics.cancelledOrders,
          // Cobertura: a Amazon zera o pedido ao cancelar, então só tem valor o
          // que foi capturado ANTES (migrations/0010). Sem este número a tela
          // apresenta soma parcial como se fosse total.
          ordersWithValue: canonical.metrics.cancelledOrdersWithValue,
          ordersEstimated: canonical.metrics.cancelledOrdersEstimated,
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
