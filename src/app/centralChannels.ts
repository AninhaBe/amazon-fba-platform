// Coleta cross-channel da operação — a MESMA fonte para a Visão geral e para o
// briefing. Extraída de page.tsx para o NEXO poder raciocinar sobre a história
// financeira (faturamento, margem, quem parou de vender) em qualquer tela, não
// só na central. Datas presentes em um canal e ausentes no outro entram como estão.

import type { DailyPoint } from "./components/RevenueChart";
import {
  aggregateShopeeStores,
  centralProviderReadState,
  connectedShopeeConnectionIds,
  type CentralShopeeResponse,
} from "./OverviewShopeeModel";

export type { DailyPoint };

interface ProviderConnection { id: string; status: string; }
export interface Provider {
  id: string;
  name: string;
  configured: boolean;
  connections: ProviderConnection[];
  issue?: { status: "attention"; code: "OWNERSHIP_CONFLICT" | "PROVIDER_READ_FAILED"; message: string };
}
interface AmazonProfit { estimatedProfit: number; unitsWithoutCost: number; finance: { currency: string } }
interface AmazonSales { series: { totalRevenue: number; totalOrders: number; currency: string; points?: DailyPoint[] } }
interface MercadoLivreOverview { metrics: { revenue30d: number; orders30d: number; activeListings: number; cancelledRevenue: number; cancelledOrders: number; currency: string; revenueCoverage: { complete: boolean; capturedOrders: number; totalOrders: number; sincronizadoAte?: string | null; historicoDesde?: string | null } }; profit: { estimatedProfit: number; unitsWithoutCost: number; coverage: { processedOrders: number; paidOrders: number; complete: boolean } }; dailySales?: DailyPoint[] }
interface TiktokOverviewResponse {
  overview: { revenue: number | null; profit: number | null; currency: string } | null;
  orders?: number;
  dailySeries?: DailyPoint[];
  coverage?: { requestedPeriod?: { revenue?: { status: "complete" | "partial" | "pending" } } } | null;
}

export interface ChannelSnapshot {
  id: "amazon" | "mercado_livre" | "shopee" | "tiktok_shop";
  name: string;
  href: string;
  connected: boolean;
  attention?: boolean;
  revenue: number | null;
  profit: number | null;
  profitPartial?: boolean;
  /** Faturamento servido pelo modelo canônico, não pelo orderMetrics oficial. */
  revenueFromCanonical?: boolean;
  /** O faturamento chegou mas a rota de lucro falhou — não é "lucro zero". */
  lucroIndisponivel?: boolean;
  cancelled?: number;
  orders: number | null;
  currency: string;
  note: string;
  error?: string;
  /** Série diária do próprio canal, retida para o seletor do gráfico e o motor de tendência. */
  series?: DailyPoint[];
  /** Unidades vendidas sem custo cadastrado — alimenta o alerta de lucro subestimado. */
  unitsWithoutCost?: number;
}

/**
 * Por que a leitura do canal está incompleta — em DATAS, não em contagem.
 *
 * A mensagem antiga dizia "Sincronização ainda não cobre todo o período;
 * N pedido(s) capturados", e ela cobrou com razão em 23/08/2026: *"não existe
 * isso de ter 45 pedidos e falar que cobriu 30"*. Dois defeitos somados:
 *
 * 1. O ramo "N de M pedidos" era CÓDIGO MORTO — a origem manda o mesmo valor
 *    nos dois campos, então a condição nunca podia ser verdadeira.
 * 2. O que sobrava exibia uma contagem de pedidos para explicar algo que não
 *    tem a ver com contagem. Cobertura é a JANELA que o sync já importou.
 *
 * Medido na conta dela no mesmo dia: o Mercado Livre estava sincronizado até
 * 04:33 e o período ia até aquele instante — uma defasagem de 8 horas. Nenhum
 * pedido faltava; o sync é que estava atrasado. São problemas diferentes, com
 * ações diferentes, e a frase precisa distinguir os dois.
 */
