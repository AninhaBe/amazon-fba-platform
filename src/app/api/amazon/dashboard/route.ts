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
import { adsEstaConectado, anunciosNoPeriodo } from "@/lib/integrations/amazonAdsSync";
import { anunciosPorProdutoNoPeriodo, cruzarComMargem } from "@/lib/integrations/amazonAdsPorProduto";
import { depoisDaResposta } from "@/lib/depoisDaResposta";

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
  /** Cupom resgatado no período: preço de tabela menos o que o comprador pagou. */
  cupom: string | null;
  /** Pedidos sem preço de tabela — com eles, o cupom acima é piso, não total. */
  sem_preco_de_tabela: string | null;
}

/**
 * Anúncio do período, no formato que os cards consomem.
 *
 * `esperadoAte` é o último dia que DEVERIA ter métrica: o fim do período, ou
 * HOJE se o período chega até aqui — a Amazon entrega o dia corrente (medido em
 * 25/08/2026: relatório de hoje voltou com R$ 17,53 em 105s).
 */
async function adsDoPeriodo(workspaceId: string, period: { startISO: string; endISO: string }) {
  const [resumo, conectado, porProduto] = await Promise.all([
    anunciosNoPeriodo(period.startISO, period.endISO),
    adsEstaConectado(),
    // Por SKU anunciado (migration 0016): é o que permite cruzar com a margem
    // real e dizer "paga para vender". Lê só do banco, como o resumo.
    anunciosPorProdutoNoPeriodo(period.startISO, period.endISO).catch(() => []),
  ]);
  if (!conectado) return { conectado: false, janela: null, resumo: null, porProduto: [] };

  const emBrasilia = (ms: number) => new Date(ms - 3 * 60 * 60_000).toISOString().slice(0, 10);
  const hoje = emBrasilia(Date.now());
  const inicioDia = emBrasilia(Date.parse(period.startISO));
  const fimDoPeriodo = emBrasilia(Date.parse(period.endISO));
  const esperadoAte = fimDoPeriodo < hoje ? fimDoPeriodo : hoje;
  void workspaceId; // o escopo já vem do contexto; explícito só na assinatura

  return {
    conectado: true,
    // Vai MESMO sem métrica: é a janela que distingue "sync atrasado" de
    // "a Amazon ainda não publicou o dia" — o caso do filtro "Hoje".
    // `incluiHoje` avisa a tela que o último dia da janela AINDA ESTÁ SOMANDO:
    // o gasto de hoje é real, mas cresce até a meia-noite e a venda atribuída
    // entra depois. Sem isso o ACOS de "Hoje" pareceria catastrófico às 9h.
    janela: { inicioDia, esperadoAte, incluiHoje: fimDoPeriodo >= hoje },
    porProduto,
    resumo: resumo && {
      cost: resumo.cost,
      sales: resumo.sales,
      purchases: resumo.purchases,
      ateDia: resumo.ateDia,
      esperadoAte,
    },
  };
}

