"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { EmptyState } from "./EmptyState";
import { PanelLoading } from "./LoadingState";
import { PageHeader, pageIcons } from "./PageHeader";
import { RevenueChart, type DailyPoint } from "./RevenueChart";
import { DashboardPeriodFilter, useDashboardPeriod } from "./DashboardPeriodFilter";
import { OrderProfitabilityTable } from "./OrderProfitabilityTable";
import { OperationPending } from "./OperationPending";
import type { ProfitabilityLine } from "@/lib/profitability";

interface Overview {
  account: { id: string; nickname: string; siteId: string; };
  period: { from: string; to: string; label: string; };
  metrics: { activeListings: number; productsWithoutCost: number; orders30d: number; paidOrders: number; revenue30d: number; currency: string; revenueCoverage: { capturedOrders: number; totalOrders: number; complete: boolean; }; };
  profit: { fees: number; cogs: number; taxes: number; taxRate: number; sellerShipping: number; buyerShipping: number; shippingCostsComplete: boolean; revenueProcessed: number; coverage: { processedOrders: number; paidOrders: number; complete: boolean; }; estimatedProfit: number; marginPct: number; unitsWithoutCost: number; };
  dailySales: DailyPoint[];
  topProducts: Array<{ id: string; sku: string | null; title: string; units: number; revenue: number; cost: number; contribution: number; complete: boolean; marginPct: number | null; }>;
  stockRadar: Array<{ id: string; sku: string | null; title: string; availableQuantity: number; unitsSold: number; calculationDays: number; daysRemaining: number | null; status: "out" | "critical" | "ok"; }>;
  profitabilityLines: ProfitabilityLine[];
  recentOrders: Array<{ id: string; packId: string | null; status: string; createdAt: string; total: number; currency: string; items: number; }>;
}

interface SyncStatus {
  status: "pending" | "syncing" | "complete" | "error" | "unavailable";
  progress: number;
  processedOrders: number;
  lastSuccessAt: string | null;
  error: string | null;
}

interface CachedPeriod {
  overview: Overview;
  syncStatus: SyncStatus | null;
  updatedAt: Date;
}

const views = {
  dashboard: { eyebrow: "Operação Mercado Livre", title: "Dashboard Mercado Livre", subtitle: "Faturamento, pedidos e anúncios da sua conta do Mercado Livre Brasil.", icon: pageIcons.dashboard },
  monitor: { eyebrow: "Pedidos e financeiro Mercado Livre", title: "Monitor da conta", subtitle: "Pedidos recentes e o resultado financeiro real da sua conta.", icon: pageIcons.chart },
  estoque: { eyebrow: "Operação Mercado Livre", title: "Radar de estoque", subtitle: "Cobertura dos anúncios ativos com base no estoque e no ritmo de vendas do período.", icon: pageIcons.box },
} as const;

function money(value: number, currency = "BRL") {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
}

