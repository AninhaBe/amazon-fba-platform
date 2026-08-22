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
interface MercadoLivreOverview { metrics: { revenue30d: number; orders30d: number; activeListings: number; cancelledRevenue: number; cancelledOrders: number; currency: string; revenueCoverage: { complete: boolean; capturedOrders: number; totalOrders: number } }; profit: { estimatedProfit: number; unitsWithoutCost: number; coverage: { processedOrders: number; paidOrders: number; complete: boolean } }; dailySales?: DailyPoint[] }
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

// Cobertura incompleta tem duas causas diferentes e a mensagem precisa dizer qual.
function coverageNote(coverage: { capturedOrders: number; totalOrders: number }) {
  return coverage.capturedOrders < coverage.totalOrders
    ? `Faturamento parcial: ${coverage.capturedOrders} de ${coverage.totalOrders} pedidos`
    : `Sincronização ainda não cobre todo o período; ${coverage.capturedOrders} pedido(s) capturados`;
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
export async function gatherCentralChannels(): Promise<{ channels: ChannelSnapshot[]; series: DailyPoint[] }> {
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

  if (amazon.connected) tasks.push((async () => {
    const [profitResult, salesResult] = await Promise.allSettled([
      json<{ summary: AmazonProfit }>("/api/profit?days=30"),
      json<AmazonSales & { source?: string }>("/api/sales?days=30"),
    ]);
    if (salesResult.status === "fulfilled") {
      const sales = salesResult.value;
      channelSeries.push(sales.series.points);
      amazon.series = sales.series.points;
      amazon.revenue = sales.series.totalRevenue;
      amazon.orders = sales.series.totalOrders;
      amazon.currency = sales.series.currency || amazon.currency;
      amazon.revenueFromCanonical = sales.source === "canonical";
    } else {
      amazon.error = salesResult.reason instanceof Error ? salesResult.reason.message : "Dados indisponíveis";
    }
    if (profitResult.status === "fulfilled") {
      const summary = profitResult.value.summary;
      amazon.profit = summary.estimatedProfit;
      amazon.profitPartial = summary.unitsWithoutCost > 0;
      amazon.unitsWithoutCost = summary.unitsWithoutCost;
      amazon.currency = amazon.currency || summary.finance.currency;
    }
    amazon.note = amazon.revenueFromCanonical
      ? "Faturamento pelos pedidos importados; sem conta Amazon ativa para o número oficial"
      : profitResult.status === "rejected"
      ? "Faturamento e pedidos disponíveis; lucro exige uma conta Amazon conectada"
      : amazon.profitPartial
      ? `Lucro parcial: ${profitResult.status === "fulfilled" ? profitResult.value.summary.unitsWithoutCost : 0} unidade(s) sem custo cadastrado`
      : "Faturamento, pedidos e lucro estimado";
  })());

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
        ? `Lucro parcial: ${overview.profit.unitsWithoutCost} unidade(s) sem custo`
        : "Faturamento, pedidos e lucro estimado"
      : coverageNote(overview.metrics.revenueCoverage);
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
          ? "Faturamento e pedidos disponíveis; lucro ainda incompleto"
          : "Faturamento, pedidos e lucro estimado";
  })());

  await Promise.all(tasks);
  return { channels: [amazon, mercadoLivre, shopee, tiktok], series: mergeDailySeries(channelSeries) };
}
