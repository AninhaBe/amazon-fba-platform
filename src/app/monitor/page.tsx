"use client";

import { useEffect, useState } from "react";
import { PageHeader, pageIcons } from "../components/PageHeader";

interface OrderSummary {
  amazonOrderId: string;
  purchaseDate: string;
  orderStatus: string;
  fulfillmentChannel?: string;
  numberOfItemsUnshipped?: number;
  orderTotal?: { CurrencyCode: string; Amount: string };
}

interface Metrics {
  totalOrders: number;
  totalRevenue: number;
  currency: string;
  fbaOrders: number;
  pendingItems: number;
}

interface FinanceSummary {
  currency: string;
  revenue: number;
  fees: number;
  promotions: number;
  refunds: number;
  netProceeds: number;
  orderCount: number;
  feeBreakdown: { type: string; amount: number }[];
}

interface ProfitSummary {
  finance: FinanceSummary;
  cogs: number;
  estimatedProfit: number;
  unitsWithCost: number;
  unitsWithoutCost: number;
  skusMissingCost: string[];
}

const FEE_LABELS: Record<string, string> = {
  Commission: "Comissão",
  FBAPerUnitFulfillmentFee: "FBA — coleta/embalagem",
  FBAWeightBasedFee: "FBA — por peso",
  ShippingChargeback: "Estorno de frete",
  RefundCommission: "Comissão de reembolso",
  VariableClosingFee: "Fechamento variável",
  FixedClosingFee: "Fechamento fixo",
};

function money(v: number, currency: string) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(v);
}

const STATUS_COLOR: Record<string, string> = {
  Shipped: "bg-emerald-100 text-emerald-700",
  Pending: "bg-amber-100 text-amber-700",
  Unshipped: "bg-blue-100 text-blue-700",
  Canceled: "bg-red-100 text-red-700",
};