function percent(value: number) {
  return `${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function orderStatus(status: string) {
  const labels: Record<string, string> = { paid: "Pago", confirmed: "Confirmado", payment_required: "Aguardando pagamento", cancelled: "Cancelado" };
  return labels[status] || status.replaceAll("_", " ");
}

export function MercadoLivreWorkspace({ view }: { view: keyof typeof views }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectionPresent, setConnectionPresent] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const periodCache = useRef(new Map<string, CachedPeriod>());
  const period = useDashboardPeriod();
  const page = views[view];

  useEffect(() => {
    const controller = new AbortController();
    const cacheKey = `${view}:${period.query}`;
    const cached = periodCache.current.get(cacheKey);
    const wait = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
    const timer = window.setTimeout(() => {
      if (cached) {
        setOverview(cached.overview);
        setSyncStatus(cached.syncStatus);
        setUpdatedAt(cached.updatedAt);
        setConnectionPresent(true);
        setLoading(false);
      } else {
        setLoading(true);
      }
      setError(null);
      void (async () => {
        let attempts = 0;
        const readJson = async (response: Response) => {
          const text = await response.text();
          try {
            return text ? JSON.parse(text) : {};
          } catch {
            throw new Error(response.status >= 500
              ? "O serviço demorou para responder. Os últimos dados salvos continuam preservados."
              : "A sessão expirou ou a resposta do servidor foi interrompida. Atualize a página e tente novamente.");
          }
        };
        while (!controller.signal.aborted) {
          attempts += 1;
          const response = await fetch(`/api/integrations/mercado-livre/overview?${period.query}&view=${view}`, { cache: "no-store", signal: controller.signal });
          const data = await readJson(response);
          if (!response.ok && response.status !== 202) throw new Error(data.error || "Não foi possível consultar o Mercado Livre.");
          if (data.connectionId) setConnectionPresent(true);
          if (data.sync) setSyncStatus(data.sync as SyncStatus);
          if (data.overview) {
            const nextOverview = data.overview as Overview;
            const nextSync = data.sync ? data.sync as SyncStatus : null;
            const nextUpdatedAt = data.updatedAt ? new Date(data.updatedAt) : new Date();
            periodCache.current.set(cacheKey, {
              overview: nextOverview,
              syncStatus: nextSync,
              updatedAt: nextUpdatedAt,
            });
            setOverview(nextOverview);
            setUpdatedAt(nextUpdatedAt);
            setLoading(false);
            break;
          }
          if (cached) break;
          if (data.preparing) {
            if (attempts >= 40) throw new Error("A preparação dos indicadores está demorando mais que o esperado. Tente novamente em instantes.");
            await wait(1_500);
            continue;
          }
          if (!data.sync || data.sync.status === "complete" || data.sync.status === "unavailable") break;
          if (data.sync.status === "error") throw new Error(data.sync.error || "A sincronização do Mercado Livre foi interrompida.");
          await wait(1_500);
        }
      })()
        .catch((reason) => {
          if (reason instanceof DOMException && reason.name === "AbortError") return;
          // Uma falha de revalidação não deve esconder um período que o
          // usuário acabou de consultar e que continua válido no cache da tela.
          if (cached) return;
          setError(reason instanceof Error ? reason.message : "Não foi possível consultar o Mercado Livre.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [period.query, retryKey, view]);

  return (
    <div className="dashboard-page meli-workspace space-y-8">
      <PageHeader eyebrow={page.eyebrow} title={page.title} subtitle={page.subtitle} icon={page.icon} action={overview && <span className="meli-account-chip"><i aria-hidden="true" />{overview.account.nickname}<small>{overview.account.siteId}</small></span>} />
      {(view === "dashboard" || view === "monitor" || view === "estoque") && (
        <DashboardPeriodFilter {...period.filterProps} />
      )}
      {overview && syncStatus && syncStatus.status !== "complete" && syncStatus.status !== "unavailable" && (
        <p className="-mt-5 text-xs text-amber-700">
          Histórico sendo atualizado em segundo plano: {syncStatus.progress}% concluído. Os dados já disponíveis aparecem abaixo.
        </p>
      )}
      {loading ? <PanelLoading label="Carregando dados do Mercado Livre" /> : error ? (
        <EmptyState title="Não foi possível atualizar o Mercado Livre" description={error} action={<button type="button" onClick={() => setRetryKey((key) => key + 1)} className="meli-primary-action">Tentar novamente <span aria-hidden="true">↻</span></button>} />
      ) : !overview && connectionPresent ? (
        <EmptyState title="Conta conectada, dados em preparação" description="A integração está ativa. O SellerCore está organizando os pedidos do período solicitado." action={<button type="button" onClick={() => setRetryKey((key) => key + 1)} className="meli-primary-action">Atualizar dados <span aria-hidden="true">↻</span></button>} />
      ) : !overview ? (
        <EmptyState title="Conecte sua conta do Mercado Livre" description="Autorize o SellerCore para começar a importar anúncios e pedidos." action={<Link href="/integracoes" className="meli-primary-action">Gerenciar integração <span aria-hidden="true">→</span></Link>} />
      ) : view === "dashboard" ? <Dashboard overview={overview} updatedAt={updatedAt} /> : view === "estoque" ? <Inventory overview={overview} /> : <Monitor overview={overview} />}
    </div>
  );
}

function Dashboard({ overview, updatedAt }: { overview: Overview; updatedAt: Date | null }) {
  const coverage = overview.metrics.revenueCoverage;
  const profitCoverage = overview.profit.coverage;
  const ticket = overview.metrics.paidOrders > 0 ? overview.metrics.revenue30d / overview.metrics.paidOrders : 0;
  const units = overview.dailySales.reduce((total, point) => total + point.units, 0);
  const critical = overview.stockRadar.filter((product) => product.status === "critical" || product.status === "out");
  const roi = overview.profit.cogs > 0 ? overview.profit.estimatedProfit / overview.profit.cogs * 100 : null;
  return <>
    {updatedAt && <p className="-mt-5 text-xs text-slate-400">Atualizado às {updatedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}. Dados disponíveis no SellerCore.</p>}

    <OperationPending items={overview.metrics.productsWithoutCost > 0 ? [{ label: `Cadastrar custo de ${overview.metrics.productsWithoutCost} produto(s)`, href: "/mercado-livre/produtos" }] : []} />

    <section className="metric-grid grid grid-cols-1 gap-0 sm:grid-cols-2 lg:grid-cols-4" aria-label="Indicadores Mercado Livre">
      <Metric label="Faturamento" value={money(overview.metrics.revenue30d, overview.metrics.currency)} sub={coverage.complete ? `${overview.metrics.paidOrders} vendas no período` : `${coverage.capturedOrders} pedidos capturados; histórico em andamento`} />
      <div className="metric-cell metric-primary relative overflow-hidden p-5">
        <div className="flex items-start justify-between gap-2"><p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">{profitCoverage.complete ? "Lucro estimado" : "Lucro processado"}</p><span className="text-emerald-600/50">{dashboardKpiIcons.percent}</span></div>
        <p className="mt-2 text-[27px] font-bold leading-none tabular-nums text-emerald-800">{money(overview.profit.estimatedProfit, overview.metrics.currency)}</p>
        <p className="mt-1.5 text-xs font-medium text-emerald-700/80">{profitCoverage.complete ? `margem ${percent(overview.profit.marginPct)}` : `${profitCoverage.processedOrders} de ${profitCoverage.paidOrders} vendas`}</p>
      </div>
      <Metric label="Estoque crítico" value={critical.length.toLocaleString("pt-BR")} sub={critical.length ? "repor com urgência" : "tudo sob controle"} tone={critical.length ? "danger" : "ok"} icon={dashboardKpiIcons.stock} />
      <Metric label="Produtos sem custo" value={overview.metrics.productsWithoutCost.toLocaleString("pt-BR")} sub={overview.metrics.productsWithoutCost ? "cadastre para ver o lucro" : "todos cadastrados"} tone={overview.metrics.productsWithoutCost ? "warn" : "ok"} icon={dashboardKpiIcons.box} />
    </section>

    <section className="secondary-metrics" aria-label="Indicadores complementares">
      <CompactMetric label="Vendas" value={overview.metrics.paidOrders.toLocaleString("pt-BR")} />
      <CompactMetric label="Unidades" value={units.toLocaleString("pt-BR")} />
      <CompactMetric label="Ticket médio" value={money(ticket, overview.metrics.currency)} />
      <CompactMetric label="ROI" value={roi == null ? "—" : `${roi.toFixed(1)}%`} />
    </section>

    <section className="performance-panel">
      <div className="performance-chart">
        <div className="mb-2 flex items-baseline justify-between gap-4">
          <div><p className="section-kicker">Desempenho diário</p><h2 className="mt-1 text-lg font-semibold text-slate-900">Evolução do faturamento</h2></div>
          <span className="text-sm font-semibold tabular-nums text-slate-900">{money(overview.metrics.revenue30d, overview.metrics.currency)} <span className="font-normal text-slate-400">no período</span></span>
        </div>
        <RevenueChart points={overview.dailySales} />
      </div>
      <aside className="financial-composition" aria-label="Composição do resultado financeiro">
        <div><p className="section-kicker">Composição financeira</p><h2 className="mt-1 text-lg font-semibold text-slate-900">Do faturamento ao lucro</h2><p className="mt-1 text-xs leading-relaxed text-slate-400">{profitCoverage.complete ? "Valores efetivamente identificados no período." : `Detalhamento processado em ${profitCoverage.processedOrders} de ${profitCoverage.paidOrders} vendas.`}</p></div>
        <div className="financial-lines">
          <Flow label={profitCoverage.complete ? "Receita paga" : "Receita processada"} value={money(overview.profit.revenueProcessed, overview.metrics.currency)} />
          <Flow label="Comissão de venda" value={money(overview.profit.fees, overview.metrics.currency)} sign="−" />
          <Flow label="Frete do vendedor" value={money(overview.profit.sellerShipping, overview.metrics.currency)} sign="−" />
          <Flow label="Custo dos produtos" value={money(overview.profit.cogs, overview.metrics.currency)} sign="−" />
          <Flow label={`Impostos (${overview.profit.taxRate.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%)`} value={money(overview.profit.taxes, overview.metrics.currency)} sign="−" />
          <Flow label={profitCoverage.complete ? "Lucro estimado" : "Lucro processado"} value={money(overview.profit.estimatedProfit, overview.metrics.currency)} sign="=" accent />
        </div>
        <Link href="/mercado-livre/produtos" className="meli-financial-link">Configurar custos e imposto <span aria-hidden="true">→</span></Link>
        {overview.profit.unitsWithoutCost > 0 && <p className="text-xs leading-relaxed text-amber-700">{overview.profit.unitsWithoutCost} unidade(s) vendida(s) ainda estão sem custo cadastrado.</p>}
        {!profitCoverage.complete && <p className="text-xs leading-relaxed text-amber-700">O SellerCore mostra somente os valores já capturados e não extrapola o lucro enquanto o histórico, as tarifas e os fretes não estiverem completos.</p>}
      </aside>
    </section>

    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
      <Panel title="Estoque crítico" href="/mercado-livre/estoque" linkLabel="Ver radar">
        {critical.length === 0 ? <Empty>Nenhum produto em ruptura iminente.</Empty> : <ul className="divide-y divide-slate-100">{critical.slice(0, 6).map((product) => <li key={product.id} className="flex items-center justify-between py-2.5 text-sm"><span className="min-w-0 truncate pr-3">{product.title || product.sku || product.id}</span><span className="shrink-0 font-semibold text-red-600">{product.status === "out" ? "esgotado" : `${product.daysRemaining} dias`}</span></li>)}</ul>}
      </Panel>
      <Panel title="Pedidos recentes" href="/mercado-livre/monitor" linkLabel="Abrir monitor">
        {overview.recentOrders.length === 0 ? <Empty>Nenhum pedido no período.</Empty> : <ul className="divide-y divide-slate-100">{overview.recentOrders.slice(0, 6).map((order) => <li key={order.id} className="flex items-center justify-between py-2.5 text-sm"><span className="min-w-0"><span className="block truncate font-mono text-xs text-slate-500">#{order.id}</span><span className="text-xs text-slate-400">{new Date(order.createdAt).toLocaleDateString("pt-BR")} · {orderStatus(order.status)}</span></span><span className="shrink-0 font-medium tabular-nums">{money(order.total, order.currency)}</span></li>)}</ul>}
      </Panel>
    </div>

    <div className="work-panel border-t border-slate-300 py-5">
      <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Top produtos</h2><Link href="/mercado-livre/produtos" className="text-xs font-medium text-blue-600 hover:underline">Ver produtos →</Link></div>
      {overview.topProducts.length === 0 ? <Empty>Sem vendas no período para ranquear.</Empty> : <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-sm"><caption className="sr-only">Produtos com melhor desempenho no período</caption><thead className="text-left text-xs uppercase tracking-wide text-slate-400"><tr><th scope="col" className="pb-2 pr-3 font-medium">#</th><th scope="col" className="pb-2 pr-3 font-medium">Produto</th><th scope="col" className="pb-2 px-3 text-right font-medium">Un</th><th scope="col" className="pb-2 px-3 text-right font-medium">Faturamento</th><th scope="col" className="pb-2 pl-3 text-right font-medium">Margem</th></tr></thead><tbody className="divide-y divide-slate-100">{overview.topProducts.map((product, index) => <tr key={`${product.id}:${product.sku || ""}`}><td className="py-2.5 pr-3 tabular-nums text-slate-400">{index + 1}</td><td className="py-2.5 pr-3"><span className="block max-w-[260px] truncate font-medium" title={product.title}>{product.title}</span></td><td className="py-2.5 px-3 text-right tabular-nums text-slate-600">{product.units}</td><td className="py-2.5 px-3 text-right tabular-nums font-medium">{money(product.revenue, overview.metrics.currency)}</td><td className="py-2.5 pl-3 text-right"><MarginBadge pct={product.marginPct} /></td></tr>)}</tbody></table><p className="mt-3 text-xs text-slate-400">O faturamento considera todas as vendas do período. A margem aparece somente quando todos os custos daquele produto foram processados.</p></div>}
    </div>

    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <QuickLink href="/mercado-livre/monitor" label="Monitor" desc="Pedidos e financeiro" />
      <QuickLink href="/mercado-livre/estoque" label="Radar" desc="Estoque × velocidade" />
      <QuickLink href="/mercado-livre/anuncios" label="Anúncios" desc="Catálogo publicado" />
      <QuickLink href="/mercado-livre/produtos" label="Produtos" desc="Custos e impostos" />
    </div>
  </>;
}

function Metric({ label, value, sub, tone = "default", icon }: { label: string; value: string; sub: string; tone?: "default" | "warn" | "ok" | "danger"; icon?: React.ReactNode }) {
  const color = tone === "danger" ? "text-red-600" : tone === "warn" ? "text-amber-600" : tone === "ok" ? "text-slate-700" : "text-slate-900";
  return <article className="metric-cell group p-5"><div className="flex items-start justify-between gap-2"><p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>{icon && <span className="text-slate-300 transition-colors group-hover:text-yellow-500">{icon}</span>}</div><p className={`mt-2 text-[27px] font-bold leading-none tabular-nums ${color}`}>{value}</p><p className="mt-1.5 text-xs text-slate-400">{sub}</p></article>;
}

function CompactMetric({ label, value }: { label: string; value: string }) {
  return <div className="compact-metric"><p>{label}</p><strong>{value}</strong></div>;
}

function Flow({ label, value, sign, accent = false }: { label: string; value: string; sign?: "−" | "="; accent?: boolean }) {
  return <div className={`financial-line ${accent ? "is-result" : ""}`}><span className="financial-sign" aria-hidden="true">{sign}</span><p className="text-xs font-medium text-slate-500">{label}</p><p className={`text-sm font-bold tabular-nums ${accent ? "text-emerald-700" : sign ? "text-slate-500" : "text-slate-900"}`}>{value}</p></div>;
}

const dashboardKpiIcons = {
  stock: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-5 w-5"><path d="M20 7 12 3 4 7v10l8 4 8-4V7Z" strokeLinejoin="round" /><path d="m4 7 8 4 8-4M12 11v10" strokeLinejoin="round" /></svg>,
  box: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-5 w-5"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M9 4v5" strokeLinecap="round" /></svg>,
  percent: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-5 w-5"><path d="M19 5 5 19" strokeLinecap="round" /><circle cx="7.5" cy="7.5" r="2.2" /><circle cx="16.5" cy="16.5" r="2.2" /></svg>,
};

function Panel({ title, href, linkLabel, children }: { title: string; href: string; linkLabel: string; children: React.ReactNode }) {
  return <div className="work-panel border-t border-slate-300 py-5"><div className="mb-3 flex items-center justify-between border-b border-slate-100 pb-3"><h2 className="text-[13px] font-semibold text-slate-700">{title}</h2><Link href={href} className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:gap-1.5 hover:text-blue-700">{linkLabel}<span aria-hidden="true">→</span></Link></div>{children}</div>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <EmptyState compact title={String(children)} />;
}

function MarginBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-400">—</span>;
  const color = pct >= 25 ? "bg-emerald-100 text-emerald-700" : pct >= 10 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${color}`}>{percent(pct)}</span>;
}