export async function GET(req: NextRequest) {
  /**
   * O corpo inteiro lê do canônico — a conta SP-API só é usada para o sync sob
   * demanda (`conta?.refreshToken`), para o radar de estoque e para o
   * `orderMetrics`, e os três já degradam sozinhos. Por isso o mesmo handler
   * serve com e sem conta.
   */
  const responder = async () => {
    try {
      const period = resolvePeriod(req.nextUrl.searchParams);
      const t0 = performance.now();

      // ═══ O FATURAMENTO VEM ANTES DO LUCRO, E ISSO É DE PROPÓSITO ═══════════
      //
      // ⚠️ DECISÃO DELA, repetida QUATRO vezes, a última em caixa alta
      // (31/08/2026): *"TEM QUE ESQUECER O APURADO E LEVAR EM CONSIDERAÇÃO
      // SOMENTE O FATURAMENTO."*
      //
      // O lucro sai do MESMO número que o card de Faturamento exibe. Esse número
      // é o `orderMetrics` da Sales API — o que bate com o Seller Central e o que
      // ela confere. O canônico sozinho não o conhece (a Amazon omite
      // `OrderTotal` no pendente e o relatório All Orders se espaça a cada ~3h),
      // então ele é BUSCADO PRIMEIRO e INJETADO no produtor.
      //
      // ⚠️ POR QUE INJETAR E NÃO RECALCULAR DEPOIS: recalcular na rota criaria uma
      // SEGUNDA definição de lucro da Amazon, que é exatamente o defeito que o
      // commit 21a0540 removeu ("uma definição só"). Duas definições divergem na
      // primeira vez que alguém ajusta uma — e foi assim que a tela passou o dia
      // exibindo o resultado de um universo ao lado da receita de outro.
      //
      // Custo desta escolha, assumido: esta chamada sai do `Promise.all` e vira
      // serial. `getDailySales` tem SWR de 10 min, então o caminho quente não
      // paga nada; o frio paga uma ida a mais dentro do orçamento do ADR-017.
      const pedidosFeitos = await getDailySales(period, defaultMarketplaceId()).catch((error) => {
        console.error("[dashboard/amazon] orderMetrics indisponivel", error);
        return null;
      });

      const canonical = await getAmazonOverviewCanonicalCached(period, {
        // `null` = a Sales API não respondeu; o produtor cai na soma do banco e
        // a tela segue com a base que ele conseguir provar. Nunca zero.
        faturamentoDoPeriodo: pedidosFeitos?.totalRevenue ?? null,
      });
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
      const [feeRows, billingRows, radar, frescorRows] = await Promise.all([
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
                  COALESCE(SUM(buyer_shipping), 0)::text AS frete,
                  -- CUPOM RESGATADO — a diferença que fazia o Seller Central e o
                  -- NEXO discordarem sem explicação (22/08/2026): "Vendas de
                  -- produtos solicitados" é o preço de TABELA, antes do cupom; o
                  -- Faturamento aqui é o que o comprador pagou. Nos 15 dias dela
                  -- isso dava R$ 449,94 contra R$ 455,01, e a conta só fechava
                  -- somando à mão. O valor existe no banco desde sempre
                  -- (ordered_gross vs gross) e nunca esteve na tela.
                  --
                  -- Pendente entra como zero de propósito, não como cupom: sem
                  -- item conciliado o desconto é DESCONHECIDO, e gross nulo cai
                  -- no próprio ordered_gross pelo COALESCE acima. Assim a linha
                  -- exibida é exatamente Pedidos feitos − Faturamento, sem
                  -- inventar desconto que ainda não foi apurado.
                  COALESCE(SUM(ordered_gross - COALESCE(gross, ordered_gross)), 0)::text AS cupom,
                  -- Quantos pedidos NÃO têm preço de tabela. Sem ele o cupom
                  -- daquele pedido é desconhecido, e o total exibido vira um
                  -- PISO, não a diferença exata entre os dois cartões. Medido em
                  -- 23/08/2026: 864 de 1.717 pedidos numa das contas.
                  COUNT(*) FILTER (WHERE ordered_gross IS NULL)::text AS sem_preco_de_tabela
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
        // Frescor e cobertura do sync desta conexão. Vai no mesmo Promise.all
        // das outras consultas para não somar ida ao banco no caminho da tela.
        // covered_from/status/processed_orders alimentam a faixa de cobertura
        // do período na tela (frente K: período não importado nunca exibe zero).
        dbQuery<{ velho: boolean; covered_from: Date | string | null; covered_to: Date | string | null; status: string | null; processed_orders: number | null }>(
          `SELECT COALESCE(last_success_at, updated_at) < now() - ($3 || ' minutes')::interval AS velho,
                  covered_from, covered_to, status, processed_orders
             FROM workspace_marketplace_syncs
            WHERE workspace_id = $1 AND provider = 'amazon' AND connection_id = $2`,
          [workspaceId, canonical.connectionId, String(FRESCOR_MAXIMO_MINUTOS)]
        ),
      ]);

      // ANÚNCIO DO PERÍODO.
      //
      // Fica FORA do `Promise.all` acima de propósito: é a única consulta que
      // pode não ter tabela populada, e uma falha aqui não pode derrubar o
      // dashboard inteiro — o resto do financeiro continua válido sem ela.
      //
      // Lido de `workspace_ad_metrics`, nunca da Amazon: o relatório da Ads API
      // é assíncrono (11 min medidos em 25/08/2026) e não cabe numa tela.
      const ads = await adsDoPeriodo(workspaceId, period).catch((error) => {
        console.error("[dashboard/amazon] metricas de anuncio indisponiveis", error);
        return null;
      });

      const feeBreakdown = feeRows
        .map((r) => ({ type: r.fee_type, amount: Math.abs(Number(r.total ?? 0)) }))
        .filter((f) => f.amount > 0);
      const refunds = feeBreakdown.find((f) => /refund/i.test(f.type))?.amount ?? 0;
      // ⚠️ SEM NENHUMA LINHA DE TARIFA, "Taxas" É DESCONHECIDO — NÃO ZERO.
      //
      // Achado por ela em 30/08/2026: a tela mostrava "Taxas R$ 0,00 · Total do
      // período conciliado" num dia com 63 vendas. Medido no banco naquele dia:
      // NENHUM pedido tinha linha em `workspace_channel_order_fees` — nem os
      // enviados. Zero linhas viravam zero afirmado, porque o `reduce` parte de
      // `0` e `0` não é `null`.
      //
      // É o mesmo defeito que a Shopee e o Mercado Livre já tinham perdido; a
      // Amazon ficou. E aqui ele custa mais do que um card errado: `netProceeds`
      // é `revenueProcessed − fees`, então tarifa fabricada em zero SOBRA como
      // lucro que não existe.
      //
      // ⚠️ A distinção que a linha abaixo preserva: período conciliado COM linhas
      // e soma zero continua sendo `0` — "a Amazon não cobrou" é notícia, e a
      // promoção de vendedor novo realmente zera comissão. O que vira `null` é a
      // AUSÊNCIA de linha, que é outra coisa.
      const tarifasDoPeriodo = feeBreakdown.filter((f) => !/refund/i.test(f.type));
      const fees: number | null = feeRows.length === 0
        ? null
        : +tarifasDoPeriodo.reduce((sum, f) => sum + f.amount, 0).toFixed(2);
      const buyerShipping = Number(billingRows[0]?.frete ?? 0);
      // Bruto inclui o frete do comprador para espelhar o Seller Central (ADR-020).
      const faturamento = +(Number(billingRows[0]?.receita ?? 0) + buyerShipping).toFixed(2);
      const pedidosFaturados = Number(billingRows[0]?.pedidos ?? 0);
      const pedidosComValor = Number(billingRows[0]?.pedidos_com_valor ?? 0);
      // Só é fato quando há pedido com valor apurado. Sem isso, `null` — a tela
      // omite a linha em vez de afirmar "cupom R$ 0,00" num período que ainda
      // não foi conciliado (null ≠ 0, AGENTS.md).
      const cupom = pedidosComValor > 0 ? +Number(billingRows[0]?.cupom ?? 0).toFixed(2) : null;
      const cupomParcial = Number(billingRows[0]?.sem_preco_de_tabela ?? 0) > 0;

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
        depoisDaResposta("dashboard-amazon:sync", () =>
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
        // Período resolvido + cobertura do sync: a tela decide entre "não
        // vendeu" (fato) e "ainda não importei" (estado) — nunca zero fabricado.
        period: { from: period.startISO, to: period.endISO },
        sync: {
          connectionId: canonical.connectionId,
          coveredFrom: frescorRows[0]?.covered_from ? new Date(frescorRows[0].covered_from).toISOString() : null,
          coveredTo: frescorRows[0]?.covered_to ? new Date(frescorRows[0].covered_to).toISOString() : null,
          status: frescorRows[0]?.status ?? null,
          processedOrders: Number(frescorRows[0]?.processed_orders ?? 0),
        },
        currency: canonical.currency,
        // Faturamento do período — a MESMA definição em toda tela do produto.
        billing: { revenue: faturamento, orders: pedidosFaturados, ordersWithValue: pedidosComValor, coupon: cupom, couponPartial: cupomParcial },
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
          // Repasse desconhecido enquanto a tarifa for desconhecida: subtrair
          // `0` aqui devolveria o mesmo número inflado por outro caminho.
          netProceeds: fees == null ? null : +(canonical.profit.revenueProcessed - fees).toFixed(2),
          currency: canonical.currency,
          orderCount: canonical.metrics.paidOrders,
          units: canonical.profit.unitsWithCost + canonical.profit.unitsWithoutCost,
          daily: canonical.dailySales.map((d) => ({ date: d.date, revenue: d.revenue, orders: d.orders, units: d.units })),
          buyerShipping,
          feeBreakdown,
        },
        // Anúncio fora de `finance`: não vem do extrato financeiro da Amazon,
        // vem da Ads API. Misturar as duas origens dentro do mesmo objeto foi
        // exatamente o que fez o card "Anúncios" procurar gasto de mídia numa
        // tabela de tarifa de pedido e sempre achar zero.
        ads: ads?.resumo ?? null,
        adsJanela: ads?.janela ?? null,
        adsConectado: ads?.conectado ?? false,
        // Por SKU anunciado, já cruzado com a margem real de cada produto — o
        // canal não tem a segunda metade, e é ela que vira o veredito.
        adsPorProduto: cruzarComMargem(
          ads?.porProduto ?? [],
          canonical.topProducts.map((produto) => ({ sku: produto.sku, marginPct: produto.marginPct })),
        ),
        profitabilityLines: canonical.profitabilityLines,
        profitabilityScope: canonical.profitabilityScope,
        recentOrders: canonical.recentOrders,
        radar,
        durationMs,
      });
    } catch (error) {
      return errorResponse(error);
    }
  };

  return withAccountContext(req, responder, {
    // SEM NENHUMA CONTA, A TELA MOSTRA O QUE O BANCO TEM — não um erro.
    //
    // O workspace de demonstração tem conexão Amazon (`amazon:demo`,
    // `metadata.demo = true`) e pedidos no canônico, mas NÃO tem linha em
    // `workspace_accounts` — token sintético não é credencial. Sem este
    // fallback, `withAccountContext` respondia 409 "Conecte uma conta Amazon"
    // antes de o handler rodar, e `/amazon` inteira caía em estado de falha
    // enquanto a Visão geral, que lê o mesmo canônico, mostrava os números.
    //
    // ⚠️ NÃO afeta conta real com token caído: essa TEM linha em
    // `workspace_accounts`, então `accounts.length > 0` e este ramo nunca roda —
    // ela continua entrando no caminho normal, e a falha de autorização continua
    // aparecendo como sempre. A separação é essa, e é estrutural: o ramo é
    // "não há credencial nenhuma", não "a credencial não funciona".
    onMissingAccount: responder,
  });
}
