"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { RevenueChart, type DailyPoint } from "./components/RevenueChart";

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
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<OrdersData | null>(null);
  const [profit, setProfit] = useState<ProfitData | null>(null);
  const [radar, setRadar] = useState<RadarRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [sales, setSales] = useState<SalesSeries | null>(null);
  const [top, setTop] = useState<TopProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
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
      safe<OrdersData>(`/api/orders?days=${days}`, setOrders, (d) => d as OrdersData, "pedidos"),
      safe<ProfitData>(`/api/profit?days=${days}`, setProfit, (d) => (d as { summary: ProfitData }).summary, "financeiro"),
      safe<RadarRow[]>(`/api/radar?days=${days}`, setRadar, (d) => (d as { rows: RadarRow[] }).rows, "estoque"),
      safe<SalesSeries>(`/api/sales?days=${days}`, setSales, (d) => (d as { series: SalesSeries }).series, "vendas"),
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
    safe<TopProduct[]>(`/api/top-products?days=${days}`, setTop, (d) => (d as { products: TopProduct[] }).products, "top produtos");

    return () => {
      active = false;
    };
  }, [days]);

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
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-orange-600">
            Visão geral
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="mt-2 text-sm text-slate-500">
            Resumo de vendas, lucro e estoque da sua conta Amazon.
          </p>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm"
        >
          <option value={7}>Últimos 7 dias</option>
          <option value={30}>Últimos 30 dias</option>
          <option value={90}>Últimos 90 dias</option>
        </select>
      </div>

      {/* KPIs principais */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Faturamento" value={money(revenue, currency)} sub={`${orders?.metrics.totalOrders ?? 0} pedidos`} loading={loading} />
        <div className="rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 p-5 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-white/80">Lucro estimado</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-white">
            {loading ? "…" : money(estProfit, currency)}
          </p>
          <p className="mt-0.5 text-xs text-white/70">margem {marginPct.toFixed(1)}%</p>
        </div>
        <Kpi
          label="Estoque crítico"
          value={loading ? "…" : String(critical.length)}
          sub={critical.length > 0 ? "repor com urgência" : "tudo sob controle"}
          tone={critical.length > 0 ? "danger" : "ok"}
          loading={loading}
        />
        <Kpi
          label="Produtos sem custo"
          value={productsLoading ? "…" : String(noCost)}
          sub={noCost > 0 ? "cadastre para ver o lucro" : "todos cadastrados"}
          tone={noCost > 0 ? "warn" : "ok"}
          loading={productsLoading}
        />
      </div>

      {/* Segunda fileira de KPIs */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Kpi label="Número de vendas" value={String(salesCount)} sub="pedidos no período" loading={loading} />
        <Kpi label="Unidades vendidas" value={String(unitsCount)} loading={loading} />
        <Kpi label="Ticket médio" value={money(ticketMedio, currency)} sub="faturamento ÷ vendas" loading={loading} />
        <Kpi
          label="ROI"
          value={cogs > 0 ? `${roiPct.toFixed(1)}%` : "—"}
          sub="lucro ÷ custo dos produtos"
          tone={roiPct > 0 ? "ok" : "default"}
          loading={loading}
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
          <Link href="/produtos" className="text-xs font-medium text-orange-600 hover:underline">
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
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "ok" | "warn" | "danger";
  loading?: boolean;
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
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${toneCls}`}>{loading ? "…" : value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

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
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
        <Link href={href} className="text-xs font-medium text-orange-600 hover:underline">
          {linkLabel} →
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
      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-orange-300 hover:bg-orange-50"
    >
      <p className="text-sm font-semibold text-slate-900">{label}</p>
      <p className="text-xs text-slate-400">{desc}</p>
    </Link>
  );
}
