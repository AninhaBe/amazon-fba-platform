"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { RevenueChart, type DailyPoint } from "../components/RevenueChart";
import { PageHeader, pageIcons } from "../components/PageHeader";
import { InlineLoading } from "../components/LoadingState";
import { EmptyState } from "../components/EmptyState";
import { DashboardPeriodFilter, useDashboardPeriod } from "../components/DashboardPeriodFilter";
import { OperationPending, type OperationPendingItem } from "../components/OperationPending";
import { Metric as Kpi, getRevenueTrend } from "../components/Metric";
import { AnimatedNumber } from "../components/AnimatedNumber";
import { OrderProfitabilityTable } from "../components/OrderProfitabilityTable";
import { ConnectionBroken, isBrokenConnection } from "../components/ConnectionBroken";

/**
 * Cobertura do cálculo de rentabilidade, como a API devolve. É objeto, não
 * texto: `scopeNote` da tabela espera uma frase, então precisa ser formatado
 * antes de chegar lá (renderizar o objeto cru derruba a página inteira).
 */
interface ProfitabilityScope {
  processedOrders: number;
  completePeriod: boolean;
}

function scopeSentence(scope?: ProfitabilityScope): string | undefined {
  if (!scope) return undefined;
  if (scope.completePeriod) return undefined; // período completo: texto padrão da tabela serve
  return `Detalhamento processado em ${scope.processedOrders} venda(s) do período — o histórico ainda está sendo importado.`;
}
import type { ProfitabilityLine } from "@/lib/profitability";
import { brDate, brTime } from "@/lib/datetime";
import { Boxes, ChartSpline, PackageOpen, Percent, ShoppingCart, Tag } from "lucide-react";
import { readJson } from "../../lib/readJson";

function money(v: number, currency = "BRL") {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(v);
}

interface OrdersData {
  metrics: { totalOrders: number; totalRevenue: number; currency: string; fbaOrders: number; pendingItems: number };
  orders: {
    amazonOrderId: string;
    purchaseDate: string;
    orderStatus: string;
    orderTotal?: { CurrencyCode: string; Amount: string };
  }[];
}
interface ProfitData {
  finance: {
    revenue: number; fees: number; refunds: number; netProceeds: number; currency: string;
    orderCount: number; units: number; daily: DailyPoint[];
  };
  cogs: number;
  estimatedProfit: number;
  unitsWithoutCost: number;
}
interface RadarRow {
  sellerSku: string;
  productName?: string;
  fulfillable: number;
  daysRemaining: number | null;
  status: string;
}
interface ProductRow {
  id: string;
  cost: number | null;
}
// Faturamento e vendas vêm da Sales API (orderMetrics, data do pedido) para
// BATER com o "Vendas brutas" do Seller Central. O lado financeiro (taxas,
// repasse, lucro) vem das transações — base diferente, como as abas Vendas e
// Pagamentos do próprio Seller Central.
interface SalesSeries {
  currency: string;
  points: DailyPoint[];
  totalRevenue: number;
  totalOrders: number;
  totalUnits: number;
}
interface TopProduct {
  sku: string;
  title?: string;
  units: number;
  revenue: number;
  marginPct: number | null;
}


interface DashSnapshot {
  orders: OrdersData | null;
  profit: ProfitData | null;
  radar: RadarRow[];
  sales: SalesSeries | null;
  top: TopProduct[];
  profitability: ProfitabilityLine[];
  profitabilityScope?: ProfitabilityScope;
  updatedAt: Date;
}

// Escopo de módulo: sobrevive à navegação entre canais. Ao voltar, o período
// já visto renderiza no primeiro paint e a revalidação roda em segundo plano.
const dashCache = new Map<string, DashSnapshot>();
let productsCache: ProductRow[] | null = null;

