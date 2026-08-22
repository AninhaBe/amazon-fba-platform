"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AnimatedNumber } from "./components/AnimatedNumber";
import { PageHeader, pageIcons } from "./components/PageHeader";
import { DashboardSkeleton } from "./components/LoadingState";
import { MarketplaceIcon } from "./components/MarketplaceIcon";
import { RevenueChart, type DailyPoint } from "./components/RevenueChart";
import { brTime } from "@/lib/datetime";
import { tendenciaSemanal, detectarAlerta, margemDoCanal, percent } from "@/lib/centralOverview";
import {
  aggregateShopeeStores,
  centralProviderReadState,
  connectedShopeeConnectionIds,
  type CentralShopeeResponse,
} from "./OverviewShopeeModel";

interface ProviderConnection { id: string; status: string; }
interface Provider {
  id: string;
  name: string;
  configured: boolean;
  connections: ProviderConnection[];
  issue?: { status: "attention"; code: "OWNERSHIP_CONFLICT" | "PROVIDER_READ_FAILED"; message: string };
}
interface AmazonProfit { estimatedProfit: number; unitsWithoutCost: number; finance: { currency: string; }; }
interface AmazonSales { series: { totalRevenue: number; totalOrders: number; currency: string; points?: DailyPoint[]; }; }
interface MercadoLivreOverview { metrics: { revenue30d: number; orders30d: number; activeListings: number; cancelledRevenue: number; cancelledOrders: number; currency: string; revenueCoverage: { complete: boolean; capturedOrders: number; totalOrders: number; }; }; profit: { estimatedProfit: number; unitsWithoutCost: number; coverage: { processedOrders: number; paidOrders: number; complete: boolean; }; }; dailySales?: DailyPoint[]; }

interface TiktokOverviewResponse {
  overview: { revenue: number | null; profit: number | null; currency: string } | null;
  orders?: number;
  dailySeries?: DailyPoint[];
  coverage?: { requestedPeriod?: { revenue?: { status: "complete" | "partial" | "pending" } } } | null;
}

interface SaldoAmazonResponse { currency: string; disponivel: number | null; retido: number; }
interface SaldoMLResponse { currency: string; retido: number; liberadoNaJanela: number; }

// A central responde "quanto a operação inteira faturou" — venda a venda é
// assunto de cada canal, onde existe busca, filtro e paginação.

// Cobertura incompleta tem duas causas diferentes e a mensagem precisa dizer
// qual é. Nos leitores canônicos capturados e total são a mesma contagem, então
// "parcial: N de N" seria uma contradição na tela: o que falta ali é a janela de
// sincronização alcançar o período pedido, não pedido nenhum.
function coverageNote(coverage: { capturedOrders: number; totalOrders: number }) {
  return coverage.capturedOrders < coverage.totalOrders
    ? `Faturamento parcial: ${coverage.capturedOrders} de ${coverage.totalOrders} pedidos`
    : `Sincronização ainda não cobre todo o período; ${coverage.capturedOrders} pedido(s) capturados`;
}

