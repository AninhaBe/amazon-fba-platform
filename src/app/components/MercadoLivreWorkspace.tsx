"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AnimatedNumber } from "./AnimatedNumber";
import { EmptyState } from "./EmptyState";
import { DashboardSkeleton } from "./LoadingState";
import { PageHeader, pageIcons } from "./PageHeader";
import { RevenueChart, type DailyPoint } from "./RevenueChart";
import { DashboardPeriodFilter, useDashboardPeriod } from "./DashboardPeriodFilter";
import { OrderProfitabilityTable } from "./OrderProfitabilityTable";
import { OperationPending } from "./OperationPending";
import { Flow, Metric, getRevenueTrend } from "./Metric";
import { brDate, brTime } from "@/lib/datetime";
import { Boxes, PackageOpen, Percent } from "lucide-react";
import type { ProfitabilityLine } from "@/lib/profitability";

interface Overview {
  account: { id: string; nickname: string; siteId: string; };
  period: { from: string; to: string; label: string; };
  metrics: { activeListings: number; productsWithoutCost: number; orders30d: number; paidOrders: number; revenue30d: number; approvedRevenue: number; cancelledRevenue: number; cancelledOrders: number; lastSaleAt: string | null; currency: string; revenueCoverage: { capturedOrders: number; totalOrders: number; complete: boolean; }; };
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

// Escopo de módulo: sobrevive à navegação entre canais (o componente desmonta
// ao ir para a Amazon e voltar). Ao retornar, o período já visto aparece na
// hora e a revalidação acontece em segundo plano. Um reload limpa tudo.
const periodCache = new Map<string, CachedPeriod>();

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
  const period = useDashboardPeriod();
  // Ao voltar de outro canal, o período já visto renderiza no primeiro paint
  // (sem flash de skeleton); a revalidação segue em segundo plano.
  const [initialCached] = useState(() => periodCache.get(`${view}:${period.query}`));
  const [overview, setOverview] = useState<Overview | null>(initialCached?.overview ?? null);
  const [loading, setLoading] = useState(!initialCached);
  const [error, setError] = useState<string | null>(null);
  const [connectionPresent, setConnectionPresent] = useState(!!initialCached);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(initialCached?.updatedAt ?? null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(initialCached?.syncStatus ?? null);
  const [retryKey, setRetryKey] = useState(0);
  const page = views[view];

  useEffect(() => {
    const controller = new AbortController();
    const cacheKey = `${view}:${period.query}`;
    const cached = periodCache.get(cacheKey);
    const wait = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
    const pollingDelay = (attempt: number) => Math.min(5_000, 1_500 + Math.max(0, attempt - 1) * 500);
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
            periodCache.set(cacheKey, {
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
            await wait(pollingDelay(attempts));
            continue;
          }
          if (!data.sync || data.sync.status === "complete" || data.sync.status === "unavailable") break;
          if (data.sync.status === "error") throw new Error(data.sync.error || "A sincronização do Mercado Livre foi interrompida.");
          await wait(pollingDelay(attempts));
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
        <div className="sync-chip -mt-5" role="status">
          <span className="sync-chip-track" aria-hidden="true"><i style={{ width: `${syncStatus.progress}%` }} /></span>
          <p>Histórico: {syncStatus.progress}% importado — os dados abaixo já estão disponíveis.</p>
        </div>
      )}
      {loading ? <DashboardSkeleton label="Carregando dados do Mercado Livre" chart={view === "dashboard"} rows={view === "dashboard" ? 4 : 6} /> : error ? (
        <EmptyState title="Não foi possível atualizar o Mercado Livre" description={error} action={<button type="button" onClick={() => setRetryKey((key) => key + 1)} className="meli-primary-action">Tentar novamente <span aria-hidden="true">↻</span></button>} />
      ) : !overview && connectionPresent ? (
        <div className="space-y-4">
          <div className="sync-chip" role="status">
            <span className="sync-chip-track is-indeterminate" aria-hidden="true"><i /></span>
            <p>Conta conectada — organizando os pedidos do período. Os indicadores aparecem aqui em instantes.</p>
          </div>
          <DashboardSkeleton label="Preparando os indicadores do período" chart={view === "dashboard"} />
        </div>
      ) : !overview ? (
        <EmptyState title="Conecte sua conta do Mercado Livre" description="Autorize o SellerCore para começar a importar anúncios e pedidos." action={<Link href="/integracoes" className="meli-primary-action">Gerenciar integração <span aria-hidden="true">→</span></Link>} />
      ) : view === "dashboard" ? <Dashboard overview={overview} updatedAt={updatedAt} /> : view === "estoque" ? <Inventory overview={overview} /> : <Monitor overview={overview} />}
    </div>
  );
}

function Dashboard({ overview, updatedAt }: { overview: Overview; updatedAt: Date | null }) {
  const profitCoverage = overview.profit.coverage;
  const ticket = overview.metrics.paidOrders > 0 ? overview.metrics.revenue30d / overview.metrics.paidOrders : 0;
  const units = overview.dailySales.reduce((total, point) => total + point.units, 0);
  const critical = overview.stockRadar.filter((product) => product.status === "critical" || product.status === "out");
  const roi = overview.profit.cogs > 0 ? overview.profit.estimatedProfit / overview.profit.cogs * 100 : null;
  // Sem custos cadastrados o "lucro" é só margem antes do produto — não engana.
  const costsIncomplete = overview.profit.unitsWithoutCost > 0;
  return <div className="dashboard-sections space-y-8">
    {updatedAt && <p className="-mt-5 text-xs text-slate-400">Atualizado às {brTime(updatedAt)}{overview.metrics.lastSaleAt ? ` · última venda contabilizada às ${brTime(overview.metrics.lastSaleAt, true)}` : ""}. Compare no mesmo horário com o painel do Mercado Livre.</p>}

    <OperationPending items={overview.metrics.productsWithoutCost > 0 ? [{ label: `Cadastrar custo de ${overview.metrics.productsWithoutCost} produto(s)`, href: "/mercado-livre/produtos" }] : []} />

    <section className="metric-grid grid grid-cols-1 gap-0 sm:grid-cols-2 lg:grid-cols-4" aria-label="Indicadores Mercado Livre">
      <Metric label="Vendas brutas" value={<AnimatedNumber id="ml-dash-revenue" value={overview.metrics.revenue30d} format={(amount) => money(amount, overview.metrics.currency)} />} sub={`${overview.metrics.paidOrders} aprovadas + ${overview.metrics.cancelledOrders} canceladas`} trend={getRevenueTrend(overview.dailySales)} />
      <div className="metric-cell metric-primary relative overflow-hidden p-5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">{costsIncomplete ? "Margem antes do custo" : "Lucro estimado"}</p>
        <p className="mt-2 text-[27px] font-bold leading-none tabular-nums text-emerald-800"><AnimatedNumber id="ml-dash-profit" value={overview.profit.estimatedProfit} format={(amount) => money(amount, overview.metrics.currency)} /></p>
        {costsIncomplete
          ? <p className="mt-1.5 text-xs font-medium text-amber-700">cadastre custos para o lucro real</p>
          : <p className="mt-2 flex items-baseline gap-1.5"><span className="text-[17px] font-extrabold tabular-nums text-emerald-600">{percent(overview.profit.marginPct)}</span><span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700/70">margem</span></p>}
      </div>
      <Metric label="Estoque crítico" value={critical.length.toLocaleString("pt-BR")} sub={critical.length ? "repor com urgência — ver radar" : "tudo sob controle — ver radar"} tone={critical.length ? "danger" : "ok"} icon={dashboardKpiIcons.stock} href="/mercado-livre/estoque" />
      <Metric label="Produtos sem custo" value={overview.metrics.productsWithoutCost.toLocaleString("pt-BR")} sub={overview.metrics.productsWithoutCost ? "cadastre para ver o lucro" : "todos cadastrados"} tone={overview.metrics.productsWithoutCost ? "warn" : "ok"} icon={dashboardKpiIcons.box} />
    </section>

    <section className="performance-panel">
      <div className="performance-chart">
        <div className="mb-2 flex items-baseline justify-between gap-4">
          <div><p className="section-kicker">Desempenho diário</p><h2 className="mt-1 text-lg font-semibold text-slate-900">Evolução do faturamento</h2></div>
          <span className="text-sm font-semibold tabular-nums text-slate-900">{money(overview.metrics.revenue30d, overview.metrics.currency)} <span className="font-normal text-slate-400">no período</span></span>
        </div>
        <div className="chart-inline-stats" aria-label="Indicadores complementares">
          <span><small>Aprovadas</small><strong>{money(overview.metrics.approvedRevenue, overview.metrics.currency)}</strong></span>
          <span><small>Canceladas</small><strong className={overview.metrics.cancelledRevenue > 0 ? "text-red-600" : undefined}>{money(overview.metrics.cancelledRevenue, overview.metrics.currency)}</strong></span>
          <span><small>Unidades</small><strong>{units.toLocaleString("pt-BR")}</strong></span>
          <span><small>Ticket médio</small><strong>{money(ticket, overview.metrics.currency)}</strong></span>
          <span><small>ROI</small><strong>{roi == null ? "—" : `${roi.toFixed(1)}%`}</strong></span>
        </div>
        <RevenueChart points={overview.dailySales} />
      </div>
      <aside className="financial-composition" aria-label="Resumo do resultado financeiro">
        <div><p className="section-kicker">Resultado do período</p><h2 className="mt-1 text-lg font-semibold text-slate-900">Do faturamento ao lucro</h2><p className="mt-1 text-xs leading-relaxed text-slate-400">{profitCoverage.complete ? "Valores efetivamente identificados no período." : `Detalhamento processado em ${profitCoverage.processedOrders} de ${profitCoverage.paidOrders} vendas.`}</p></div>
        <div className="financial-lines">
          <Flow label={profitCoverage.complete ? "Receita paga" : "Receita processada"} value={money(overview.profit.revenueProcessed, overview.metrics.currency)} />
          <Flow label="Custos do canal e do produto" value={money(overview.profit.fees + overview.profit.sellerShipping + overview.profit.cogs + overview.profit.taxes, overview.metrics.currency)} sign="−" />
          <Flow label={profitCoverage.complete ? "Lucro estimado" : "Lucro processado"} value={money(overview.profit.estimatedProfit, overview.metrics.currency)} sign="=" accent />
        </div>
        <Link href="/mercado-livre/monitor" className="meli-financial-link">Ver composição completa no monitor <span aria-hidden="true">→</span></Link>
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
        {overview.recentOrders.length === 0 ? <Empty>Nenhum pedido no período.</Empty> : <ul className="divide-y divide-slate-100">{overview.recentOrders.slice(0, 6).map((order) => <li key={order.id} className="flex items-center justify-between py-2.5 text-sm"><span className="min-w-0"><span className="block truncate font-mono text-xs text-slate-500">#{order.id}</span><span className="text-xs text-slate-400">{brDate(order.createdAt)} · {orderStatus(order.status)}</span></span><span className="shrink-0 font-medium tabular-nums">{money(order.total, order.currency)}</span></li>)}</ul>}
      </Panel>
    </div>

    <div className="work-panel border-t border-slate-300 py-5">
      <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Top produtos</h2><Link href="/mercado-livre/produtos" className="text-xs font-medium text-blue-600 hover:underline">Ver produtos →</Link></div>
      {overview.topProducts.length === 0 ? <Empty>Sem vendas no período para ranquear.</Empty> : <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-sm"><caption className="sr-only">Produtos com melhor desempenho no período</caption><thead className="text-left text-xs uppercase tracking-wide text-slate-400"><tr><th scope="col" className="pb-2 pr-3 font-medium">#</th><th scope="col" className="pb-2 pr-3 font-medium">Produto</th><th scope="col" className="pb-2 px-3 text-right font-medium">Un</th><th scope="col" className="pb-2 px-3 text-right font-medium">Faturamento</th><th scope="col" className="pb-2 pl-3 text-right font-medium">Margem</th></tr></thead><tbody className="divide-y divide-slate-100">{overview.topProducts.map((product, index) => <tr key={`${product.id}:${product.sku || ""}`}><td className="py-2.5 pr-3 tabular-nums text-slate-400">{index + 1}</td><td className="py-2.5 pr-3"><span className="block max-w-[260px] truncate font-medium" title={product.title}>{product.title}</span></td><td className="py-2.5 px-3 text-right tabular-nums text-slate-600">{product.units}</td><td className="py-2.5 px-3 text-right tabular-nums font-medium">{money(product.revenue, overview.metrics.currency)}</td><td className="py-2.5 pl-3 text-right"><MarginBadge pct={product.marginPct} /></td></tr>)}</tbody></table><p className="mt-3 text-xs text-slate-400">O faturamento considera todas as vendas do período. A margem aparece somente quando todos os custos daquele produto foram processados.</p></div>}
    </div>

    {/* No desktop a sidebar já cobre estes atalhos; no mobile a nav é scroll
        horizontal e os cartões ajudam. */}
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:hidden">
      <QuickLink href="/mercado-livre/monitor" label="Monitor" desc="Pedidos e financeiro" />
      <QuickLink href="/mercado-livre/estoque" label="Radar" desc="Estoque × velocidade" />
      <QuickLink href="/mercado-livre/anuncios" label="Anúncios" desc="Catálogo publicado" />
      <QuickLink href="/mercado-livre/produtos" label="Produtos" desc="Custos e impostos" />
    </div>
  </div>;
}

const kpiIconProps = { className: "h-5 w-5", strokeWidth: 1.7, "aria-hidden": true } as const;
const dashboardKpiIcons = {
  stock: <Boxes {...kpiIconProps} />,
  box: <PackageOpen {...kpiIconProps} />,
  percent: <Percent {...kpiIconProps} />,
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
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "out" | "critical" | "ok">("all");
  const [sort, setSort] = useState<"urgency" | "stock" | "sales">("urgency");
  const urgencyRank: Record<"out" | "critical" | "ok", number> = { out: 0, critical: 1, ok: 2 };
  const rows = [...overview.stockRadar]
    .filter((product) => `${product.title || ""} ${product.sku || ""} ${product.id}`.toLowerCase().includes(query.toLowerCase()) && (statusFilter === "all" || product.status === statusFilter))
    .sort((a, b) =>
      sort === "stock"
        ? b.availableQuantity - a.availableQuantity
        : sort === "sales"
          ? b.unitsSold - a.unitsSold
          : (urgencyRank[a.status] - urgencyRank[b.status]) || ((a.daysRemaining ?? Number.POSITIVE_INFINITY) - (b.daysRemaining ?? Number.POSITIVE_INFINITY))
    );
  return <div className="dashboard-sections space-y-8">
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
      {overview.stockRadar.length === 0 ? <Empty>Nenhum produto ativo encontrado.</Empty> : <>
        <div className="filter-toolbar mb-4 flex flex-wrap gap-2" role="search" aria-label="Filtros de estoque">
          <label className="min-w-52 flex-1"><span className="sr-only">Buscar no estoque</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar SKU ou produto" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-yellow-500 focus:outline-none" /></label>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} aria-label="Filtrar status do estoque" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"><option value="all">Todos os status</option><option value="out">Esgotado</option><option value="critical">Crítico</option><option value="ok">Saudável</option></select>
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Ordenar estoque" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"><option value="urgency">Maior urgência</option><option value="stock">Maior estoque</option><option value="sales">Mais vendidos</option></select>
        </div>
        {rows.length === 0 ? <Empty>Nenhum produto encontrado. Limpe a busca ou troque o status.</Empty> : <div className="overflow-x-auto"><table className="inventory-table w-full min-w-[680px] text-sm"><caption className="sr-only">Cobertura de estoque dos produtos do Mercado Livre</caption><thead><tr><th>Produto</th><th>SKU</th><th className="text-center">Estoque</th><th className="text-center">Vendidos</th><th className="text-center">Cobertura</th><th className="text-center">Status</th></tr></thead><tbody>{rows.map((product) => <tr key={product.id}><td><strong className="block max-w-[320px] truncate" title={product.title}>{product.title}</strong></td><td className="font-mono text-xs">{product.sku || product.id}</td><td className="text-center tabular-nums">{product.availableQuantity}</td><td className="text-center tabular-nums">{product.unitsSold}</td><td className="stock-coverage-value text-center tabular-nums"><strong>{product.daysRemaining == null ? "—" : `${product.daysRemaining} dias`}</strong><small>base: {product.calculationDays} dias</small></td><td className="inventory-status-cell text-center"><span className={`stock-status is-${product.status}`}>{product.status === "out" ? "Esgotado" : product.status === "critical" ? "Crítico" : "Saudável"}</span></td></tr>)}</tbody></table></div>}
      </>}
    </section>
  </div>;
}

function Monitor({ overview }: { overview: Overview }) {
  const profitCoverage = overview.profit.coverage;
  const netReceived = overview.profit.revenueProcessed - overview.profit.fees - overview.profit.sellerShipping;
  return <div className="dashboard-sections space-y-8">
    <section className="metric-grid grid grid-cols-2 gap-4 lg:grid-cols-4" aria-label="Resumo do monitor Mercado Livre">
      <Metric label="Vendas brutas" value={<AnimatedNumber id="ml-monitor-revenue" value={overview.metrics.revenue30d} format={(amount) => money(amount, overview.metrics.currency)} />} sub={`${overview.metrics.paidOrders} aprovadas + ${overview.metrics.cancelledOrders} canceladas`} />
      <Metric label="Canceladas" value={money(overview.metrics.cancelledRevenue, overview.metrics.currency)} sub={`${overview.metrics.cancelledOrders} pedido(s) no período`} tone={overview.metrics.cancelledRevenue > 0 ? "danger" : "ok"} />
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
      {overview.profit.buyerShipping > 0 && <p className="text-xs text-slate-400">O comprador pagou {money(overview.profit.buyerShipping, overview.metrics.currency)} de frete no período. Assim como no &quot;Vendas brutas&quot; do Mercado Livre, o frete não compõe o faturamento (só o produto); o lucro considera o frete que o vendedor efetivamente paga.</p>}
    </section>
    {(!profitCoverage.complete || !overview.profit.shippingCostsComplete) && (
      // Nota discreta: o cálculo já cobre o período inteiro; isto só sinaliza o
      // que ainda está sendo conciliado em segundo plano, sem poluir a tela.
      <p className="meli-coverage-note">
        {!profitCoverage.complete
          ? `Conciliando ${(profitCoverage.paidOrders - profitCoverage.processedOrders).toLocaleString("pt-BR")} de ${profitCoverage.paidOrders.toLocaleString("pt-BR")} vendas — os valores acima consideram só o que já foi apurado.`
          : "Alguns fretes ainda estão sendo conciliados; essas vendas ficam de fora da margem para não superestimá-la."}
      </p>
    )}
    <OrderProfitabilityTable lines={overview.profitabilityLines} />
  </div>;
}