export default function MonitorPage() {
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [finance, setFinance] = useState<FinanceSummary | null>(null);
  const [profit, setProfit] = useState<ProfitSummary | null>(null);
  const [financeError, setFinanceError] = useState<string | null>(null);
  const [orderQuery, setOrderQuery] = useState("");
  const [orderStatus, setOrderStatus] = useState("all");

  async function load(d: number) {
    setLoading(true);
    setError(null);
    setFinanceError(null);
    // Pedidos e lucro (financeiro + custos) em paralelo; um não derruba o outro.
    const ordersReq = fetch(`/api/orders?days=${d}`)
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error || "Erro ao carregar pedidos.");
        setMetrics(data.metrics);
        setOrders(data.orders);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Erro desconhecido."));

    const profitReq = fetch(`/api/profit?days=${d}`)
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error || "Erro ao carregar financeiro.");
        setProfit(data.summary);
        setFinance(data.summary.finance);
      })
      .catch((err) =>
        setFinanceError(err instanceof Error ? err.message : "Erro desconhecido.")
      );

    await Promise.all([ordersReq, profitReq]);
    setLoading(false);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(days), 0);
    return () => window.clearTimeout(timer);
  }, [days]);

  const visibleOrders = orders.filter((order) =>
    order.amazonOrderId.toLowerCase().includes(orderQuery.toLowerCase()) &&
    (orderStatus === "all" || order.orderStatus === orderStatus)
  );

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Orders · Finances"
        title="Monitor da conta"
        subtitle="Pedidos recentes e o repasse financeiro real da sua conta."
        icon={pageIcons.chart}
        action={
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="cursor-pointer rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-sm ring-1 ring-slate-900/[0.02] hover:border-slate-300"
          >
            <option value={7}>Últimos 7 dias</option>
            <option value={30}>Últimos 30 dias</option>
            <option value={90}>Últimos 90 dias</option>
          </select>
        }
      />

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {metrics && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Pedidos" value={String(metrics.totalOrders)} />
          <Stat label="Faturamento" value={money(metrics.totalRevenue, metrics.currency)} />
          <Stat label="Pedidos FBA" value={String(metrics.fbaOrders)} />
          <Stat label="Itens a enviar" value={String(metrics.pendingItems)} />
        </div>
      )}

      {/* Financeiro realizado (Finances API) */}
      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Financeiro realizado</h2>
          <span className="text-xs text-slate-400">repasses efetivos · Finances API</span>
        </div>

        {financeError ? (
          <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
            {financeError}
          </div>
        ) : finance && finance.orderCount === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
            Nenhum evento financeiro no período. Assim que houver vendas, os repasses reais
            (receita, taxas efetivas e reembolsos) aparecem aqui — para comparar com o previsto
            da calculadora.
          </div>
        ) : finance ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="grid grid-cols-2 gap-4 lg:col-span-2">
              <Stat label="Receita (vendas)" value={money(finance.revenue, finance.currency)} />
              <Stat
                label="Taxas efetivas"
                value={`- ${money(finance.fees, finance.currency)}`}
              />
              <Stat
                label="Custo produtos"
                value={`- ${money(profit?.cogs ?? 0, finance.currency)}`}
              />
              <Stat
                label="Reembolsos"
                value={`- ${money(finance.refunds, finance.currency)}`}
              />
            </div>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col justify-center rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  Repasse líquido (Amazon)
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
                  {money(finance.netProceeds, finance.currency)}
                </p>
              </div>
              <div className="flex flex-col justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 p-4 shadow-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-white/80">
                  Lucro estimado
                </p>
                <p className="mt-1 text-3xl font-bold tabular-nums text-white">
                  {money(profit?.estimatedProfit ?? finance.netProceeds, finance.currency)}
                </p>
                <p className="mt-0.5 text-xs text-white/70">repasse − custo dos produtos</p>
              </div>
            </div>

            {profit && profit.unitsWithoutCost > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 lg:col-span-3">
                ⚠ {profit.unitsWithoutCost} unidade(s) vendida(s) sem custo cadastrado — o lucro
                está superestimado.{" "}
                <a href="/produtos" className="font-semibold underline">
                  Cadastrar custos em Produtos
                </a>
              </div>
            )}

            {finance.feeBreakdown.length > 0 && (
              <div className="rounded-2xl border border-slate-200/70 bg-white shadow-sm ring-1 ring-slate-900/[0.02] p-4 lg:col-span-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Detalhamento das taxas efetivas
                </p>
                <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {finance.feeBreakdown.map((f) => (
                    <li key={f.type} className="flex justify-between text-sm">
                      <span className="text-slate-600">{FEE_LABELS[f.type] || f.type}</span>
                      <span className="font-medium">- {money(f.amount, finance.currency)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-400">
            Carregando…
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Pedidos</h2>
        <div className="flex flex-1 flex-wrap justify-end gap-2">
          <label className="min-w-48 sm:max-w-xs sm:flex-1">
            <span className="sr-only">Buscar pedido</span>
            <input value={orderQuery} onChange={(e) => setOrderQuery(e.target.value)} placeholder="Buscar número do pedido" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
          </label>
          <select value={orderStatus} onChange={(e) => setOrderStatus(e.target.value)} aria-label="Filtrar status do pedido" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
            <option value="all">Todos os status</option>
            {[...new Set(orders.map((order) => order.orderStatus))].map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200/70 bg-white shadow-sm ring-1 ring-slate-900/[0.02]">
        <table className="w-full min-w-[680px] text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Pedido</th>
              <th className="px-4 py-3">Data</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Canal</th>
              <th className="px-4 py-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  Carregando…
                </td>
              </tr>
            ) : orders.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  Nenhum pedido no período.
                </td>
              </tr>
            ) : visibleOrders.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">Nenhum pedido corresponde aos filtros.</td></tr>
            ) : (
              visibleOrders.map((o) => (
                <tr key={o.amazonOrderId} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs">{o.amazonOrderId}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {new Date(o.purchaseDate).toLocaleDateString("pt-BR")}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        STATUS_COLOR[o.orderStatus] || "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {o.orderStatus}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {o.fulfillmentChannel === "AFN" ? "FBA" : "Próprio"}
                  </td>
                  <td className="px-4 py-3 text-right font-medium">
                    {o.orderTotal
                      ? money(parseFloat(o.orderTotal.Amount), o.orderTotal.CurrencyCode)
                      : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums text-slate-900">{value}</p>
    </div>
  );
}