function QuickLink({ href, label, desc }: { href: string; label: string; desc: string }) {
  return <Link href={href} className="quick-command group flex items-center justify-between border-t border-slate-300 py-4"><div><p className="text-sm font-semibold text-slate-900">{label}</p><p className="text-xs text-slate-400">{desc}</p></div><span className="text-slate-300 transition-[transform,color] group-hover:translate-x-0.5 group-hover:text-yellow-600">→</span></Link>;
}

function Inventory({ overview }: { overview: Overview }) {
  const critical = overview.stockRadar.filter((product) => product.status === "critical" || product.status === "out").length;
  return <>
    <section className="metric-grid grid grid-cols-1 gap-0 sm:grid-cols-3" aria-label="Resumo de estoque Mercado Livre">
      <Metric label="Produtos ativos" value={overview.stockRadar.length.toLocaleString("pt-BR")} sub="monitorados no radar" icon={dashboardKpiIcons.box} />
      <Metric label="Estoque crítico" value={critical.toLocaleString("pt-BR")} sub={critical ? "repor com urgência" : "tudo sob controle"} tone={critical ? "danger" : "ok"} icon={dashboardKpiIcons.stock} />
      <Metric label="Unidades vendidas" value={overview.stockRadar.reduce((total, product) => total + product.unitsSold, 0).toLocaleString("pt-BR")} sub={overview.period.label} />
    </section>
    <section className="work-panel">
      <div className="mb-3"><p className="section-kicker">Cobertura de estoque</p><h2 className="mt-1 text-lg font-semibold text-slate-900">Produtos por urgência de reposição</h2></div>
      <aside className="stock-coverage-note" aria-label="Como a cobertura de estoque é calculada">
        <div><span aria-hidden="true">÷</span><p><strong>Como calculamos</strong>Cobertura = estoque atual ÷ média de unidades vendidas por dia.</p></div>
        <p>A média diária usa as vendas pagas e o menor intervalo entre o período selecionado e a idade do anúncio. Pausas e dias históricos sem estoque ainda não são descontados.</p>
      </aside>
      {overview.stockRadar.length === 0 ? <Empty>Nenhum produto ativo encontrado.</Empty> : <div className="overflow-x-auto"><table className="inventory-table w-full min-w-[680px] text-sm"><caption className="sr-only">Cobertura de estoque dos produtos do Mercado Livre</caption><thead><tr><th>Produto</th><th>SKU</th><th className="text-right">Estoque</th><th className="text-right">Vendidos</th><th className="text-right">Cobertura</th><th className="text-center">Status</th></tr></thead><tbody>{overview.stockRadar.map((product) => <tr key={product.id}><td><strong className="block max-w-[320px] truncate" title={product.title}>{product.title}</strong></td><td className="font-mono text-xs">{product.sku || product.id}</td><td className="text-right tabular-nums">{product.availableQuantity}</td><td className="text-right tabular-nums">{product.unitsSold}</td><td className="stock-coverage-value text-right tabular-nums"><strong>{product.daysRemaining == null ? "—" : `${product.daysRemaining} dias`}</strong><small>base: {product.calculationDays} dias</small></td><td className="inventory-status-cell text-center"><span className={`stock-status is-${product.status}`}>{product.status === "out" ? "Esgotado" : product.status === "critical" ? "Crítico" : "Saudável"}</span></td></tr>)}</tbody></table></div>}
    </section>
  </>;
}

