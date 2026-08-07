"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AnimatedNumber } from "./components/AnimatedNumber";
import { PageHeader, pageIcons } from "./components/PageHeader";
import { DashboardSkeleton, TableLoading } from "./components/LoadingState";
import { EmptyState } from "./components/EmptyState";
import { MarketplaceIcon } from "./components/MarketplaceIcon";
import { ProfitabilitySale } from "./components/OrderProfitabilityTable";
import { RevenueChart, type DailyPoint } from "./components/RevenueChart";
import type { ProfitabilityLine } from "@/lib/profitability";
import { brTime } from "@/lib/datetime";

interface ProviderConnection { id: string; }
interface Provider { id: string; name: string; configured: boolean; connections: ProviderConnection[]; }
interface AmazonProfit { estimatedProfit: number; unitsWithoutCost: number; finance: { currency: string; }; }
interface AmazonSales { series: { totalRevenue: number; totalOrders: number; currency: string; points?: DailyPoint[]; }; }
interface MercadoLivreOverview { metrics: { revenue30d: number; orders30d: number; activeListings: number; cancelledRevenue: number; cancelledOrders: number; currency: string; revenueCoverage: { complete: boolean; capturedOrders: number; totalOrders: number; }; }; profit: { estimatedProfit: number; unitsWithoutCost: number; coverage: { processedOrders: number; paidOrders: number; complete: boolean; }; }; dailySales?: DailyPoint[]; profitabilityLines?: ProfitabilityLine[]; }

interface ShopeeOverview { metrics: { revenue30d: number; orders30d: number; cancelledRevenue: number; currency: string; revenueCoverage: { complete: boolean; capturedOrders: number; totalOrders: number; }; }; profit: { estimatedProfit: number; unitsWithoutCost: number; coverage: { processedOrders: number; paidOrders: number; complete: boolean; }; }; dailySales?: DailyPoint[]; profitabilityLines?: ProfitabilityLine[]; }

type SaleLine = ProfitabilityLine & { channel: "amazon" | "mercado_livre" | "shopee" };

// Recorte da central: as vendas mais recentes dos canais somados. A tabela
// completa (busca, filtro, paginação) continua dentro de cada canal.
const RECENT_SALES = 20;

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
let centralCache: { channels: ChannelSnapshot[]; series: DailyPoint[]; sales: SaleLine[]; salesNote: string | null; updatedAt: Date } | null = null;

