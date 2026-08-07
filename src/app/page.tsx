"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AnimatedNumber } from "./components/AnimatedNumber";
import { PageHeader, pageIcons } from "./components/PageHeader";
import { DashboardSkeleton } from "./components/LoadingState";
import { MarketplaceIcon } from "./components/MarketplaceIcon";
import { RevenueChart, type DailyPoint } from "./components/RevenueChart";
import { brTime } from "@/lib/datetime";

interface ProviderConnection { id: string; }
interface Provider { id: string; name: string; configured: boolean; connections: ProviderConnection[]; }
interface AmazonProfit { estimatedProfit: number; unitsWithoutCost: number; finance: { currency: string; }; }
interface AmazonSales { series: { totalRevenue: number; totalOrders: number; currency: string; points?: DailyPoint[]; }; }
interface MercadoLivreOverview { metrics: { revenue30d: number; orders30d: number; activeListings: number; cancelledRevenue: number; cancelledOrders: number; currency: string; revenueCoverage: { complete: boolean; capturedOrders: number; totalOrders: number; }; }; profit: { estimatedProfit: number; unitsWithoutCost: number; coverage: { processedOrders: number; paidOrders: number; complete: boolean; }; }; dailySales?: DailyPoint[]; }

interface ShopeeOverview { metrics: { revenue30d: number; orders30d: number; cancelledRevenue: number; currency: string; revenueCoverage: { complete: boolean; capturedOrders: number; totalOrders: number; }; }; profit: { estimatedProfit: number; unitsWithoutCost: number; coverage: { processedOrders: number; paidOrders: number; complete: boolean; }; }; dailySales?: DailyPoint[]; }

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
  id: "amazon" | "mercado_livre" | "shopee";
  name: string;
  href: string;
  connected: boolean;
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
}

function money(value: number | null, currency = "BRL") {
  if (value == null) return "Indisponível";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
}

async function json<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Não foi possível consultar o canal.");
  return data as T;
}

// Escopo de módulo: ao navegar para um canal e voltar, a central renderiza o
// consolidado já conhecido no primeiro paint e revalida em segundo plano.
let centralCache: { channels: ChannelSnapshot[]; series: DailyPoint[]; updatedAt: Date } | null = null;