export default function Dashboard() {
  const period = useDashboardPeriod();
  const [initialDash] = useState(() => dashCache.get(period.query));
  const [loading, setLoading] = useState(!initialDash);
  const [orders, setOrders] = useState<OrdersData | null>(initialDash?.orders ?? null);
  const [profit, setProfit] = useState<ProfitData | null>(initialDash?.profit ?? null);
  const [radar, setRadar] = useState<RadarRow[]>(initialDash?.radar ?? []);
  const [products, setProducts] = useState<ProductRow[]>(productsCache ?? []);
  const [sales, setSales] = useState<SalesSeries | null>(initialDash?.sales ?? null);
  const [top, setTop] = useState<TopProduct[]>(initialDash?.top ?? []);
  const [profitability, setProfitability] = useState<ProfitabilityLine[]>(initialDash?.profitability ?? []);
  const [profitabilityScope, setProfitabilityScope] = useState<ProfitabilityScope | undefined>(initialDash?.profitabilityScope);
  const [profitabilityLoading, setProfitabilityLoading] = useState(!initialDash);
  const [productsLoading, setProductsLoading] = useState(!productsCache);
  const [errors, setErrors] = useState<string[]>([]);
  const [brokenConnection, setBrokenConnection] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(initialDash?.updatedAt ?? null);

  const periodQuery = period.query;

  useEffect(() => {
    let active = true;
    const cached = dashCache.get(periodQuery);
    Promise.resolve().then(() => {
      if (!active) return;
      if (cached) {
        setOrders(cached.orders);
        setProfit(cached.profit);
        setRadar(cached.radar);
        setSales(cached.sales);
        setTop(cached.top);
        setProfitability(cached.profitability);
        setProfitabilityScope(cached.profitabilityScope);
        setProfitabilityLoading(false);
        setUpdatedAt(cached.updatedAt);
        setLoading(false);
      } else {
        setLoading(true);
        setProfitabilityLoading(true);
      }
    });
    const next: Omit<DashSnapshot, "updatedAt"> = {
      orders: cached?.orders ?? null,
      profit: cached?.profit ?? null,
      radar: cached?.radar ?? [],
      sales: cached?.sales ?? null,
      top: cached?.top ?? [],
      profitability: cached?.profitability ?? [],
      profitabilityScope: cached?.profitabilityScope,
    };
    const store = () => dashCache.set(periodQuery, { ...next, updatedAt: new Date() });
    const errs: string[] = [];
    // Guarda o motivo de autorização à parte: ele merece tratamento próprio
    // (reconectar), e não entra na lista genérica de "não carregou".
    let broken: string | null = null;
    const safe = <T,>(url: string, set: (v: T) => void, pick: (d: unknown) => T, name: string) =>
      fetch(url)
        .then((r) => readJson(r).then((d) => ({ ok: r.ok, d })))
        .then(({ ok, d }) => {
          if (!ok) {
            const info = (d as { errorInfo?: { code?: string }; error?: string });
            if (isBrokenConnection(info?.errorInfo?.code)) {
              broken = info.error ?? null;
              throw new Error("auth");
            }
            throw new Error(info?.error || name);
          }
          if (active) set(pick(d));
        })
        .catch(() => {
          if (!broken) errs.push(name);
        });

    // Chamadas rápidas — controlam o "loading" do dashboard.
    Promise.all([
      safe<OrdersData>(`/api/orders?${periodQuery}`, (v) => { next.orders = v; setOrders(v); }, (d) => d as OrdersData, "pedidos"),
      safe<ProfitData>(`/api/profit?${periodQuery}`, (v) => { next.profit = v; setProfit(v); }, (d) => (d as { summary: ProfitData }).summary, "financeiro"),
      safe<RadarRow[]>(`/api/radar?${periodQuery}`, (v) => { next.radar = v; setRadar(v); }, (d) => (d as { rows: RadarRow[] }).rows, "estoque"),
      safe<SalesSeries>(`/api/sales?${periodQuery}`, (v) => { next.sales = v; setSales(v); }, (d) => (d as { series: SalesSeries }).series, "vendas"),
    ]).then(() => {
      if (active) {
        setErrors(errs);
        setBrokenConnection(broken);
        setUpdatedAt(new Date());
        setLoading(false);
        store();
      }
    });

    // Produtos e top produtos usam o relatório da Amazon (lento) — carregam em separado.
    if (!productsCache) Promise.resolve().then(() => active && setProductsLoading(true));
    safe<ProductRow[]>(`/api/products`, (v) => { productsCache = v; setProducts(v); }, (d) => (d as { products: ProductRow[] }).products, "produtos").finally(
      () => active && setProductsLoading(false)
    );
    safe<TopProduct[]>(`/api/top-products?${periodQuery}`, (v) => { next.top = v; setTop(v); store(); }, (d) => (d as { products: TopProduct[] }).products, "top produtos");
    // Rentabilidade por venda: mesma fonte do monitor, com loading próprio para
    // não segurar os KPIs (o fallback ao vivo do endpoint pode ser lento).
    safe<{ lines: ProfitabilityLine[]; scope?: ProfitabilityScope }>(
      `/api/order-profitability?${periodQuery}`,
      (v) => { next.profitability = v.lines; next.profitabilityScope = v.scope; setProfitability(v.lines); setProfitabilityScope(v.scope); store(); },
      (d) => d as { lines: ProfitabilityLine[]; scope?: ProfitabilityScope },
      "rentabilidade"
    ).finally(() => active && setProfitabilityLoading(false));

    return () => {
      active = false;
    };
  }, [periodQuery]);

  const currency = profit?.finance.currency || orders?.metrics.currency || "BRL";
  const critical = radar.filter((r) => r.status === "critical" || r.status === "out");
  const noCost = products.filter((p) => p.cost == null || p.cost === 0).length;
  // Faturamento/vendas/unidades pela Sales API (data do pedido) = Seller Central.
  const revenue = sales?.totalRevenue ?? orders?.metrics.totalRevenue ?? 0;
  const salesCount = sales?.totalOrders ?? orders?.metrics.totalOrders ?? 0;
  const unitsCount = sales?.totalUnits ?? 0;
  const estProfit = profit?.estimatedProfit ?? 0;
  const cogs = profit?.cogs ?? 0;
  const missingCostUnits = profit?.unitsWithoutCost ?? 0;
  const costsIncomplete = missingCostUnits > 0;
  const marginPct = revenue > 0 ? (estProfit / revenue) * 100 : 0;
  const ticketMedio = salesCount > 0 ? revenue / salesCount : 0;
  const roiPct = cogs > 0 ? (estProfit / cogs) * 100 : 0;
  const revenueTrend = getRevenueTrend(sales?.points ?? []);

  return (
    <div className="dashboard-page space-y-8">
      <PageHeader
        eyebrow="Operação Amazon"
        title="Dashboard Amazon"
        subtitle="Resumo de vendas, lucro, FBA e desempenho da conta Amazon ativa."
        icon={pageIcons.dashboard}
      />
      <DashboardPeriodFilter {...period.filterProps} />

      {updatedAt && (
        <p className="-mt-5 text-xs text-slate-400">
          Atualizado às {brTime(updatedAt)}. Dados de vendas, pedidos e financeiro sincronizados.
        </p>
      )}

      <AmazonPending products={products.length} productsLoading={productsLoading} missingCosts={noCost} />

      <div className="dashboard-sections space-y-8">
      {/* KPIs principais */}
      <div className="metric-grid grid grid-cols-1 gap-0 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Faturamento" value={<AnimatedNumber id="amz-revenue" value={revenue} format={(amount) => money(amount, currency)} />} sub={`${salesCount} vendas no período`} loading={loading} trend={revenueTrend} />
        <div className="metric-cell metric-primary relative overflow-hidden p-5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">{costsIncomplete ? "Repasse líquido" : "Lucro conciliado"}</p>
          <p className="mt-2 text-[27px] font-bold leading-none tabular-nums text-emerald-800">
            {loading ? "···" : <AnimatedNumber id="amz-profit" value={estProfit} format={(amount) => money(amount, currency)} />}
          </p>
          {costsIncomplete
            ? <p className="mt-1.5 text-xs font-medium text-amber-700">antes do custo dos produtos — cadastre custos para o lucro real</p>
            : <p className="mt-2 flex items-baseline gap-1.5"><span className="text-[17px] font-extrabold tabular-nums text-emerald-600">{marginPct.toFixed(1)}%</span><span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700/70">margem sobre vendas</span></p>}
        </div>
        <Kpi
          label="Estoque crítico"
          value={loading ? "…" : String(critical.length)}
          sub={critical.length > 0 ? "repor com urgência" : "tudo sob controle"}
          tone={critical.length > 0 ? "danger" : "ok"}
          loading={loading}
          icon={kpiIcons.stock}
        />
        <Kpi
          label="Produtos sem custo"
          value={productsLoading ? "…" : String(noCost)}
          sub={noCost > 0 ? "cadastre para ver o lucro" : "todos cadastrados"}
          tone={noCost > 0 ? "warn" : "ok"}
          loading={productsLoading}
          icon={kpiIcons.box}
        />
      </div>

      {/* Indicadores de contexto: uma faixa, não uma segunda parede de cartões. */}
      <div className="secondary-metrics" aria-label="Indicadores complementares">
        <CompactMetric label="Vendas" value={String(salesCount)} loading={loading} />
        <CompactMetric label="Unidades" value={String(unitsCount)} loading={loading} />
        <CompactMetric label="Ticket médio" value={money(ticketMedio, currency)} loading={loading} />
        <CompactMetric label="ROI" value={cogs > 0 ? `${roiPct.toFixed(1)}%` : "—"} loading={loading} />
      </div>

      {brokenConnection && <ConnectionBroken channel="amazon" message={brokenConnection} />}

      {errors.length > 0 && (
        <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
          Não foi possível carregar: {errors.join(", ")}.
        </div>
      )}

      {/* Uma única superfície explica desempenho e composição financeira. */}
      <section className="performance-panel">
        <div className="performance-chart">
          <div className="mb-2 flex items-baseline justify-between gap-4">
            <div>
              <p className="section-kicker">Desempenho diário</p>
              <h2 className="mt-1 text-lg font-semibold text-slate-900">Evolução do faturamento</h2>
            </div>
            <span className="text-sm font-semibold tabular-nums text-slate-900">
              {money(revenue, currency)}{" "}
              <span className="font-normal text-slate-400">no período</span>
            </span>
          </div>
          {loading ? (
            <span className="skeleton-chart" role="status" aria-label="Carregando evolução do faturamento" />
          ) : (
            <RevenueChart points={sales?.points ?? []} />
          )}
        </div>

        <aside className="financial-composition" aria-label="Financeiro conciliado do período">
          <div>
            <p className="section-kicker">Financeiro conciliado</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-900">Repasses, taxas e {costsIncomplete ? "resultado" : "lucro"}</h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">Base dos repasses da Amazon (data de postagem) — difere do faturamento acima, que segue a data do pedido como o Seller Central.</p>
          </div>
          <div className="financial-lines">
            <Flow label="Receita conciliada" value={loading ? "…" : money(profit?.finance.revenue ?? 0, currency)} />
            <Flow label="Taxas Amazon" value={loading ? "…" : money(profit?.finance.fees ?? 0, currency)} muted sign="−" />
            <Flow label="Custo dos produtos" value={loading ? "…" : money(profit?.cogs ?? 0, currency)} muted sign="−" />
            <Flow label={costsIncomplete ? "Repasse líquido" : "Lucro estimado"} value={loading ? "…" : money(profit?.estimatedProfit ?? 0, currency)} accent sign="=" />
          </div>
        </aside>
      </section>

      {/* Duas colunas: alertas de estoque + pedidos recentes */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <Panel title="Estoque crítico" href="/amazon/estoque" linkLabel="Ver radar">
          {loading ? (
            <InlineLoading label="Carregando estoque crítico" />
          ) : critical.length === 0 ? (
            <Empty>Nenhum SKU em ruptura iminente.</Empty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {critical.slice(0, 6).map((r) => (
                <li key={r.sellerSku} className="flex items-center justify-between py-2.5 text-sm">
                  <span className="min-w-0 truncate pr-3">{r.productName || r.sellerSku}</span>
                  <span className="shrink-0 font-semibold text-red-600">
                    {r.status === "out" ? "esgotado" : `${r.daysRemaining} dias`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Pedidos recentes" href="/amazon/monitor" linkLabel="Ver monitor">
          {loading ? (
            <InlineLoading label="Carregando pedidos recentes" />
          ) : !orders || orders.orders.length === 0 ? (
            <Empty>Nenhum pedido no período.</Empty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {orders.orders.slice(0, 6).map((o) => (
                <li key={o.amazonOrderId} className="flex items-center justify-between py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-xs text-slate-500">
                      {o.amazonOrderId}
                    </span>
                    <span className="text-xs text-slate-400">
                      {brDate(o.purchaseDate)} · {o.orderStatus}
                    </span>
                  </span>
                  <span className="shrink-0 font-medium tabular-nums">
                    {o.orderTotal
                      ? money(parseFloat(o.orderTotal.Amount), o.orderTotal.CurrencyCode)
                      : "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* Rentabilidade por venda — a mesma visão do monitor, direto no dashboard. */}
      <OrderProfitabilityTable lines={profitability} loading={profitabilityLoading} scopeNote={scopeSentence(profitabilityScope)} />

      {/* Top produtos */}
      <div className="work-panel border-t border-slate-300 py-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Top produtos
          </h2>
          <Link href="/produtos" className="text-xs font-medium text-blue-600 hover:underline">
            Ver produtos →
          </Link>
        </div>
        {productsLoading ? (
          <InlineLoading label="Carregando produtos com melhor desempenho" />
        ) : top.length === 0 ? (
          <Empty>Sem vendas no período para ranquear.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <caption className="sr-only">Produtos com melhor desempenho no período</caption>
              <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th scope="col" className="pb-2 pr-3 font-medium">#</th>
                  <th scope="col" className="pb-2 pr-3 font-medium">Produto</th>
                  <th scope="col" className="pb-2 px-3 text-right font-medium">Un</th>
                  <th scope="col" className="pb-2 px-3 text-right font-medium">Faturamento</th>
                  <th scope="col" className="pb-2 pl-3 text-right font-medium">Margem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {top.map((p, i) => (
                  <tr key={p.sku}>
                    <td className="py-2.5 pr-3 tabular-nums text-slate-400">{i + 1}</td>
                    <td className="py-2.5 pr-3">
                      <span className="block max-w-[260px] truncate font-medium">
                        {p.title || p.sku}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-slate-600">{p.units}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums font-medium">
                      {money(p.revenue, currency)}
                    </td>
                    <td className="py-2.5 pl-3 text-right">
                      <MarginBadge pct={p.marginPct} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-slate-400">
              Margem de contribuição = (preço de venda − custo) ÷ preço. Cadastre custos em
              Produtos para ver a margem.
            </p>
          </div>
        )}
      </div>

      {/* Atalhos: no desktop a sidebar já cobre; no mobile os cartões ajudam. */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:hidden">
        <QuickLink href="/amazon/calculadora" label="Calculadora" desc="Lucro por ASIN" />
        <QuickLink href="/amazon/monitor" label="Monitor" desc="Vendas e financeiro" />
        <QuickLink href="/amazon/estoque" label="Radar" desc="Estoque × velocidade" />
        <QuickLink href="/amazon/produtos" label="Produtos" desc="Custos por SKU" />
      </div>
      </div>
    </div>
  );
}


const kpiIconProps = { className: "h-5 w-5", strokeWidth: 1.7, "aria-hidden": true } as const;
const kpiIcons = {
  revenue: <ChartSpline {...kpiIconProps} />,
  stock: <Boxes {...kpiIconProps} />,
  tag: <Tag {...kpiIconProps} />,
  cart: <ShoppingCart {...kpiIconProps} />,
  box: <PackageOpen {...kpiIconProps} />,
  percent: <Percent {...kpiIconProps} />,
};

function CompactMetric({ label, value, loading }: { label: string; value: string; loading?: boolean }) {
  return (
    <div className="compact-metric">
      <p>{label}</p>
      <strong>{loading ? "···" : value}</strong>
    </div>
  );
}

function Flow({
  label,
  value,
  muted,
  accent,
  sign,
}: {
  label: string;
  value: string;
  muted?: boolean;
  accent?: boolean;
  sign?: "−" | "=";
}) {
  return (
    <div className={`financial-line ${accent ? "is-result" : ""}`}>
      <span className="financial-sign" aria-hidden="true">{sign}</span>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p
        className={`text-sm font-bold tabular-nums ${
          accent ? "text-emerald-700" : muted ? "text-red-600" : "text-slate-900"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function Panel({
  title,
  href,
  linkLabel,
  children,
}: {
  title: string;
  href: string;
  linkLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="work-panel border-t border-slate-300 py-5">
      <div className="mb-3 flex items-center justify-between border-b border-slate-100 pb-3">
        <h2 className="text-[13px] font-semibold text-slate-700">{title}</h2>
        <Link
          href={href}
          className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:gap-1.5 hover:text-blue-700"
        >
          {linkLabel}
          <span aria-hidden>→</span>
        </Link>
      </div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <EmptyState compact title={String(children)} />;
}

function MarginBadge({ pct }: { pct: number | null }) {
  if (pct == null) {
    return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-400">—</span>;
  }
  const cls =
    pct >= 18
      ? "bg-emerald-100 text-emerald-700"
      : pct >= 12
        ? "bg-amber-100 text-amber-700"
        : "bg-red-100 text-red-700";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${cls}`}>
      {pct.toFixed(1)}%
    </span>
  );
}

function QuickLink({ href, label, desc }: { href: string; label: string; desc: string }) {
  return (
    <Link
      href={href}
      className="quick-command group flex items-center justify-between border-t border-slate-300 py-4"
    >
      <div>
        <p className="text-sm font-semibold text-slate-900">{label}</p>
        <p className="text-xs text-slate-400">{desc}</p>
      </div>
      <span className="text-slate-300 transition-[transform,color] group-hover:translate-x-0.5 group-hover:text-blue-500">
        →
      </span>
    </Link>
  );
}

function AmazonPending({ products, productsLoading, missingCosts }: { products: number; productsLoading: boolean; missingCosts: number }) {
  const [connection, setConnection] = useState<"loading" | "connected" | "missing">("loading");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetch("/api/auth/accounts")
        .then((res) => readJson(res).then((data) => ({ ok: res.ok, data })))
        .then(({ ok, data }) => setConnection(ok && (data.hasOwnerToken || data.accounts?.length > 0) ? "connected" : "missing"))
        .catch(() => setConnection("missing"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  if (connection === "loading") return null;

  const items: OperationPendingItem[] = [];
  if (connection === "missing") items.push({ label: "Conectar a conta Amazon", href: "/integracoes" });
  if (connection === "connected" && !productsLoading && products === 0) items.push({ label: "Sincronizar os produtos da Amazon", href: "/amazon/produtos" });
  if (products > 0 && missingCosts > 0) items.push({ label: `Cadastrar custo de ${missingCosts} produto(s)`, href: "/amazon/produtos" });

  return <OperationPending items={items} />;
}
