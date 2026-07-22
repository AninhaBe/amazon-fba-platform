"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AnimatedNumber } from "./components/AnimatedNumber";
import { PageHeader, pageIcons } from "./components/PageHeader";
import { DashboardSkeleton } from "./components/LoadingState";
import { MarketplaceIcon } from "./components/MarketplaceIcon";

interface ProviderConnection { id: string; }
interface Provider { id: string; name: string; configured: boolean; connections: ProviderConnection[]; }
interface AmazonProfit { estimatedProfit: number; finance: { revenue: number; currency: string; }; }
interface AmazonSales { series: { totalRevenue: number; totalOrders: number; currency: string; }; }
interface MercadoLivreOverview { metrics: { revenue30d: number; orders30d: number; activeListings: number; currency: string; revenueCoverage: { complete: boolean; capturedOrders: number; totalOrders: number; }; }; profit: { estimatedProfit: number; unitsWithoutCost: number; coverage: { processedOrders: number; paidOrders: number; complete: boolean; }; }; }
interface ChannelSnapshot {
  id: "amazon" | "mercado_livre";
  name: string;
  href: string;
  connected: boolean;
  revenue: number | null;
  profit: number | null;
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
let centralCache: { channels: ChannelSnapshot[]; updatedAt: Date } | null = null;

export default function OverviewDashboard() {
  const [channels, setChannels] = useState<ChannelSnapshot[]>(centralCache?.channels ?? []);
  const [loading, setLoading] = useState(!centralCache);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(centralCache?.updatedAt ?? null);

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      try {
        const integrationData = await json<{ providers: Provider[] }>("/api/integrations");
        const amazonProvider = integrationData.providers.find((provider) => provider.id === "amazon");
        const mercadoLivreProvider = integrationData.providers.find((provider) => provider.id === "mercado_livre");

        const amazon: ChannelSnapshot = { id: "amazon", name: "Amazon", href: "/amazon", connected: !!amazonProvider?.connections.length, revenue: null, profit: null, orders: null, currency: "BRL", note: "Faturamento, pedidos e lucro estimado" };
        const mercadoLivre: ChannelSnapshot = { id: "mercado_livre", name: "Mercado Livre", href: "/mercado-livre", connected: !!mercadoLivreProvider?.connections.length, revenue: null, profit: null, orders: null, currency: "BRL", note: "Faturamento, pedidos e lucro estimado" };

        const tasks: Promise<void>[] = [];
        if (amazon.connected) tasks.push(Promise.all([json<{ summary: AmazonProfit }>("/api/profit?days=30"), json<AmazonSales>("/api/sales?days=30")]).then(([profit, sales]) => {
          amazon.revenue = sales.series.totalRevenue;
          amazon.profit = profit.summary.estimatedProfit;
          amazon.orders = sales.series.totalOrders;
          amazon.currency = sales.series.currency || profit.summary.finance.currency;
          amazon.note = "Faturamento completo; lucro conforme eventos já conciliados pela Amazon";
        }).catch((error) => { amazon.error = error instanceof Error ? error.message : "Dados indisponíveis"; }));
        if (mercadoLivre.connected) tasks.push(json<{ overview: MercadoLivreOverview }>("/api/integrations/mercado-livre/overview").then(({ overview }) => {
          mercadoLivre.revenue = overview.metrics.revenue30d;
          mercadoLivre.profit = overview.profit.coverage.complete ? overview.profit.estimatedProfit : null;
          mercadoLivre.orders = overview.metrics.orders30d;
          mercadoLivre.currency = overview.metrics.currency;
          mercadoLivre.note = overview.metrics.revenueCoverage.complete
            ? !overview.profit.coverage.complete
              ? `Faturamento completo; lucro processado em ${overview.profit.coverage.processedOrders} de ${overview.profit.coverage.paidOrders} vendas`
              : overview.profit.unitsWithoutCost > 0
              ? `Lucro parcial: ${overview.profit.unitsWithoutCost} unidade(s) sem custo`
              : "Faturamento, pedidos e lucro estimado"
            : `Faturamento parcial: ${overview.metrics.revenueCoverage.capturedOrders} de ${overview.metrics.revenueCoverage.totalOrders} pedidos`;
        }).catch((error) => { mercadoLivre.error = error instanceof Error ? error.message : "Dados indisponíveis"; }));
        await Promise.all(tasks);
        const refreshedAt = new Date();
        centralCache = { channels: [amazon, mercadoLivre], updatedAt: refreshedAt };
        setChannels([amazon, mercadoLivre]);
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
      <PageHeader eyebrow="Central multicanal" title="Visão geral" subtitle="Acompanhe sua operação inteira e entre em cada canal quando precisar dos detalhes próprios da plataforma." icon={pageIcons.dashboard} action={updatedAt && <span className="data-freshness">Atualizado às {updatedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>} />
      {loading ? <DashboardSkeleton label="Consolidando seus canais" chart={false} rows={2} /> : channels.length === 0 ? (
        <section className="central-empty"><span>SC</span><div><p className="section-kicker">Primeira conexão</p><h2>Monte sua central de vendas</h2><p>Conecte Amazon ou Mercado Livre para começar a consolidar faturamento e pedidos.</p></div><Link href="/integracoes">Conectar um canal <b aria-hidden="true">→</b></Link></section>
      ) : <div className="dashboard-sections space-y-8">
        <section className="central-kpis" aria-label="Indicadores consolidados">
          <article><p>Faturamento conhecido</p><strong><AnimatedNumber value={totals.revenue} format={(amount) => money(amount)} /></strong><small>Soma dos canais com dados disponíveis</small></article>
          <article><p>Lucro conhecido</p><strong>{totals.profitSources ? <AnimatedNumber value={totals.profit} format={(amount) => money(amount)} /> : "Indisponível"}</strong><small>{totals.profitSources} de {totals.connected} canais com cálculo de lucro</small></article>
          <article><p>Pedidos</p><strong>{totals.orders.toLocaleString("pt-BR")}</strong><small>Últimos 30 dias</small></article>
          <article><p>Canais conectados</p><strong>{totals.connected}</strong><small>de {channels.length} disponíveis nesta fase</small></article>
        </section>

        <section aria-labelledby="channel-comparison-title">
          <div className="central-section-heading"><div><p className="section-kicker">Comparação por canal</p><h2 id="channel-comparison-title">Onde sua operação acontece</h2></div><p>Valores indisponíveis permanecem explícitos e nunca entram como zero no consolidado.</p></div>
          <div className="channel-overview-grid">
            {channels.map((channel) => (
              <article key={channel.id} className={`channel-overview-card is-${channel.id}`}>
                <header><span className="channel-overview-mark" aria-hidden="true"><MarketplaceIcon provider={channel.id} size={25} /></span><div><h3>{channel.name}</h3><p>{channel.connected ? "Canal conectado" : "Aguardando conexão"}</p></div><span className={`channel-health${channel.connected ? " is-connected" : ""}`}>{channel.connected ? "Ativo" : "Conectar"}</span></header>
                {channel.connected ? <>
                  <div className="channel-value"><span>Faturamento</span><strong>{channel.error ? "Indisponível" : money(channel.revenue, channel.currency)}</strong></div>
                  <div className="channel-share" aria-label={`Participação relativa de ${channel.name}`}><i style={{ width: `${((channel.revenue ?? 0) / maxRevenue) * 100}%` }} /></div>
                  <dl><div><dt>Pedidos</dt><dd>{channel.orders?.toLocaleString("pt-BR") ?? "—"}</dd></div><div><dt>Lucro</dt><dd>{money(channel.profit, channel.currency)}</dd></div></dl>
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