function coverageNote(coverage: { sincronizadoAte?: string | null; historicoDesde?: string | null }, inicioDoPeriodo?: Date) {
  const hora = (iso: string) =>
    new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  // Buraco no COMEÇO: o histórico importado não alcança o início do período.
  if (coverage.historicoDesde && inicioDoPeriodo && new Date(coverage.historicoDesde) > inicioDoPeriodo) {
    return `Histórico importado a partir de ${hora(coverage.historicoDesde)} — o período pedido começa antes disso`;
  }
  // Buraco no FIM: o caso comum. É atraso de sincronização, não pedido faltando.
  if (coverage.sincronizadoAte) {
    return `Sincronizado até ${hora(coverage.sincronizadoAte)} — vendas depois disso ainda não entraram`;
  }
  return "Sincronização ainda não rodou neste canal";
}

/** Soma as séries diárias dos canais numa linha só — a visão que só a central pode dar. */
export function mergeDailySeries(series: Array<DailyPoint[] | undefined>): DailyPoint[] {
  const byDate = new Map<string, DailyPoint>();
  for (const points of series) {
    for (const point of points ?? []) {
      const current = byDate.get(point.date) ?? { date: point.date, revenue: 0, orders: 0, units: 0 };
      current.revenue += point.revenue;
      current.orders += point.orders;
      current.units += point.units;
      byDate.set(point.date, current);
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// Teto de espera por rota. Sem ele, uma rota que pendura trava a tela inteira.
const TIMEOUT_MS = 20_000;

export async function json<T>(url: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new Error(`A consulta demorou mais de ${TIMEOUT_MS / 1000}s e foi interrompida.`);
    }
    throw error;
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Não foi possível consultar o canal.");
  return data as T;
}

/**
 * Consolida os quatro canais: faturamento, lucro, pedidos, série e cobertura de
 * cada um. Cada canal falha isolado — um erro não derruba os outros nem a central.
 */
export async function gatherCentralChannels(
  /**
   * Chamado a cada canal que termina, para a tela pintar em vez de esperar o
   * conjunto. Sem ele o comportamento é o de antes: uma resposta só, no fim.
   */
  aoAvancar?: (parcial: { channels: ChannelSnapshot[]; series: DailyPoint[] }) => void
): Promise<{ channels: ChannelSnapshot[]; series: DailyPoint[] }> {
  const integrationData = await json<{ providers: Provider[] }>("/api/integrations");
  const amazonProvider = integrationData.providers.find((provider) => provider.id === "amazon");
  const mercadoLivreProvider = integrationData.providers.find((provider) => provider.id === "mercado_livre");
  const shopeeProvider = integrationData.providers.find((provider) => provider.id === "shopee");
  const tiktokProvider = integrationData.providers.find((provider) => provider.id === "tiktok_shop");
  const shopeeReadState = centralProviderReadState(shopeeProvider);
  const tiktokReadState = centralProviderReadState(tiktokProvider);

  const amazon: ChannelSnapshot = { id: "amazon", name: "Amazon", href: "/amazon", connected: !!amazonProvider?.connections.length, revenue: null, profit: null, orders: null, currency: "BRL", note: "Faturamento, pedidos e lucro estimado" };
  const mercadoLivre: ChannelSnapshot = { id: "mercado_livre", name: "Mercado Livre", href: "/mercado-livre", connected: !!mercadoLivreProvider?.connections.length, revenue: null, profit: null, orders: null, currency: "BRL", note: "Faturamento, pedidos e lucro estimado" };
  const shopeeConnectionIds = shopeeReadState.attention ? [] : connectedShopeeConnectionIds(shopeeProvider?.connections ?? []);
  const shopee: ChannelSnapshot = { id: "shopee", name: "Shopee", href: "/shopee", connected: shopeeReadState.connected, attention: shopeeReadState.attention, revenue: null, profit: null, orders: null, currency: "BRL", note: "Faturamento, pedidos e lucro estimado", error: shopeeReadState.message ?? undefined };
  const tiktok: ChannelSnapshot = { id: "tiktok_shop", name: "TikTok Shop", href: "/tiktok", connected: tiktokReadState.connected, attention: tiktokReadState.attention, revenue: null, profit: null, orders: null, currency: "BRL", note: "Faturamento, pedidos e lucro estimado", error: tiktokReadState.message ?? undefined };

  const tasks: Promise<void>[] = [];
  const channelSeries: Array<DailyPoint[] | undefined> = [];

  const emitir = () =>
    aoAvancar?.({ channels: [amazon, mercadoLivre, shopee, tiktok], series: mergeDailySeries(channelSeries) });

  // Emite ANTES de qualquer rede: os quatro cards já aparecem com nome e estado
  // de conexão, e cada número entra no lugar dele conforme chega. A tela deixa
  // de ser um esqueleto cego.
  emitir();

  // ⚠️ SALES E PROFIT SÃO TAREFAS SEPARADAS, de propósito.
  //
  // Antes as duas eram esperadas juntas num `Promise.allSettled`, e a central
  // só pintava a Amazon quando a mais lenta voltasse. A mais lenta é sempre a
  // do lucro: `/api/profit` pagina `/finances/2024-06-19/transactions` AO VIVO,
  // em série, 30 dias — e o faturamento, que vem do canônico e é instantâneo,
  // ficava refém dela. Resultado medido em 24/08/2026: 8 a 10 segundos de tela
  // em esqueleto na PRIMEIRA tela que o vendedor abre.
  //
  // Separadas, o faturamento e os pedidos aparecem de imediato e o lucro entra
  // quando chega.
  const notaDaAmazon = () => {
    amazon.note = amazon.revenueFromCanonical
      ? "Faturamento pelos pedidos importados; sem conta Amazon ativa para o número oficial"
      : amazon.lucroIndisponivel
      ? "Faturamento e pedidos disponíveis; lucro exige uma conta Amazon conectada"
      : amazon.unitsWithoutCost
      ? `${amazon.unitsWithoutCost} unidade(s) sem custo cadastrado`
      : "Faturamento, pedidos e lucro estimado";
  };

  if (amazon.connected) {
    tasks.push(json<AmazonSales & { source?: string }>("/api/sales?days=30").then((sales) => {
      channelSeries.push(sales.series.points);
      amazon.series = sales.series.points;
      amazon.revenue = sales.series.totalRevenue;
      amazon.orders = sales.series.totalOrders;
      amazon.currency = sales.series.currency || amazon.currency;
      amazon.revenueFromCanonical = sales.source === "canonical";
      notaDaAmazon();
    }).catch((error) => {
      amazon.error = error instanceof Error ? error.message : "Dados indisponíveis";
    }));

    tasks.push(json<{ summary: AmazonProfit }>("/api/profit?days=30").then(({ summary }) => {
      amazon.profit = summary.estimatedProfit;
      amazon.profitPartial = summary.unitsWithoutCost > 0;
      amazon.unitsWithoutCost = summary.unitsWithoutCost;
      amazon.currency = amazon.currency || summary.finance.currency;
      notaDaAmazon();
    }).catch(() => {
      amazon.lucroIndisponivel = true;
      notaDaAmazon();
    }));
  }

  if (mercadoLivre.connected) tasks.push(json<{ overview: MercadoLivreOverview }>("/api/integrations/mercado-livre/overview?view=monitor").then(({ overview }) => {
    channelSeries.push(overview.dailySales);
    mercadoLivre.series = overview.dailySales;
    mercadoLivre.revenue = overview.metrics.revenue30d;
    mercadoLivre.cancelled = overview.metrics.cancelledRevenue;
    mercadoLivre.profit = overview.profit.estimatedProfit;
    mercadoLivre.profitPartial = !overview.profit.coverage.complete || overview.profit.unitsWithoutCost > 0;
    mercadoLivre.unitsWithoutCost = overview.profit.unitsWithoutCost;
    mercadoLivre.orders = overview.metrics.orders30d;
    mercadoLivre.currency = overview.metrics.currency;
    mercadoLivre.note = overview.metrics.revenueCoverage.complete
      ? !overview.profit.coverage.complete
        ? `Faturamento completo; lucro processado em ${overview.profit.coverage.processedOrders} de ${overview.profit.coverage.paidOrders} vendas`
        : overview.profit.unitsWithoutCost > 0
        ? `${overview.profit.unitsWithoutCost} unidade(s) sem custo cadastrado`
        : "Faturamento, pedidos e lucro estimado"
      // 30 dias é a janela que a central pede em todos os canais.
      : coverageNote(overview.metrics.revenueCoverage, new Date(Date.now() - 30 * 86_400_000));
  }).catch((error) => { mercadoLivre.error = error instanceof Error ? error.message : "Dados indisponíveis"; }));

  if (shopee.connected) tasks.push((async () => {
    const results = await Promise.allSettled(shopeeConnectionIds.map((connectionId) =>
      json<CentralShopeeResponse>(`/api/integrations/shopee/overview?days=30&connection_id=${encodeURIComponent(connectionId)}`)
    ));
    const aggregate = aggregateShopeeStores(shopeeConnectionIds.map((connectionId, index) => ({ connectionId, result: results[index] })));
    shopee.revenue = aggregate.revenue;
    shopee.cancelled = aggregate.cancelled ?? undefined;
    shopee.profit = aggregate.profit;
    shopee.profitPartial = aggregate.profitPartial;
    shopee.orders = aggregate.orders;
    shopee.currency = aggregate.currency;
    shopee.note = aggregate.note;
    shopee.error = aggregate.error;
    if (aggregate.dailySales.length) { channelSeries.push(aggregate.dailySales); shopee.series = aggregate.dailySales; }
  })());

  if (tiktok.connected) tasks.push((async () => {
    const results = await Promise.allSettled((tiktokProvider?.connections ?? []).map((connection) =>
      json<TiktokOverviewResponse>(`/api/integrations/tiktok/overview?days=30&connection_id=${encodeURIComponent(connection.id)}`)
    ));
    const available = results.flatMap((result) => result.status === "fulfilled" && result.value.overview ? [result.value] : []);
    const failed = results.length - available.length;
    if (!available.length) {
      const reason = results.find((result) => result.status === "rejected");
      tiktok.error = reason?.status === "rejected" && reason.reason instanceof Error ? reason.reason.message : "Dados indisponíveis";
      return;
    }
    const revenues = available.map((item) => item.overview!.revenue).filter((value): value is number => value != null);
    const profits = available.map((item) => item.overview!.profit).filter((value): value is number => value != null);
    tiktok.revenue = revenues.length ? revenues.reduce((total, value) => total + value, 0) : null;
    tiktok.profit = profits.length ? profits.reduce((total, value) => total + value, 0) : null;
    tiktok.profitPartial = profits.length < available.length;
    tiktok.orders = available.every((item) => item.orders != null) ? available.reduce((total, item) => total + item.orders!, 0) : null;
    tiktok.currency = available[0].overview!.currency || "BRL";
    const tiktokSeries = available.map((item) => item.dailySeries);
    channelSeries.push(...tiktokSeries);
    tiktok.series = mergeDailySeries(tiktokSeries);
    const partialRevenue = available.some((item) => item.coverage?.requestedPeriod?.revenue?.status !== "complete");
    tiktok.note = failed > 0
      ? `${available.length} de ${results.length} loja(s) com leitura; demais indisponíveis`
      : partialRevenue
        ? "Faturamento capturado; sincronização ainda não cobre todo o período"
        : tiktok.profitPartial
          ? `Lucro calculado em ${profits.length} de ${available.length} loja(s)`
          : "Faturamento, pedidos e lucro estimado";
  })());

  await Promise.all(tasks.map((tarefa) => tarefa.then(emitir)));
  return { channels: [amazon, mercadoLivre, shopee, tiktok], series: mergeDailySeries(channelSeries) };
}