function Monitor({ overview }: { overview: Overview }) {
  const profitCoverage = overview.profit.coverage;
  const netReceived = overview.profit.revenueProcessed - overview.profit.fees - overview.profit.sellerShipping;
  return <>
    <section className="metric-grid grid grid-cols-2 gap-4 lg:grid-cols-4" aria-label="Resumo do monitor Mercado Livre">
      <Metric label="Pedidos" value={overview.metrics.orders30d.toLocaleString("pt-BR")} sub={overview.period.label} />
      <Metric label="Faturamento" value={money(overview.metrics.revenue30d, overview.metrics.currency)} sub="produtos vendidos" />
      <Metric label={profitCoverage.complete ? "Total recebido" : "Total recebido processado"} value={money(netReceived, overview.metrics.currency)} sub="após tarifa e frete" />
      <Metric label={profitCoverage.complete ? "Margem de contribuição" : "Margem processada"} value={money(overview.profit.estimatedProfit, overview.metrics.currency)} sub={profitCoverage.complete ? `${percent(overview.profit.marginPct)} do faturamento` : `${profitCoverage.processedOrders} de ${profitCoverage.paidOrders} vendas`} />
    </section>

    <section className="work-panel space-y-4" aria-labelledby="meli-financial-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 pb-3">
        <div>
          <p className="section-kicker">Financeiro realizado</p>
          <h2 id="meli-financial-title" className="mt-1 text-lg font-semibold text-slate-900">Do faturamento à margem</h2>
        </div>
        <span className="text-xs text-slate-400">valores conciliados do Mercado Livre</span>
      </div>
      <div className="financial-lines">
        <Flow label={profitCoverage.complete ? "Faturamento dos produtos" : "Faturamento processado"} value={money(overview.profit.revenueProcessed, overview.metrics.currency)} />
        <Flow label="Tarifa de venda" value={money(overview.profit.fees, overview.metrics.currency)} sign="−" />
        <Flow label="Frete pago pelo vendedor" value={money(overview.profit.sellerShipping, overview.metrics.currency)} sign="−" />
        <Flow label="Total recebido" value={money(netReceived, overview.metrics.currency)} sign="=" />
        <Flow label="Custo dos produtos" value={money(overview.profit.cogs, overview.metrics.currency)} sign="−" />
        <Flow label={`Impostos (${overview.profit.taxRate.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%)`} value={money(overview.profit.taxes, overview.metrics.currency)} sign="−" />
        <Flow label="Margem de contribuição" value={money(overview.profit.estimatedProfit, overview.metrics.currency)} sign="=" accent />
      </div>
      {overview.profit.buyerShipping > 0 && <p className="text-xs text-slate-400">O comprador pagou {money(overview.profit.buyerShipping, overview.metrics.currency)} de frete no período; esse valor é exibido separadamente e não compõe o faturamento dos produtos.</p>}
    </section>
    {!profitCoverage.complete && <div className="meli-profit-warning"><span aria-hidden="true">!</span><p>Este detalhamento usa somente os pedidos já capturados e cobre {profitCoverage.processedOrders} de {profitCoverage.paidOrders} vendas disponíveis, sem extrapolar valores.</p></div>}
    {!overview.profit.shippingCostsComplete && <div className="meli-profit-warning"><span aria-hidden="true">!</span><p>Alguns fretes ainda não foram conciliados. Essas vendas aparecem com cálculo incompleto para não superestimar a margem.</p></div>}
    <OrderProfitabilityTable lines={overview.profitabilityLines} />
  </>;
}