export default function OverviewDashboard() {
  const [channels, setChannels] = useState<ChannelSnapshot[]>(centralCache?.channels ?? []);
  const [series, setSeries] = useState<DailyPoint[]>(centralCache?.series ?? []);
  const [loading, setLoading] = useState(!centralCache);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(centralCache?.updatedAt ?? null);

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      try {
        const integrationData = await json<{ providers: Provider[] }>("/api/integrations");
        const amazonProvider = integrationData.providers.find((provider) => provider.id === "amazon");
        const mercadoLivreProvider = integrationData.providers.find((provider) => provider.id === "mercado_livre");
        const shopeeProvider = integrationData.providers.find((provider) => provider.id === "shopee");

        const amazon: ChannelSnapshot = { id: "amazon", name: "Amazon", href: "/amazon", connected: !!amazonProvider?.connections.length, revenue: null, profit: null, orders: null, currency: "BRL", note: "Faturamento, pedidos e lucro estimado" };
        const mercadoLivre: ChannelSnapshot = { id: "mercado_livre", name: "Mercado Livre", href: "/mercado-livre", connected: !!mercadoLivreProvider?.connections.length, revenue: null, profit: null, orders: null, currency: "BRL", note: "Faturamento, pedidos e lucro estimado" };
        const shopee: ChannelSnapshot = { id: "shopee", name: "Shopee", href: "/shopee", connected: !!shopeeProvider?.connections.length, revenue: null, profit: null, orders: null, currency: "BRL", note: "Faturamento, pedidos e lucro estimado" };

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
          mercadoLivre.revenue = overview.metrics.revenue30d;
          mercadoLivre.cancelled = overview.metrics.cancelledRevenue;
          mercadoLivre.profit = overview.profit.estimatedProfit;
          mercadoLivre.profitPartial = !overview.profit.coverage.complete || overview.profit.unitsWithoutCost > 0;
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
        if (shopee.connected) tasks.push(json<{ overview?: ShopeeOverview; pending?: boolean }>("/api/integrations/shopee/overview?days=30").then((data) => {
          // Conectada mas ainda sem ingestão: mantém os valores em null (nunca
          // zero) para não somar "não vendeu nada" ao consolidado.
          if (data.pending || !data.overview) { shopee.note = "Primeira sincronização pendente"; return; }
          const overview = data.overview;
          channelSeries.push(overview.dailySales);
          shopee.revenue = overview.metrics.revenue30d;
          shopee.cancelled = overview.metrics.cancelledRevenue;
          shopee.profit = overview.profit.estimatedProfit;
          shopee.profitPartial = !overview.profit.coverage.complete || overview.profit.unitsWithoutCost > 0;
          shopee.orders = overview.metrics.orders30d;
          shopee.currency = overview.metrics.currency;
          shopee.note = overview.metrics.revenueCoverage.complete
            ? !overview.profit.coverage.complete
              ? `Faturamento completo; lucro processado em ${overview.profit.coverage.processedOrders} de ${overview.profit.coverage.paidOrders} vendas`
              : overview.profit.unitsWithoutCost > 0
              ? `Lucro parcial: ${overview.profit.unitsWithoutCost} unidade(s) sem custo`
              : "Faturamento, pedidos e lucro estimado"
            : coverageNote(overview.metrics.revenueCoverage);
        }).catch((error) => { shopee.error = error instanceof Error ? error.message : "Dados indisponíveis"; }));
        await Promise.all(tasks);
        const refreshedAt = new Date();
        const merged = mergeDailySeries(channelSeries);
        centralCache = { channels: [amazon, mercadoLivre, shopee], series: merged, updatedAt: refreshedAt };
        setChannels([amazon, mercadoLivre, shopee]);
        setSeries(merged);
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

  return (
    <div className="overview-page space-y-8">
      <PageHeader eyebrow="Central multicanal" title="Visão geral" subtitle="Acompanhe sua operação inteira e entre em cada canal quando precisar dos detalhes próprios da plataforma." icon={pageIcons.dashboard} action={updatedAt && <span className="data-freshness">Atualizado às {brTime(updatedAt)}</span>} />
      {loading ? <DashboardSkeleton label="Consolidando seus canais" chart={false} rows={2} /> : channels.length === 0 ? (
        <section className="central-empty"><span>SC</span><div><p className="section-kicker">Primeira conexão</p><h2>Monte sua central de vendas</h2><p>Conecte Amazon, Mercado Livre ou Shopee para começar a consolidar faturamento e pedidos.</p></div><Link href="/integracoes">Conectar um canal <b aria-hidden="true">→</b></Link></section>
      ) : <div className="dashboard-sections space-y-8">
        <section className="central-kpis" aria-label="Indicadores consolidados">
          <article><p>Faturamento conhecido</p><strong><AnimatedNumber id="central-revenue" value={totals.revenue} format={(amount) => money(amount)} /></strong><small>Soma dos canais com dados disponíveis</small></article>
          <article><p>Lucro conhecido</p><strong>{totals.profitSources ? <AnimatedNumber id="central-profit" value={totals.profit} format={(amount) => money(amount)} /> : "Indisponível"}</strong><small>{totals.profitSources} de {totals.connected} canais com cálculo de lucro</small></article>
          <article><p>Pedidos</p><strong>{totals.orders.toLocaleString("pt-BR")}</strong><small>Últimos 30 dias</small></article>
          <article><p>Canais conectados</p><strong>{totals.connected}</strong><small>de {channels.length} disponíveis nesta fase</small></article>
        </section>

        {series.length > 0 && (
          <section className="central-revenue-panel" aria-labelledby="central-revenue-title">
            <div className="mb-2 flex items-baseline justify-between gap-4">
              <div><p className="section-kicker">Todos os canais</p><h2 id="central-revenue-title" className="mt-1 text-lg font-semibold text-slate-900">Faturamento consolidado por dia</h2></div>
              <span className="text-sm font-semibold tabular-nums text-slate-900">{money(totals.revenue)} <span className="font-normal text-slate-400">nos últimos 30 dias</span></span>
            </div>
            <RevenueChart points={series} />
          </section>
        )}

        <section aria-labelledby="channel-comparison-title">
          <div className="central-section-heading"><div><p className="section-kicker">Comparação por canal</p><h2 id="channel-comparison-title">Onde sua operação acontece</h2></div><p>Valores indisponíveis permanecem explícitos e nunca entram como zero no consolidado.</p></div>
          <div className="channel-overview-grid">
            {channels.map((channel) => (
              <article key={channel.id} className={`channel-overview-card is-${channel.id}`}>
                <header><span className="channel-overview-mark" aria-hidden="true"><MarketplaceIcon provider={channel.id} size={40} app /></span><div><h3>{channel.name}</h3><p>{!channel.connected ? "Aguardando conexão" : channel.error ? "Conectado, sem leitura" : "Canal conectado"}</p></div><span className={`channel-health${channel.connected && !channel.error ? " is-connected" : ""}`}>{!channel.connected ? "Conectar" : channel.error ? "Atenção" : "Ativo"}</span></header>
                {channel.connected ? <>
                  <div className="channel-value"><span>Vendas brutas</span><strong>{channel.error ? "Indisponível" : money(channel.revenue, channel.currency)}</strong></div>
                  <div className="channel-share" aria-label={`Participação relativa de ${channel.name}`}><i style={{ width: `${((channel.revenue ?? 0) / maxRevenue) * 100}%` }} /></div>
                  <dl><div><dt>Pedidos</dt><dd>{channel.orders?.toLocaleString("pt-BR") ?? "—"}</dd></div><div><dt>{channel.profitPartial ? "Lucro parcial" : "Lucro"}</dt><dd>{money(channel.profit, channel.currency)}</dd></div>{channel.cancelled != null && channel.cancelled > 0 ? <div><dt>Canceladas</dt><dd className="text-red-600">{money(channel.cancelled, channel.currency)}</dd></div> : null}</dl>
                  <p className="channel-note">{channel.error || channel.note}</p>
                </> : <div className="channel-card-empty"><p>Conecte sua conta para incluir este canal no dashboard geral.</p></div>}
                <Link href={channel.connected ? channel.href : "/integracoes"}>{channel.connected ? `Abrir ${channel.name}` : `Conectar ${channel.name}`} <span aria-hidden="true">→</span></Link>
              </article>
            ))}
          </div>
        </section>
      </div>}
    </div>
  );
}
