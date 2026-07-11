"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { RevenueChart, type DailyPoint } from "./components/RevenueChart";
import { PageHeader, pageIcons } from "./components/PageHeader";

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
  finance: { revenue: number; fees: number; netProceeds: number; currency: string; orderCount: number };
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

export default function Dashboard() {
  const [days, setDays] = useState(30);
  const [custom, setCustom] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<OrdersData | null>(null);
  const [profit, setProfit] = useState<ProfitData | null>(null);
  const [radar, setRadar] = useState<RadarRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [sales, setSales] = useState<SalesSeries | null>(null);
  const [top, setTop] = useState<TopProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);

  // Query de período: preset (days) ou personalizado (from/to). null = aguardar datas.
  const periodQuery = custom ? (from && to ? `from=${from}&to=${to}` : null) : `days=${days}`;

  useEffect(() => {
    if (!periodQuery) return; // personalizado sem as duas datas ainda
    let active = true;
    setLoading(true);
    const errs: string[] = [];
    const safe = <T,>(url: string, set: (v: T) => void, pick: (d: unknown) => T, name: string) =>
      fetch(url)
        .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
        .then(({ ok, d }) => {
          if (!ok) throw new Error((d as { error?: string })?.error || name);
          if (active) set(pick(d));
        })
        .catch(() => errs.push(name));

    // Chamadas rápidas — controlam o "loading" do dashboard.
    Promise.all([
      safe<OrdersData>(`/api/orders?${periodQuery}`, setOrders, (d) => d as OrdersData, "pedidos"),
      safe<ProfitData>(`/api/profit?${periodQuery}`, setProfit, (d) => (d as { summary: ProfitData }).summary, "financeiro"),
      safe<RadarRow[]>(`/api/radar?${periodQuery}`, setRadar, (d) => (d as { rows: RadarRow[] }).rows, "estoque"),
      safe<SalesSeries>(`/api/sales?${periodQuery}`, setSales, (d) => (d as { series: SalesSeries }).series, "vendas"),
    ]).then(() => {
      if (active) {
        setErrors(errs);
        setLoading(false);
      }
    });

    // Produtos e top produtos usam o relatório da Amazon (lento) — carregam em separado.
    setProductsLoading(true);
    safe<ProductRow[]>(`/api/products`, setProducts, (d) => (d as { products: ProductRow[] }).products, "produtos").finally(
      () => active && setProductsLoading(false)
    );
    safe<TopProduct[]>(`/api/top-products?${periodQuery}`, setTop, (d) => (d as { products: TopProduct[] }).products, "top produtos");

    return () => {
      active = false;
    };
  }, [periodQuery]);

  const currency = profit?.finance.currency || orders?.metrics.currency || "BRL";
  const critical = radar.filter((r) => r.status === "critical" || r.status === "out");
  const noCost = products.filter((p) => p.cost == null || p.cost === 0).length;
  // Faturamento/pedidos vêm da Sales API (mais preciso no período); cai pros pedidos se faltar.
  const revenue = sales?.totalRevenue ?? orders?.metrics.totalRevenue ?? 0;
  const salesCount = sales?.totalOrders ?? orders?.metrics.totalOrders ?? 0;
  const unitsCount = sales?.totalUnits ?? 0;
  const estProfit = profit?.estimatedProfit ?? 0;
  const cogs = profit?.cogs ?? 0;
  const marginPct = revenue > 0 ? (estProfit / revenue) * 100 : 0;
  const ticketMedio = salesCount > 0 ? revenue / salesCount : 0;
  const roiPct = cogs > 0 ? (estProfit / cogs) * 100 : 0;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Visão geral"
        title="Dashboard"
        subtitle="Resumo de vendas, lucro e estoque da sua conta Amazon."
        icon={pageIcons.dashboard}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={custom ? "custom" : String(days)}
              onChange={(e) => {
                if (e.target.value === "custom") {
                  setCustom(true);
                } else {
                  setCustom(false);
                  setDays(Number(e.target.value));
                }
              }}
              className="cursor-pointer rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-slate-900/[0.02] hover:border-slate-300"
            >
              <option value={7}>Últimos 7 dias</option>
              <option value={30}>Últimos 30 dias</option>
              <option value={90}>Últimos 90 dias</option>
              <option value="custom">Personalizado…</option>
            </select>
            {custom && (
              <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-sm shadow-sm ring-1 ring-slate-900/[0.02]">
                <input
                  type="date"
                  value={from}
                  max={to || undefined}
                  onChange={(e) => setFrom(e.target.value)}
                  className="bg-transparent text-slate-700 focus:outline-none"
                />
                <span className="text-slate-400">até</span>
                <input
                  type="date"
                  value={to}
                  min={from || undefined}
                  onChange={(e) => setTo(e.target.value)}
                  className="bg-transparent text-slate-700 focus:outline-none"
                />
              </div>
            )}
          </div>
        }
      />
      {custom && !periodQuery && (
        <p className="-mt-4 text-xs text-slate-400">Escolha a data inicial e final para filtrar.</p>
      )}

      {/* KPIs principais */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Faturamento" value={money(revenue, currency)} sub={`${orders?.metrics.totalOrders ?? 0} pedidos`} loading={loading} icon={kpiIcons.revenue} />
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 p-5 shadow-sm shadow-emerald-600/20 ring-1 ring-emerald-600/20">
          <div className="pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full bg-white/10 blur-xl" />
          <div className="flex items-start justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-white/85">Lucro estimado</p>
            <span className="text-white/50">{kpiIcons.percent}</span>
          </div>
          <p className="mt-2 text-[27px] font-bold leading-none tabular-nums text-white">
            {loading ? "···" : money(estProfit, currency)}
          </p>
          <p className="mt-1.5 text-xs font-medium text-white/80">margem {marginPct.toFixed(1)}%</p>
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

      {/* Segunda fileira de KPIs */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Kpi label="Número de vendas" value={String(salesCount)} sub="pedidos no período" loading={loading} icon={kpiIcons.cart} />
        <Kpi label="Unidades vendidas" value={String(unitsCount)} loading={loading} icon={kpiIcons.box} />
        <Kpi label="Ticket médio" value={money(ticketMedio, currency)} sub="faturamento ÷ vendas" loading={loading} icon={kpiIcons.tag} />
        <Kpi
          label="ROI"
          value={cogs > 0 ? `${roiPct.toFixed(1)}%` : "—"}
          sub="lucro ÷ custo dos produtos"
          tone={roiPct > 0 ? "ok" : "default"}
          loading={loading}
          icon={kpiIcons.percent}
        />
      </div>

      {errors.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
          Não foi possível carregar: {errors.join(", ")}.
        </div>
      )}

      {/* Resumo de Receitas — gráfico de faturamento */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Resumo de receitas
          </h2>
          <span className="text-sm font-semibold tabular-nums text-slate-900">
            {money(sales?.totalRevenue ?? 0, currency)}{" "}
            <span className="font-normal text-slate-400">no período</span>
          </span>
        </div>
        {loading ? (
          <div className="flex h-56 items-center justify-center text-sm text-slate-400">
            Carregando…
          </div>
        ) : (
          <RevenueChart points={sales?.points ?? []} />
        )}
      </div>

      {/* Fluxo receita → lucro */}
      {profit && (
        <div className="grid grid-cols-1 gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:grid-cols-4">
          <Flow label="Receita real" value={money(profit.finance.revenue, currency)} />
          <Flow label="− Taxas Amazon" value={money(profit.finance.fees, currency)} muted />
          <Flow label="− Custo produtos" value={money(profit.cogs, currency)} muted />
          <Flow label="= Lucro estimado" value={money(profit.estimatedProfit, currency)} accent />
        </div>
      )}

      {/* Duas colunas: alertas de estoque + pedidos recentes */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="Estoque crítico" href="/estoque" linkLabel="Ver radar">
          {loading ? (
            <Empty>Carregando…</Empty>
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

        <Panel title="Pedidos recentes" href="/monitor" linkLabel="Ver monitor">
          {loading ? (
            <Empty>Carregando…</Empty>
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
                      {new Date(o.purchaseDate).toLocaleDateString("pt-BR")} · {o.orderStatus}
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

      {/* Top produtos */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Top produtos
          </h2>
          <Link href="/produtos" className="text-xs font-medium text-blue-600 hover:underline">
            Ver produtos →
          </Link>
        </div>
        {productsLoading ? (
          <Empty>Carregando…</Empty>
        ) : top.length === 0 ? (
          <Empty>Sem vendas no período para ranquear.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="pb-2 pr-3 font-medium">#</th>
                  <th className="pb-2 pr-3 font-medium">Produto</th>
                  <th className="pb-2 px-3 text-right font-medium">Un</th>
                  <th className="pb-2 px-3 text-right font-medium">Faturamento</th>
                  <th className="pb-2 pl-3 text-right font-medium">Margem</th>
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

      {/* Atalhos */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <QuickLink href="/calculadora" label="Calculadora" desc="Lucro por ASIN" />
        <QuickLink href="/monitor" label="Monitor" desc="Vendas e financeiro" />
        <QuickLink href="/estoque" label="Radar" desc="Estoque × velocidade" />
        <QuickLink href="/produtos" label="Produtos" desc="Custos por SKU" />
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  tone = "default",
  loading,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "ok" | "warn" | "danger";
  loading?: boolean;
  icon?: React.ReactNode;
}) {
  const toneCls =
    tone === "danger"
      ? "text-red-600"
      : tone === "warn"
        ? "text-amber-600"
        : tone === "ok"
          ? "text-emerald-600"
          : "text-slate-900";
  return (
    <div className="group rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm ring-1 ring-slate-900/[0.02] transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
        {icon && (
          <span className="text-slate-300 transition-colors group-hover:text-blue-400">{icon}</span>
        )}
      </div>
      <p className={`mt-2 text-[27px] font-bold leading-none tabular-nums ${toneCls}`}>
        {loading ? <span className="text-slate-300">···</span> : value}
      </p>
      {sub && <p className="mt-1.5 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

const kpiIcons = {
  revenue: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-5 w-5">
      <path d="M4 19V5M4 19h16M8 15l3-4 3 2 4-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  stock: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-5 w-5">
      <path d="M20 7 12 3 4 7v10l8 4 8-4V7Z" strokeLinejoin="round" />
      <path d="m4 7 8 4 8-4M12 11v10" strokeLinejoin="round" />
    </svg>
  ),
  tag: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-5 w-5">
      <path d="M20.6 13.4 12 22l-9-9V4h9l8.6 8.6a1.4 1.4 0 0 1 0 2Z" strokeLinejoin="round" />
      <circle cx="7.5" cy="7.5" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  ),
  cart: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-5 w-5">
      <path d="M3 4h2l2.4 12.4A2 2 0 0 0 9.4 18h8.5a2 2 0 0 0 2-1.6L21 8H6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="10" cy="21" r="1" /><circle cx="18" cy="21" r="1" />
    </svg>
  ),
  box: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-5 w-5">
      <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M9 4v5" strokeLinecap="round" />
    </svg>
  ),
  percent: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-5 w-5">
      <path d="M19 5 5 19" strokeLinecap="round" /><circle cx="7.5" cy="7.5" r="2.2" /><circle cx="16.5" cy="16.5" r="2.2" />
    </svg>
  ),
};

function Flow({ label, value, muted, accent }: { label: string; value: string; muted?: boolean; accent?: boolean }) {
  return (
    <div className={accent ? "rounded-xl bg-emerald-50 p-3" : ""}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p
        className={`mt-1 text-lg font-bold tabular-nums ${
          accent ? "text-emerald-700" : muted ? "text-slate-500" : "text-slate-900"
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
    <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm ring-1 ring-slate-900/[0.02]">
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
  return <p className="py-6 text-center text-sm text-slate-400">{children}</p>;
}

function MarginBadge({ pct }: { pct: number | null }) {
  if (pct == null) {
    return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-400">—</span>;
  }
  const cls =
    pct >= 25
      ? "bg-emerald-100 text-emerald-700"
      : pct >= 10
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
      className="group flex items-center justify-between rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.02] transition-all hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md"
    >
      <div>
        <p className="text-sm font-semibold text-slate-900">{label}</p>
        <p className="text-xs text-slate-400">{desc}</p>
      </div>
      <span className="text-slate-300 transition-all group-hover:translate-x-0.5 group-hover:text-blue-500">
        →
      </span>
    </Link>
  );
}
