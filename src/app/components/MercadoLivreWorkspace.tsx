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
import { ConnectionBroken, isBrokenConnection } from "./ConnectionBroken";
import { CustomizableMetricGrid } from "./CustomizableMetricGrid";
import { CompactMetric, Flow, FlowExpandable, Metric, getRevenueTrend } from "./Metric";
import { CompositionDonut } from "./CompositionDonut";
import { brDate, brTime } from "@/lib/datetime";
import type { ProfitabilityLine } from "@/lib/profitability";
import { MercadoLivreSaldo } from "./MercadoLivreSaldo";
import { Pagination } from "./Pagination";
import { TopProductsRanking } from "./TopProductsRanking";
import { BriefingLead } from "./BriefingLead";
import { IntegrationDashboardFrame } from "./IntegrationDashboardFrame";

interface Overview {
  account: { id: string; nickname: string; siteId: string; };
  period: { from: string; to: string; label: string; };
  metrics: { activeListings: number; productsWithoutCost: number; orders30d: number; paidOrders: number; revenue30d: number; approvedRevenue: number; cancelledRevenue: number; cancelledOrders: number; lastSaleAt: string | null; currency: string; revenueCoverage: { capturedOrders: number; totalOrders: number; complete: boolean; }; };
  profit: { fees: number; cogs: number; taxes: number | null; taxRate: number | null; sellerShipping: number; buyerShipping: number; shippingCostsComplete: boolean; revenueProcessed: number; coverage: { processedOrders: number; paidOrders: number; complete: boolean; }; estimatedProfit: number; marginPct: number; unitsWithoutCost: number; };
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

/**
 * Linha de imposto do detalhamento. Sem alíquota configurada o valor é
 * DESCONHECIDO, não zero: "Impostos (0%) R$ 0,00" afirmava isenção para quem
 * simplesmente ainda não tinha informado o percentual. Mesma regra da Amazon,
 * da Shopee e do TikTok.
 */
function rotuloImposto(taxRate: number | null, taxes: number | null, currency: string): { label: string; value: string } {
  if (taxRate == null || taxes == null) {
    return { label: "Impostos", value: "Alíquota não configurada" };
  }
  return {
    label: `Impostos (${taxRate.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%)`,
    value: money(taxes, currency),
  };
}

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
  const [brokenConnection, setBrokenConnection] = useState<string | null>(null);
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
          if (!response.ok && response.status !== 202) {
            if (isBrokenConnection((data as { errorInfo?: { code?: string } })?.errorInfo?.code)) {
              setBrokenConnection(data.error ?? null);
              return;
            }
            throw new Error(data.error || "Não foi possível consultar o Mercado Livre.");
          }
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
    <IntegrationDashboardFrame
      className={`dashboard-page meli-workspace ${view === "estoque" ? "listing-page" : view === "monitor" ? "monitor-page" : "ml-dashboard-page"}`}
      period={(view === "dashboard" || view === "monitor" || view === "estoque") ? (
        <DashboardPeriodFilter
          {...period.filterProps}
          meta={view === "dashboard" && updatedAt ? <>Atualizado às {brTime(updatedAt)}{overview?.metrics.lastSaleAt ? ` · última venda às ${brTime(overview.metrics.lastSaleAt, true)}` : ""}</> : undefined}
        />
      ) : undefined}
      header={<PageHeader eyebrow={page.eyebrow} title={page.title} subtitle={page.subtitle} icon={page.icon} action={overview && <span className="meli-account-chip"><i aria-hidden="true" />{overview.account.nickname}<small>{overview.account.siteId}</small></span>} />}
    >
      {brokenConnection && <ConnectionBroken channel="mercado_livre" message={brokenConnection} />}
      {loading ? <DashboardSkeleton label="Carregando dados do Mercado Livre" chart={view === "dashboard"} rows={view === "dashboard" ? 4 : 6} /> : brokenConnection ? null : error ? (
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
        <EmptyState title="Conecte sua conta do Mercado Livre" description="Autorize o NEXO para começar a importar anúncios e pedidos." action={<Link href="/integracoes" className="meli-primary-action">Gerenciar integração <span aria-hidden="true">→</span></Link>} />
      ) : view === "dashboard" ? <Dashboard overview={overview} syncStatus={syncStatus} periodoLabel={period.label} /> : view === "estoque" ? <Inventory overview={overview} /> : <Monitor overview={overview} />}
    </IntegrationDashboardFrame>
  );
}