export default function OverviewDashboard() {
  const [channels, setChannels] = useState<ChannelSnapshot[]>(centralCache?.channels ?? []);
  const [series, setSeries] = useState<DailyPoint[]>(centralCache?.series ?? []);
  const [loading, setLoading] = useState(!centralCache);
  const [sales, setSales] = useState<SaleLine[]>(centralCache?.sales ?? []);
  const [salesNote, setSalesNote] = useState<string | null>(centralCache?.salesNote ?? null);
  const [salesLoading, setSalesLoading] = useState(!centralCache);
  const [expandedSale, setExpandedSale] = useState<string | null>(null);
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
        const salesFailures: string[] = [];
        let mercadoLivreLines: ProfitabilityLine[] = [];
        let shopeeLines: ProfitabilityLine[] = [];
        // Corre em paralelo com os agregados, mas não os atrasa: a seção de
        // vendas tem estado de carregamento próprio e pinta quando chegar.
        const amazonLinesReq: Promise<ProfitabilityLine[]> = amazon.connected
          ? json<{ lines: ProfitabilityLine[] }>("/api/order-profitability?days=30").then((data) => data.lines).catch(() => { salesFailures.push("da Amazon"); return []; })
          : Promise.resolve([]);
        if (amazon.connected) tasks.push(Promise.all([json<{ summary: AmazonProfit }>("/api/profit?days=30"), json<AmazonSales>("/api/sales?days=30")]).then(([profit, sales]) => {
          channelSeries.push(sales.series.points);
          amazon.revenue = sales.series.totalRevenue; // data do pedido = Seller Central
          // Reflete os custos já cadastrados (não some enquanto faltam alguns).
          amazon.profit = profit.summary.estimatedProfit;
          amazon.profitPartial = profit.summary.unitsWithoutCost > 0;
          amazon.orders = sales.series.totalOrders;
          amazon.currency = sales.series.currency || profit.summary.finance.currency;
          amazon.note = profit.summary.unitsWithoutCost > 0
            ? `Lucro parcial: ${profit.summary.unitsWithoutCost} unidade(s) sem custo cadastrado`
            : "Faturamento, pedidos e lucro estimado";
        }).catch((error) => { amazon.error = error instanceof Error ? error.message : "Dados indisponíveis"; }));
        if (mercadoLivre.connected) tasks.push(json<{ overview: MercadoLivreOverview }>("/api/integrations/mercado-livre/overview?view=monitor").then(({ overview }) => {
          channelSeries.push(overview.dailySales);
          mercadoLivreLines = overview.profitabilityLines ?? [];
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
            : `Faturamento parcial: ${overview.metrics.revenueCoverage.capturedOrders} de ${overview.metrics.revenueCoverage.totalOrders} pedidos`;
        }).catch((error) => { mercadoLivre.error = error instanceof Error ? error.message : "Dados indisponíveis"; }));
        if (shopee.connected) tasks.push(json<{ overview?: ShopeeOverview; pending?: boolean }>("/api/integrations/shopee/overview?days=30").then((data) => {
          // Conectada mas ainda sem ingestão: mantém os valores em null (nunca
          // zero) para não somar "não vendeu nada" ao consolidado.
          if (data.pending || !data.overview) { shopee.note = "Primeira sincronização pendente"; return; }
          const overview = data.overview;
          channelSeries.push(overview.dailySales);
          shopeeLines = overview.profitabilityLines ?? [];
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
            : `Faturamento parcial: ${overview.metrics.revenueCoverage.capturedOrders} de ${overview.metrics.revenueCoverage.totalOrders} pedidos`;
        }).catch((error) => { shopee.error = error instanceof Error ? error.message : "Dados indisponíveis"; }));
        await Promise.all(tasks);
        const refreshedAt = new Date();
        const merged = mergeDailySeries(channelSeries);
        centralCache = { channels: [amazon, mercadoLivre, shopee], series: merged, sales: centralCache?.sales ?? [], salesNote: centralCache?.salesNote ?? null, updatedAt: refreshedAt };
        setChannels([amazon, mercadoLivre, shopee]);
        setSeries(merged);
        setUpdatedAt(refreshedAt);
        setLoading(false);

        // Segunda pintura: a lista consolidada de vendas chega sem segurar os
        // agregados. As linhas do ML vieram junto do overview; as da Amazon
        // vêm da requisição paralela disparada acima.
        if (mercadoLivre.connected && mercadoLivre.error) salesFailures.push("do Mercado Livre");
        if (shopee.connected && shopee.error) salesFailures.push("da Shopee");
        const amazonLines = await amazonLinesReq;
        const mergedSales: SaleLine[] = [
          ...amazonLines.map((line) => ({ ...line, channel: "amazon" as const })),
          ...mercadoLivreLines.map((line) => ({ ...line, channel: "mercado_livre" as const })),
          ...shopeeLines.map((line) => ({ ...line, channel: "shopee" as const })),
        ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, RECENT_SALES);
        const failureNote = salesFailures.length ? `Não foi possível carregar as vendas ${salesFailures.join(" nem ")} agora.` : null;
        centralCache = { ...centralCache, sales: mergedSales, salesNote: failureNote };
        setSales(mergedSales);
        setSalesNote(failureNote);
      } catch {
        // Uma falha de revalidação não apaga o consolidado já exibido.
        if (!centralCache) setChannels([]);
      } finally {
        setLoading(false);
        setSalesLoading(false);
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

        <section aria-labelledby="central-sales-title">
          <div className="central-section-heading">
            <div><p className="section-kicker">Resultado por venda</p><h2 id="central-sales-title">Últimas vendas dos canais</h2></div>
            <p>As vendas mais recentes de todos os canais (até {RECENT_SALES}), com custos e margem. A lista completa com busca e filtros fica dentro de cada canal.</p>
          </div>
          {salesNote && <p className="central-sales-note" role="status">{salesNote}</p>}
          {salesLoading ? <TableLoading label="Consolidando as vendas dos canais" /> : sales.length === 0 ? (
            !salesNote && <EmptyState title="Nenhuma venda nos últimos 30 dias" description="As vendas dos canais conectados aparecem aqui assim que acontecerem." />
          ) : <div className="profitability-list">
            {sales.map((line) => {
              const key = `${line.channel}-${line.id}`;
              return <ProfitabilitySale key={key} line={line} channel={line.channel} expanded={expandedSale === key} onToggle={() => setExpandedSale(expandedSale === key ? null : key)} />;
            })}
          </div>}
          <div className="central-sales-links">
            {channels.find((channel) => channel.id === "amazon")?.connected && <Link href="/monitor">Ver todas na Amazon <span aria-hidden="true">→</span></Link>}
            {channels.find((channel) => channel.id === "mercado_livre")?.connected && <Link href="/mercado-livre/monitor">Ver todas no Mercado Livre <span aria-hidden="true">→</span></Link>}
            {channels.find((channel) => channel.id === "shopee")?.connected && <Link href="/shopee">Ver todas na Shopee <span aria-hidden="true">→</span></Link>}
          </div>
        </section>

        <section aria-labelledby="channel-comparison-title">
          <div className="central-section-heading"><div><p className="section-kicker">Comparação por canal</p><h2 id="channel-comparison-title">Onde sua operação acontece</h2></div><p>Valores indisponíveis permanecem explícitos e nunca entram como zero no consolidado.</p></div>
          <div className="channel-overview-grid">
            {channels.map((channel) => (
              <article key={channel.id} className={`channel-overview-card is-${channel.id}`}>
                <header><span className="channel-overview-mark" aria-hidden="true"><MarketplaceIcon provider={channel.id} size={40} app /></span><div><h3>{channel.name}</h3><p>{channel.connected ? "Canal conectado" : "Aguardando conexão"}</p></div><span className={`channel-health${channel.connected ? " is-connected" : ""}`}>{channel.connected ? "Ativo" : "Conectar"}</span></header>
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