// Soma as séries diárias dos canais numa linha só — a visão que só a central
// pode dar. Datas presentes em um canal e ausentes no outro entram como estão.
function mergeDailySeries(series: Array<DailyPoint[] | undefined>): DailyPoint[] {
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
interface ChannelSnapshot {
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

/** Repasse consolidado: o que já caiu e o que ainda está retido, por canal. */
interface SettlementSnapshot {
  id: ChannelSnapshot["id"];
  name: string;
  /** Já liberado. `null` = o canal não informou (≠ zero). */
  liberado: number | null;
  /** Ainda retido, a receber. `null` = não informado. */
  aReceber: number | null;
  currency: string;
}

function money(value: number | null, currency = "BRL") {
  if (value == null) return "Indisponível";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
}

// Teto de espera por rota. Sem ele, uma rota que pendura trava a tela inteira:
// o `await` nunca retorna, o `finally` que desliga o carregamento nunca roda, e
// a central fica em esqueleto para sempre — foi o que aconteceu em 19/08/2026
// numa conta com 21.573 pedidos. Estourar o teto vira erro legível, que é o que
// o AGENTS.md exige ("tela sem dado mostra o estado real").
const TIMEOUT_MS = 20_000;

async function json<T>(url: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    // TimeoutError e AbortError chegam aqui; distinguir ajuda a diagnosticar.
    if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new Error(`A consulta demorou mais de ${TIMEOUT_MS / 1000}s e foi interrompida.`);
    }
    throw error;
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Não foi possível consultar o canal.");
  return data as T;
}

// Escopo de módulo: ao navegar para um canal e voltar, a central renderiza o
// consolidado já conhecido no primeiro paint e revalida em segundo plano.
let centralCache: { channels: ChannelSnapshot[]; series: DailyPoint[]; settlement: SettlementSnapshot[]; updatedAt: Date } | null = null;

/**
 * Repasse consolidado a partir dos saldos de cada canal. Amazon e Mercado Livre
 * expõem retido e liberado; Shopee e TikTok ainda não, e entram como `null`
 * (não informado) — nunca como zero, que diria "não há nada a receber".
 */
async function carregarRepasse(temAmazon: boolean, temMl: boolean): Promise<SettlementSnapshot[]> {
  const [amazon, ml] = await Promise.allSettled([
    temAmazon ? json<SaldoAmazonResponse>("/api/amazon/balance") : Promise.reject(new Error("sem amazon")),
    temMl ? json<SaldoMLResponse>("/api/integrations/mercado-livre/balance") : Promise.reject(new Error("sem ml")),
  ]);
  const linhas: SettlementSnapshot[] = [];
  if (amazon.status === "fulfilled") {
    linhas.push({ id: "amazon", name: "Amazon", liberado: amazon.value.disponivel, aReceber: amazon.value.retido, currency: amazon.value.currency || "BRL" });
  }
  if (ml.status === "fulfilled") {
    linhas.push({ id: "mercado_livre", name: "Mercado Livre", liberado: ml.value.liberadoNaJanela, aReceber: ml.value.retido, currency: ml.value.currency || "BRL" });
  }
  return linhas;
}

export default function OverviewDashboard() {
  const [channels, setChannels] = useState<ChannelSnapshot[]>(centralCache?.channels ?? []);
  const [series, setSeries] = useState<DailyPoint[]>(centralCache?.series ?? []);
  const [settlement, setSettlement] = useState<SettlementSnapshot[]>(centralCache?.settlement ?? []);
  const [chartChannel, setChartChannel] = useState<"todos" | ChannelSnapshot["id"]>("todos");
  const [loading, setLoading] = useState(!centralCache);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(centralCache?.updatedAt ?? null);

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      try {
        const integrationData = await json<{ providers: Provider[] }>("/api/integrations");
        const amazonProvider = integrationData.providers.find((provider) => provider.id === "amazon");
        const mercadoLivreProvider = integrationData.providers.find((provider) => provider.id === "mercado_livre");
        const shopeeProvider = integrationData.providers.find((provider) => provider.id === "shopee");
        const tiktokProvider = integrationData.providers.find((provider) => provider.id === "tiktok_shop");
        const shopeeReadState = centralProviderReadState(shopeeProvider);
        const tiktokReadState = centralProviderReadState(tiktokProvider);

        const amazon: ChannelSnapshot = { id: "amazon", name: "Amazon", href: "/amazon", connected: !!amazonProvider?.connections.length, revenue: null, profit: null, orders: null, currency: "BRL", note: "Faturamento, pedidos e lucro estimado" };
        const mercadoLivre: ChannelSnapshot = { id: "mercado_livre", name: "Mercado Livre", href: "/mercado-livre", connected: !!mercadoLivreProvider?.connections.length, revenue: null, profit: null, orders: null, currency: "BRL", note: "Faturamento, pedidos e lucro estimado" };
        const shopeeConnectionIds = shopeeReadState.attention
          ? []
          : connectedShopeeConnectionIds(shopeeProvider?.connections ?? []);
        const shopee: ChannelSnapshot = { id: "shopee", name: "Shopee", href: "/shopee", connected: shopeeReadState.connected, attention: shopeeReadState.attention, revenue: null, profit: null, orders: null, currency: "BRL", note: "Faturamento, pedidos e lucro estimado", error: shopeeReadState.message ?? undefined };
        const tiktok: ChannelSnapshot = { id: "tiktok_shop", name: "TikTok Shop", href: "/tiktok", connected: tiktokReadState.connected, attention: tiktokReadState.attention, revenue: null, profit: null, orders: null, currency: "BRL", note: "Faturamento, pedidos e lucro estimado", error: tiktokReadState.message ?? undefined };

        const tasks: Promise<void>[] = [];
        const channelSeries: Array<DailyPoint[] | undefined> = [];
        // Faturamento e lucro da Amazon vêm de rotas diferentes e falham por
        // motivos diferentes: o lucro depende da Transactions API, que exige
        // conta SP-API viva, enquanto o faturamento tem fallback canônico. Uma
        // falha do lucro não pode mais zerar o card inteiro — antes o
        // Promise.all rejeitava e o canal aparecia "Ativo" e "Indisponível" ao
        // mesmo tempo.
        if (amazon.connected) tasks.push((async () => {
          const [profitResult, salesResult] = await Promise.allSettled([
            json<{ summary: AmazonProfit }>("/api/profit?days=30"),
            json<AmazonSales & { source?: string }>("/api/sales?days=30"),
          ]);

          if (salesResult.status === "fulfilled") {
            const sales = salesResult.value;
            channelSeries.push(sales.series.points);
            amazon.series = sales.series.points;
            amazon.revenue = sales.series.totalRevenue; // data do pedido = Seller Central
            amazon.orders = sales.series.totalOrders;
            amazon.currency = sales.series.currency || amazon.currency;
            amazon.revenueFromCanonical = sales.source === "canonical";
          } else {
            amazon.error = salesResult.reason instanceof Error ? salesResult.reason.message : "Dados indisponíveis";
          }

          if (profitResult.status === "fulfilled") {
            const summary = profitResult.value.summary;
            // Reflete os custos já cadastrados (não some enquanto faltam alguns).
            amazon.profit = summary.estimatedProfit;
            amazon.profitPartial = summary.unitsWithoutCost > 0;
            amazon.unitsWithoutCost = summary.unitsWithoutCost;
            amazon.currency = amazon.currency || summary.finance.currency;
          }

          amazon.note = amazon.revenueFromCanonical
            // Regra registrada em docs/api-amazon-sp-api.md: só o orderMetrics
            // bate ao centavo com o Seller Central. Se o número veio de outro
            // lugar, a tela precisa dizer.
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
          const aggregate = aggregateShopeeStores(shopeeConnectionIds.map((connectionId, index) => ({
            connectionId,
            result: results[index],
          })));
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
          tiktok.orders = available.every((item) => item.orders != null)
            ? available.reduce((total, item) => total + item.orders!, 0)
            : null;
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
        // O repasse depende de saber quem está conectado, então roda ao lado das
        // tarefas de faturamento, não antes. Falha aqui não derruba a central: o
        // card de repasse some, o resto fica.
        const repasse = await carregarRepasse(amazon.connected, mercadoLivre.connected).catch(() => [] as SettlementSnapshot[]);
        await Promise.all(tasks);
        const refreshedAt = new Date();
        const merged = mergeDailySeries(channelSeries);
        centralCache = { channels: [amazon, mercadoLivre, shopee, tiktok], series: merged, settlement: repasse, updatedAt: refreshedAt };
        setChannels([amazon, mercadoLivre, shopee, tiktok]);
        setSeries(merged);
        setSettlement(repasse);
        setUpdatedAt(refreshedAt);
      } catch {
        // Uma falha de revalidação não apaga o consolidado já exibido.
        if (!centralCache) setChannels([]);
      } finally {
        setLoading(false);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const totals = useMemo(() => channels.reduce((summary, channel) => {
    if (channel.revenue != null) summary.revenue += channel.revenue;
    if (channel.profit != null) { summary.profit += channel.profit; summary.profitSources += 1; }
    if (channel.orders != null) summary.orders += channel.orders;
    if (channel.connected) summary.connected += 1;
    return summary;
  }, { revenue: 0, profit: 0, profitSources: 0, orders: 0, connected: 0 }), [channels]);
  const maxRevenue = Math.max(...channels.map((channel) => channel.revenue ?? 0), 1);

  // Feature 1: variação do consolidado na semana, da própria série já carregada.
  const tendenciaTotal = useMemo(() => tendenciaSemanal(series), [series]);
  // Feature 2: a única frase de alerta, priorizada.
  const alerta = useMemo(() => detectarAlerta(channels), [channels]);
  // Feature 3: margem consolidada, só sobre canais com lucro E faturamento conhecidos.
  const margemTotal = useMemo(() => {
    let revenue = 0;
    let profit = 0;
    let algum = false;
    for (const channel of channels) {
      if (channel.profit != null && channel.revenue != null && channel.revenue > 0) {
        revenue += channel.revenue;
        profit += channel.profit;
        algum = true;
      }
    }
    return algum && revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : null;
  }, [channels]);
  // Feature 4: qual série o gráfico mostra — todos (soma) ou um canal.
  const serieExibida = useMemo(() => {
    if (chartChannel === "todos") return series;
    return channels.find((channel) => channel.id === chartChannel)?.series ?? [];
  }, [chartChannel, channels, series]);
  const canaisComSerie = useMemo(() => channels.filter((channel) => channel.series?.length), [channels]);
  // Feature 5: totais de repasse, tratando null como "não informado", nunca zero.
  const repasseTotais = useMemo(() => {
    let liberado = 0;
    let aReceber = 0;
    let temLiberado = false;
    let temAReceber = false;
    for (const linha of settlement) {
      if (linha.liberado != null) { liberado += linha.liberado; temLiberado = true; }
      if (linha.aReceber != null) { aReceber += linha.aReceber; temAReceber = true; }
    }
    return { liberado: temLiberado ? liberado : null, aReceber: temAReceber ? aReceber : null };
  }, [settlement]);

  return (
    <div className="overview-page channel-dashboard">
      <PageHeader eyebrow="Central multicanal" title="Visão geral" subtitle="Acompanhe sua operação inteira e entre em cada canal quando precisar dos detalhes próprios da plataforma." icon={pageIcons.dashboard} action={updatedAt && <span className="data-freshness">Atualizado às {brTime(updatedAt)}</span>} />
      {loading ? <DashboardSkeleton label="Consolidando seus canais" chart={false} rows={2} /> : channels.length === 0 ? (
        <section className="central-empty"><span>SC</span><div><p className="section-kicker">Primeira conexão</p><h2>Monte sua central de vendas</h2><p>Conecte Amazon, Mercado Livre, Shopee ou TikTok Shop para começar a consolidar faturamento e pedidos.</p></div><Link href="/integracoes">Conectar um canal <b aria-hidden="true">→</b></Link></section>
      ) : <div className="dashboard-sections channel-dashboard-sections">
        {alerta && (
          <Link href={alerta.href ?? "#"} className={`central-alerta is-${alerta.tom}`} aria-label={alerta.texto}>
            <span aria-hidden="true" className="central-alerta-ponto" />
            <span className="central-alerta-texto">{alerta.texto}</span>
            {alerta.href && <span aria-hidden="true" className="central-alerta-seta">→</span>}
          </Link>
        )}
        <section className="central-kpis" aria-label="Indicadores consolidados">
          <article>
            <p>Faturamento conhecido</p>
            <strong><AnimatedNumber id="central-revenue" value={totals.revenue} format={(amount) => money(amount)} /></strong>
            {/* Feature 1: a variação transforma o total num sinal, não só num número. */}
            {tendenciaTotal.deltaPct != null ? (
              <small className={tendenciaTotal.deltaPct >= 0 ? "is-positive" : "is-negative"}>
                {tendenciaTotal.deltaPct >= 0 ? "▲" : "▼"} {percent(tendenciaTotal.deltaPct)} vs. semana anterior
              </small>
            ) : <small>Soma dos canais com dados disponíveis</small>}
          </article>
          <article><p>Lucro conhecido</p><strong>{totals.profitSources ? <AnimatedNumber id="central-profit" value={totals.profit} format={(amount) => money(amount)} /> : "Indisponível"}</strong><small>{totals.profitSources} de {totals.connected} canais com cálculo de lucro</small></article>
          {/* Feature 3: margem consolidada — a pergunta "vendi mais e ganhei menos?". */}
          <article><p>Margem consolidada</p><strong>{margemTotal == null ? "Indisponível" : percent(margemTotal)}</strong><small>{margemTotal == null ? "aguardando lucro dos canais" : "lucro sobre faturamento conhecido"}</small></article>
          <article><p>Pedidos</p><strong>{totals.orders.toLocaleString("pt-BR")}</strong><small>Últimos 30 dias</small></article>
          <article><p>Canais conectados</p><strong>{totals.connected}</strong><small>de {channels.length} disponíveis nesta fase</small></article>
        </section>

        {/* Feature 5: repasse consolidado — o que já caiu e o que ainda está retido. */}
        {(repasseTotais.liberado != null || repasseTotais.aReceber != null) && (
          <section className="central-repasse" aria-label="Repasse consolidado">
            <div className="central-repasse-par">
              <article><p>Já liberado</p><strong>{money(repasseTotais.liberado)}</strong><small>disponível para saque</small></article>
              <article><p>A receber</p><strong>{money(repasseTotais.aReceber)}</strong><small>retido, com data de liberação por canal</small></article>
            </div>
            <p className="central-repasse-nota">
              {settlement.map((s) => s.name).join(" e ")} informam repasse.
              {settlement.length < totals.connected ? " Shopee e TikTok ainda não expõem saldo — não entram como zero." : ""}
            </p>
          </section>
        )}

        {series.length > 0 && (
          <section className="central-revenue-panel" aria-labelledby="central-revenue-title">
            <div className="mb-2 flex items-baseline justify-between gap-4">
              <div><p className="section-kicker">{chartChannel === "todos" ? "Todos os canais" : canaisComSerie.find((c) => c.id === chartChannel)?.name}</p><h2 id="central-revenue-title" className="mt-1 text-lg font-semibold text-[var(--ink)]">Faturamento {chartChannel === "todos" ? "consolidado" : "do canal"} por dia</h2></div>
              <span className="text-sm font-semibold tabular-nums text-[var(--ink)]">{money(serieExibida.reduce((soma, p) => soma + p.revenue, 0))} <span className="font-normal text-[var(--ink-muted)]">nos últimos 30 dias</span></span>
            </div>
            {/* Feature 4: abrir a linha consolidada por canal — ver ONDE aconteceu. */}
            {canaisComSerie.length > 1 && (
              <div className="central-chart-tabs" role="tablist" aria-label="Ver faturamento por canal">
                <button type="button" role="tab" aria-selected={chartChannel === "todos"} className={chartChannel === "todos" ? "is-active" : ""} onClick={() => setChartChannel("todos")}>Todos</button>
                {canaisComSerie.map((channel) => (
                  <button key={channel.id} type="button" role="tab" aria-selected={chartChannel === channel.id} className={chartChannel === channel.id ? "is-active" : ""} onClick={() => setChartChannel(channel.id)}>{channel.name}</button>
                ))}
              </div>
            )}
            <RevenueChart key={chartChannel} points={serieExibida} explorable />
          </section>
        )}

        <section aria-labelledby="channel-comparison-title">
          <div className="central-section-heading"><div><p className="section-kicker">Comparação por canal</p><h2 id="channel-comparison-title">Onde sua operação acontece</h2></div><p>Valores indisponíveis permanecem explícitos e nunca entram como zero no consolidado.</p></div>
          <div className="channel-comparison-table" role="table" aria-label="Comparação de canais">
            <div className="channel-comparison-head" role="row"><span role="columnheader">Canal</span><span role="columnheader">Faturamento conhecido</span><span role="columnheader">Pedidos</span><span role="columnheader">Resultado</span><span role="columnheader">Margem</span><span role="columnheader"><span className="sr-only">Ação</span></span></div>
            {channels.map((channel) => (
              <div key={channel.id} className={`channel-comparison-row is-${channel.id}`} role="row">
                <div className="channel-comparison-identity" role="cell"><span aria-hidden="true"><MarketplaceIcon provider={channel.id} size={28} app /></span><div><strong>{channel.name}</strong><small>{channel.attention ? "Canal temporariamente indisponível" : !channel.connected ? "Aguardando conexão" : channel.error ? "Conectado, sem leitura" : channel.error || channel.note}</small></div><em className={`channel-health${channel.connected && !channel.error ? " is-connected" : ""}`}>{channel.attention ? "Atenção" : !channel.connected ? "Conectar" : channel.error ? "Atenção" : "Ativo"}</em></div>
                <div className="channel-comparison-revenue" role="cell"><strong>{channel.connected && !channel.error ? money(channel.revenue, channel.currency) : "—"}</strong><span aria-label={`Participação relativa de ${channel.name}`}><i style={{ width: `${channel.connected ? ((channel.revenue ?? 0) / maxRevenue) * 100 : 0}%` }} /></span></div>
                <div className="channel-comparison-number" role="cell"><strong>{channel.orders?.toLocaleString("pt-BR") ?? "—"}</strong><small>últimos 30 dias</small></div>
                <div className="channel-comparison-number" role="cell"><strong className={channel.profit == null ? undefined : channel.profit < 0 ? "is-negative" : "is-positive"}>{channel.connected ? money(channel.profit, channel.currency) : "—"}</strong><small>{channel.profitPartial ? "lucro parcial" : "lucro conhecido"}{channel.cancelled != null && channel.cancelled > 0 ? ` · ${money(channel.cancelled, channel.currency)} canceladas` : ""}</small></div>
                {/* Feature 3: margem por canal — quem fatura mais nem sempre é quem lucra mais. */}
                <div className="channel-comparison-number" role="cell">{(() => { const m = margemDoCanal(channel); return <><strong className={m == null ? undefined : m < 0 ? "is-negative" : "is-positive"}>{channel.connected && m != null ? percent(m) : "—"}</strong><small>{channel.profitPartial ? "parcial" : "sobre faturamento"}</small></>; })()}</div>
                <div className="channel-comparison-action" role="cell"><Link href={channel.connected && !channel.attention ? channel.href : "/integracoes"} aria-label={channel.attention ? `Revisar integração ${channel.name}` : channel.connected ? `Abrir ${channel.name}` : `Conectar ${channel.name}`} title={channel.attention ? "Revisar integração" : channel.connected ? `Abrir ${channel.name}` : `Conectar ${channel.name}`}>→</Link></div>
              </div>
            ))}
          </div>
        </section>
      </div>}
    </div>
  );
}