function Dashboard({ overview, syncStatus, periodoLabel }: { overview: Overview; syncStatus: SyncStatus | null; periodoLabel: string }) {
  const [costsOpen, setCostsOpen] = useState(false);
  const profitCoverage = overview.profit.coverage;
  const units = overview.dailySales.reduce((total, point) => total + point.units, 0);
  const critical = overview.stockRadar.filter((product) => product.status === "critical" || product.status === "out");
  const resultIncomplete = !profitCoverage.complete || overview.profit.unitsWithoutCost > 0 || !overview.profit.shippingCostsComplete || overview.profit.taxes == null;
  const netReceived = overview.profit.revenueProcessed - overview.profit.fees - overview.profit.sellerShipping;
  const ticket = overview.metrics.paidOrders > 0 ? overview.metrics.approvedRevenue / overview.metrics.paidOrders : null;
  const roi = overview.profit.cogs > 0 && !resultIncomplete ? (overview.profit.estimatedProfit / overview.profit.cogs) * 100 : null;
  const knownCosts = overview.profit.fees + overview.profit.sellerShipping + overview.profit.cogs + (overview.profit.taxes ?? 0);
  return <div className="dashboard-sections integration-dashboard-sections ml-dashboard-body">
    {/* Mesma abertura dos outros três canais: a frase vem do dado e as
        pendências ficam com ela. Ver `BriefingLead.tsx` — a peça é
        compartilhada de propósito, para os quatro painéis não divergirem. */}
    <BriefingLead
      periodo={periodoLabel}
      faturamento={overview.metrics.revenue30d}
      pedidos={overview.metrics.paidOrders}
      // `resultIncomplete` é a resposta honesta: enquanto falta custo, tarifa
      // ou imposto, o lucro é DESCONHECIDO — passar o parcial como se fosse o
      // resultado é a confusão que `null ≠ 0` existe para evitar.
      lucro={resultIncomplete ? null : overview.profit.estimatedProfit}
      format={(v) => money(v, overview.metrics.currency)}
      acoes={[
        ...(overview.metrics.productsWithoutCost > 0
          ? [{ label: `Cadastrar custo de ${overview.metrics.productsWithoutCost} produto(s)`, href: "/mercado-livre/produtos", tone: "pendencia" as const }]
          : []),
        ...(overview.metrics.cancelledOrders > 0
          ? [{ label: `${overview.metrics.cancelledOrders} pedido(s) cancelado(s) no período`, href: "/mercado-livre/monitor", tone: "alerta" as const }]
          : []),
        ...(critical.length > 0
          ? [{ label: `${critical.length} produto(s) em estoque crítico`, href: "/mercado-livre/estoque", tone: "alerta" as const }]
          : []),
      ]}
    />

    {syncStatus && syncStatus.status !== "complete" && syncStatus.status !== "unavailable" && (
      <div className="sync-chip" role="status">
        <span className="sync-chip-track" aria-hidden="true"><i style={{ width: `${syncStatus.progress}%` }} /></span>
        <p>Histórico: {syncStatus.progress}% importado — os dados abaixo já estão disponíveis.</p>
      </div>
    )}

    <section className="metric-grid ml-dashboard-metric-grid" aria-label="Resumo financeiro Mercado Livre">
      <Metric label="Faturamento" value={<AnimatedNumber id="ml-dash-revenue" value={overview.metrics.revenue30d} format={(amount) => money(amount, overview.metrics.currency)} />} sub={`${overview.metrics.paidOrders} aprovadas + ${overview.metrics.cancelledOrders} canceladas`} trend={getRevenueTrend(overview.dailySales)} />
      <Metric label="Taxas" value={money(overview.profit.fees, overview.metrics.currency)} sub={`${profitCoverage.processedOrders} venda(s) processada(s)`} />
      <Metric label="Custo dos produtos" value={money(overview.profit.cogs, overview.metrics.currency)} sub={overview.profit.unitsWithoutCost > 0 ? `${overview.profit.unitsWithoutCost} unidade(s) sem custo` : "custos cadastrados"} tone={overview.profit.unitsWithoutCost > 0 ? "warn" : "default"} />
      <Metric label={resultIncomplete ? "Resultado processado" : "Lucro estimado"} value={<AnimatedNumber id="ml-dash-profit" value={overview.profit.estimatedProfit} format={(amount) => money(amount, overview.metrics.currency)} />} sub={resultIncomplete ? `${profitCoverage.processedOrders} de ${profitCoverage.paidOrders} vendas` : "após todos os custos"} tone={resultIncomplete ? "default" : overview.profit.estimatedProfit > 0 ? "positive" : overview.profit.estimatedProfit < 0 ? "danger" : "default"} />
      <Metric label="Margem" value={resultIncomplete ? "—" : percent(overview.profit.marginPct)} sub={resultIncomplete ? "aguardando conciliação completa" : "sobre o faturamento"} tone={resultIncomplete ? "default" : overview.profit.marginPct > 0 ? "positive" : overview.profit.marginPct < 0 ? "danger" : "default"} />
    </section>

    <section className="secondary-metrics" aria-label="Indicadores operacionais Mercado Livre">
      <CompactMetric label="Vendas" value={overview.metrics.paidOrders.toLocaleString("pt-BR")} />
      <CompactMetric label="Unidades" value={units.toLocaleString("pt-BR")} />
      <CompactMetric label="Ticket médio" value={ticket == null ? "—" : money(ticket, overview.metrics.currency)} />
      <CompactMetric label="ROI" value={roi == null ? "—" : `${roi.toFixed(1)}%`} tone={roi == null ? "default" : roi > 0 ? "positive" : roi < 0 ? "danger" : "default"} />
      <CompactMetric label="Canceladas" value={`${money(overview.metrics.cancelledRevenue, overview.metrics.currency)} · ${overview.metrics.cancelledOrders}`} tone={overview.metrics.cancelledOrders > 0 ? "danger" : "default"} />
      <CompactMetric label="Total recebido" value={money(netReceived, overview.metrics.currency)} />
    </section>

    <section className="performance-panel">
      <div className="performance-chart">
        <div className="mb-2 flex items-baseline justify-between gap-4">
          <div><p className="section-kicker">Desempenho diário</p><h2 className="mt-1 text-lg font-semibold text-[var(--ink)]">Evolução do faturamento</h2></div>
          <span className="text-sm font-semibold tabular-nums text-[var(--ink)]">{money(overview.metrics.revenue30d, overview.metrics.currency)} <span className="font-normal text-[var(--ink-muted)]">no período</span></span>
        </div>
        <RevenueChart points={overview.dailySales} currency={overview.metrics.currency} explorable />
      </div>
      <aside className="financial-composition" aria-label="Resumo do resultado financeiro">
        <div><p className="section-kicker">Resultado do período</p><h2 className="mt-1 text-lg font-semibold text-[var(--ink)]">Do faturamento ao lucro</h2><p className="mt-1 text-xs leading-relaxed text-[var(--ink-muted)]">{profitCoverage.complete ? "Valores efetivamente identificados no período." : `Detalhamento processado em ${profitCoverage.processedOrders} de ${profitCoverage.paidOrders} vendas.`}</p></div>
        <div className="financial-lines">
          {!resultIncomplete && overview.profit.revenueProcessed > 0 ? (
            <CompositionDonut
              total={overview.profit.revenueProcessed}
              totalLabel="Receita processada"
              format={(value) => money(value, overview.metrics.currency)}
              slices={[
                { id: "fees", label: "Taxas do canal", value: overview.profit.fees },
                { id: "shipping", label: "Frete do vendedor", value: overview.profit.sellerShipping },
                { id: "cogs", label: "Custo dos produtos", value: overview.profit.cogs },
                { id: "taxes", label: "Impostos", value: overview.profit.taxes ?? 0 },
                { id: "profit", label: overview.profit.estimatedProfit >= 0 ? "Lucro estimado" : "Prejuízo", value: Math.abs(overview.profit.estimatedProfit), isRemainder: true },
              ]}
            />
          ) : null}
          <Flow label={profitCoverage.complete ? "Receita paga" : "Receita processada"} value={money(overview.profit.revenueProcessed, overview.metrics.currency)} />
          <FlowExpandable
            label="Custos do canal e do produto"
            value={resultIncomplete ? "—" : money(knownCosts, overview.metrics.currency)}
            open={costsOpen}
            onToggle={() => setCostsOpen((open) => !open)}
            items={[
              { label: "Tarifa de venda", value: money(overview.profit.fees, overview.metrics.currency) },
              { label: "Frete pago pelo vendedor", value: money(overview.profit.sellerShipping, overview.metrics.currency) },
              { label: "Custo dos produtos", value: money(overview.profit.cogs, overview.metrics.currency) },
              rotuloImposto(overview.profit.taxRate, overview.profit.taxes, overview.metrics.currency),
            ]}
          />
          <Flow label={resultIncomplete ? "Lucro indisponível" : "Lucro estimado"} value={resultIncomplete ? "—" : money(overview.profit.estimatedProfit, overview.metrics.currency)} sign="=" accent tone={resultIncomplete ? "default" : overview.profit.estimatedProfit > 0 ? "positive" : overview.profit.estimatedProfit < 0 ? "danger" : "default"} />
        </div>
        <Link href="/mercado-livre/monitor" className="meli-financial-link">Ver composição completa no monitor <span aria-hidden="true">→</span></Link>
        <Link href="/mercado-livre/produtos" className="meli-financial-link">Configurar custos e imposto <span aria-hidden="true">→</span></Link>
        {overview.profit.unitsWithoutCost > 0 && <p className="text-xs leading-relaxed text-amber-700">{overview.profit.unitsWithoutCost} unidade(s) vendida(s) ainda estão sem custo cadastrado.</p>}
        {!profitCoverage.complete && <p className="text-xs leading-relaxed text-amber-700">O NEXO mostra somente os valores já capturados e não extrapola o lucro enquanto o histórico, as tarifas e os fretes não estiverem completos.</p>}
      </aside>
    </section>

    {overview.topProducts.length === 0 ? <Empty>Sem vendas no período para ranquear.</Empty> : <TopProductsRanking products={overview.topProducts.map((product) => ({ sku: product.sku || product.id, title: product.title, units: product.units, revenue: product.revenue, marginPct: product.marginPct }))} currency={overview.metrics.currency} productsHref="/mercado-livre/produtos" />}

    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
      <Panel title="Estoque crítico" href="/mercado-livre/estoque" linkLabel="Ver radar">
        {critical.length === 0 ? <Empty>Nenhum produto em ruptura iminente.</Empty> : <ul className="divide-y divide-[var(--line)]">{critical.slice(0, 6).map((product) => <li key={product.id} className="flex items-center justify-between py-2.5 text-sm"><span className="min-w-0 truncate pr-3">{product.title || product.sku || product.id}</span><span className="shrink-0 font-semibold text-red-600">{product.status === "out" ? "esgotado" : `${product.daysRemaining} dias`}</span></li>)}</ul>}
      </Panel>
      <Panel title="Pedidos recentes" href="/mercado-livre/monitor" linkLabel="Abrir monitor">
        {overview.recentOrders.length === 0 ? <Empty>Nenhum pedido no período.</Empty> : <ul className="divide-y divide-[var(--line)]">{overview.recentOrders.slice(0, 6).map((order) => <li key={order.id} className="flex items-center justify-between py-2.5 text-sm"><span className="min-w-0"><span className="block truncate font-mono text-xs text-[var(--ink-muted)]">#{order.id}</span><span className="text-xs text-[var(--ink-muted)]">{brDate(order.createdAt)} · {orderStatus(order.status)}</span></span><span className="shrink-0 font-medium tabular-nums">{money(order.total, order.currency)}</span></li>)}</ul>}
      </Panel>
    </div>

    {/* Mesma posição do bloco da Amazon: logo depois da conversa sobre dinheiro,
        respondendo o que o lucro sozinho deixa no ar — "então cadê?". */}
    <MercadoLivreSaldo />

    <OrderProfitabilityTable lines={overview.profitabilityLines} />

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


function Panel({ title, href, linkLabel, children }: { title: string; href: string; linkLabel: string; children: React.ReactNode }) {
  return <div className="work-panel border-t border-[var(--line-strong)] py-5"><div className="mb-3 flex items-center justify-between border-b border-[var(--line)] pb-3"><h2 className="text-[13px] font-semibold text-[var(--ink-soft)]">{title}</h2><Link href={href} className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:gap-1.5 hover:text-blue-700">{linkLabel}<span aria-hidden="true">→</span></Link></div>{children}</div>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <EmptyState compact title={String(children)} />;
}

function QuickLink({ href, label, desc }: { href: string; label: string; desc: string }) {
  return <Link href={href} className="quick-command group flex items-center justify-between border-t border-[var(--line-strong)] py-4"><div><p className="text-sm font-semibold text-[var(--ink)]">{label}</p><p className="text-xs text-[var(--ink-muted)]">{desc}</p></div><span className="text-[var(--ink-faint)] transition-[transform,color] group-hover:translate-x-0.5 group-hover:text-yellow-600">→</span></Link>;
}

function Inventory({ overview }: { overview: Overview }) {
  const critical = overview.stockRadar.filter((product) => product.status === "critical" || product.status === "out").length;
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "out" | "critical" | "ok">("all");
  const [sort, setSort] = useState<"urgency" | "stock" | "sales">("urgency");
  const [page, setPage] = useState(1);
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
  const pageCount = Math.max(1, Math.ceil(rows.length / 30));
  const current = Math.min(page, pageCount);
  const pagedRows = rows.slice((current - 1) * 30, current * 30);
  const healthy = overview.stockRadar.filter((product) => product.status === "ok").length;
  const sold = overview.stockRadar.reduce((total, product) => total + product.unitsSold, 0);
  return <div className="inventory-family-body">
    <section className="listing-summary-band is-4" aria-label="Resumo de estoque Mercado Livre">
      <div><span>Produtos ativos</span><strong>{overview.stockRadar.length.toLocaleString("pt-BR")}</strong><small>monitorados no radar</small></div>
      <div className={critical ? "is-danger" : "is-positive"}><span>Ação imediata</span><strong>{critical.toLocaleString("pt-BR")}</strong><small>{critical ? "repor com urgência" : "tudo sob controle"}</small></div>
      <div className="is-positive"><span>Saudáveis</span><strong>{healthy.toLocaleString("pt-BR")}</strong><small>com cobertura</small></div>
      <div><span>Unidades vendidas</span><strong>{sold.toLocaleString("pt-BR")}</strong><small>{overview.period.label}</small></div>
    </section>
    {overview.stockRadar.length === 0 ? <Empty>Nenhum produto ativo encontrado.</Empty> : <>
      <aside className="inventory-method-strip" aria-label="Como a cobertura de estoque é calculada"><strong>Como calculamos</strong><span>Cobertura = estoque atual ÷ média diária de vendas no período. Pausas e dias históricos sem estoque ainda não são descontados.</span></aside>
      <section className="listing-controls cols-3" role="search" aria-label="Filtros de estoque">
        <label className="listing-search"><span className="sr-only">Buscar no estoque</span><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Buscar SKU ou produto" /></label>
        <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value as typeof statusFilter); setPage(1); }} aria-label="Filtrar status do estoque"><option value="all">Todos os status</option><option value="out">Esgotado</option><option value="critical">Crítico</option><option value="ok">Saudável</option></select>
        <select value={sort} onChange={(event) => { setSort(event.target.value as typeof sort); setPage(1); }} aria-label="Ordenar estoque"><option value="urgency">Maior urgência</option><option value="stock">Maior estoque</option><option value="sales">Mais vendidos</option></select>
      </section>
      <section className="listing-table-shell inventory-table-shell" aria-labelledby="ml-inventory-results"><header><div><p className="section-kicker">Cobertura de estoque</p><h2 id="ml-inventory-results">{rows.length} {rows.length === 1 ? "produto encontrado" : "produtos encontrados"}</h2></div><p>{overview.period.label}</p></header>
        {rows.length === 0 ? <Empty>Nenhum produto encontrado. Limpe a busca ou troque o status.</Empty> : <div className="overflow-x-auto"><table className="inventory-table listing-table"><caption className="sr-only">Cobertura de estoque dos produtos do Mercado Livre</caption><thead><tr><th>Produto</th><th>SKU</th><th>Estoque</th><th>Vendidos</th><th>Cobertura</th><th>Status</th></tr></thead><tbody>{pagedRows.map((product) => <tr key={product.id}><td><strong className="block max-w-[360px] truncate" title={product.title}>{product.title}</strong></td><td className="font-mono text-xs">{product.sku || product.id}</td><td className="tabular-nums">{product.availableQuantity}</td><td className="tabular-nums">{product.unitsSold}</td><td className="stock-coverage-value tabular-nums"><strong>{product.daysRemaining == null ? "—" : `${product.daysRemaining} dias`}</strong><small>base: {product.calculationDays} dias</small></td><td className="inventory-status-cell"><span className={`stock-status is-${product.status}`}>{product.status === "out" ? "Esgotado" : product.status === "critical" ? "Crítico" : "Saudável"}</span></td></tr>)}</tbody></table></div>}
        {pageCount > 1 && <div className="listing-pagination"><Pagination page={current} pageCount={pageCount} total={rows.length} pageSize={30} onPage={setPage} /></div>}
      </section>
    </>}
  </div>;
}

function Monitor({ overview }: { overview: Overview }) {
  const profitCoverage = overview.profit.coverage;
  const netReceived = overview.profit.revenueProcessed - overview.profit.fees - overview.profit.sellerShipping;
  const resultIncomplete = !profitCoverage.complete || overview.profit.unitsWithoutCost > 0 || !overview.profit.shippingCostsComplete || overview.profit.taxes == null;
  const [section, setSection] = useState<"composition" | "profitability">("composition");
  return <div className="ml-monitor-body">
    <CustomizableMetricGrid
      viewKey="mercado-livre-monitor"
      ariaLabel="Resumo do monitor Mercado Livre"
      gridClassName="metric-grid monitor-metric-grid"
      widgets={[
        {
          id: "vendas-brutas",
          label: "Vendas brutas",
          node: <Metric label="Vendas brutas" value={<AnimatedNumber id="ml-monitor-revenue" value={overview.metrics.revenue30d} format={(amount) => money(amount, overview.metrics.currency)} />} sub={`${overview.metrics.paidOrders} aprovadas + ${overview.metrics.cancelledOrders} canceladas`} />,
        },
        {
          id: "canceladas",
          label: "Canceladas",
          node: <Metric label="Canceladas" value={money(overview.metrics.cancelledRevenue, overview.metrics.currency)} sub={`${overview.metrics.cancelledOrders} pedido(s) no período`} tone={overview.metrics.cancelledRevenue > 0 ? "danger" : "ok"} className="metric-cancelled" />,
        },
        {
          id: "total-recebido",
          label: profitCoverage.complete ? "Total recebido" : "Total recebido processado",
          node: <Metric label={profitCoverage.complete ? "Total recebido" : "Total recebido processado"} value={money(netReceived, overview.metrics.currency)} sub="após tarifa e frete" />,
        },
        {
          id: "margem",
          label: profitCoverage.complete ? "Margem de contribuição" : "Margem processada",
          node: <Metric label={resultIncomplete ? "Resultado processado" : "Margem de contribuição"} value={money(overview.profit.estimatedProfit, overview.metrics.currency)} sub={`${overview.profit.coverage.processedOrders} de ${overview.profit.coverage.paidOrders} vendas`} tone={resultIncomplete ? "default" : overview.profit.estimatedProfit > 0 ? "positive" : overview.profit.estimatedProfit < 0 ? "danger" : "default"} />,
        },
        {
          id: "margem-pct",
          label: "Margem",
          node: <Metric label="Margem" value={resultIncomplete ? "—" : percent(overview.profit.marginPct)} sub={resultIncomplete ? "aguardando conciliação completa" : "sobre o faturamento"} tone={resultIncomplete ? "default" : overview.profit.marginPct > 0 ? "positive" : overview.profit.marginPct < 0 ? "danger" : "default"} />,
        },
      ]}
    />

    <nav className="monitor-section-tabs" aria-label="Visões do monitor Mercado Livre"><button type="button" aria-current={section === "composition" ? "page" : undefined} onClick={() => setSection("composition")}>Composição</button><button type="button" aria-current={section === "profitability" ? "page" : undefined} onClick={() => setSection("profitability")}>Rentabilidade por venda</button></nav>

    {section === "composition" && <section className="monitor-composition" aria-labelledby="meli-financial-title">
      <header className="monitor-section-heading"><div><p>Financeiro realizado</p><h2 id="meli-financial-title">Do faturamento ao resultado</h2></div><span>Valores conciliados do Mercado Livre</span></header>
      <div className="financial-lines">
        <Flow label={profitCoverage.complete ? "Faturamento dos produtos" : "Faturamento processado"} value={money(overview.profit.revenueProcessed, overview.metrics.currency)} />
        <Flow label="Tarifa de venda" value={money(overview.profit.fees, overview.metrics.currency)} sign="−" />
        <Flow label="Frete pago pelo vendedor" value={money(overview.profit.sellerShipping, overview.metrics.currency)} sign="−" />
        <Flow label="Total recebido" value={money(netReceived, overview.metrics.currency)} sign="=" />
        <Flow label="Custo dos produtos" value={money(overview.profit.cogs, overview.metrics.currency)} sign="−" />
        <Flow label={rotuloImposto(overview.profit.taxRate, overview.profit.taxes, overview.metrics.currency).label} value={rotuloImposto(overview.profit.taxRate, overview.profit.taxes, overview.metrics.currency).value} sign="−" />
        <Flow label="Margem de contribuição" value={money(overview.profit.estimatedProfit, overview.metrics.currency)} sign="=" accent />
      </div>
      {overview.profit.buyerShipping > 0 && <p className="monitor-coverage-note">O comprador pagou {money(overview.profit.buyerShipping, overview.metrics.currency)} de frete no período. Esse valor não compõe o faturamento; o resultado considera apenas o frete efetivamente pago pelo vendedor.</p>}
    {(!profitCoverage.complete || !overview.profit.shippingCostsComplete) && (
      // Nota discreta: o cálculo já cobre o período inteiro; isto só sinaliza o
      // que ainda está sendo conciliado em segundo plano, sem poluir a tela.
      <p className="monitor-coverage-note">
        {!profitCoverage.complete
          ? `Conciliando ${(profitCoverage.paidOrders - profitCoverage.processedOrders).toLocaleString("pt-BR")} de ${profitCoverage.paidOrders.toLocaleString("pt-BR")} vendas — os valores acima consideram só o que já foi apurado.`
          : "Alguns fretes ainda estão sendo conciliados; essas vendas ficam de fora da margem para não superestimá-la."}
      </p>
    )}
    </section>}
    {section === "profitability" && <OrderProfitabilityTable lines={overview.profitabilityLines} />}
  </div>;
}
