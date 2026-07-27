"use client";

import { useEffect, useState } from "react";
import { PageHeader, pageIcons } from "../components/PageHeader";
import { PanelLoading } from "../components/LoadingState";
import { OrderProfitabilityTable } from "../components/OrderProfitabilityTable";
import { Flow, FlowExpandable, Metric } from "../components/Metric";
import { CustomizableMetricGrid } from "../components/CustomizableMetricGrid";
import { DashboardPeriodFilter, useDashboardPeriod } from "../components/DashboardPeriodFilter";
import type { ProfitabilityLine } from "@/lib/profitability";
import { readJson } from "@/lib/readJson";
import { brDate } from "@/lib/datetime";

interface Metrics {
  totalOrders: number;
  totalRevenue: number;
  currency: string;
  fbaOrders: number;
  pendingItems: number;
  recentOrderCount: number;
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

interface FinancialTransaction {
  id: string;
  type: string;
  status: string;
  description: string;
  postedDate: string;
  amount: number;
  currency: string;
  orderId?: string;
  sku?: string;
}

interface TransactionSummary {
  currency: string;
  releasedAmount: number;
  deferredAmount: number;
  releasedCount: number;
  deferredCount: number;
  transactionCount: number;
  recent: FinancialTransaction[];
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

function percent(v: number) {
  return `${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

export default function MonitorPage() {
  const period = useDashboardPeriod();
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [finance, setFinance] = useState<FinanceSummary | null>(null);
  const [profit, setProfit] = useState<ProfitSummary | null>(null);
  const [financeError, setFinanceError] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<TransactionSummary | null>(null);
  const [transactionsError, setTransactionsError] = useState<string | null>(null);
  const [profitabilityLines, setProfitabilityLines] = useState<ProfitabilityLine[]>([]);
  const [profitabilityLoading, setProfitabilityLoading] = useState(true);
  const [profitabilityError, setProfitabilityError] = useState<string | null>(null);
  const [profitabilityScope, setProfitabilityScope] = useState<string | undefined>();
  const [feesOpen, setFeesOpen] = useState(false);

  async function load(periodQuery: string) {
    setError(null);
    setFinanceError(null);
    setTransactionsError(null);
    setProfitabilityLoading(true);
    setProfitabilityError(null);
    // Pedidos e lucro (financeiro + custos) em paralelo; um não derruba o outro.
    const ordersReq = fetch(`/api/orders?${periodQuery}`)
      .then((r) => readJson(r).then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error || "Erro ao carregar pedidos.");
        setMetrics(data.metrics);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Erro desconhecido."));

    const profitReq = fetch(`/api/profit?${periodQuery}`)
      .then((r) => readJson(r).then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error || "Erro ao carregar financeiro.");
        setProfit(data.summary);
        setFinance(data.summary.finance);
      })
      .catch((err) =>
        setFinanceError(err instanceof Error ? err.message : "Erro desconhecido.")
      );

    const transactionsReq = fetch(`/api/transactions?${periodQuery}`)
      .then((r) => readJson(r).then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error || "Erro ao carregar transações.");
        setTransactions(data.summary);
      })
      .catch((err) =>
        setTransactionsError(err instanceof Error ? err.message : "Erro desconhecido.")
      );

    const profitabilityReq = fetch(`/api/order-profitability?${periodQuery}`)
      .then((r) => readJson(r).then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error || "Não foi possível calcular as vendas.");
        setProfitabilityLines(data.lines);
        setProfitabilityScope(data.scope?.completePeriod ? undefined : `Exibindo os ${data.scope?.processedOrders ?? data.lines.length} pedidos mais recentes. Os totais financeiros acima consideram o período completo.`);
      })
      .catch((err) => setProfitabilityError(err instanceof Error ? err.message : "Erro desconhecido."))
      .finally(() => setProfitabilityLoading(false));

    await Promise.all([ordersReq, profitReq, transactionsReq, profitabilityReq]);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(period.query), 0);
    return () => window.clearTimeout(timer);
  }, [period.query]);

  return (
    <div className="monitor-page space-y-8">
      <PageHeader
        eyebrow="Pedidos e financeiro Amazon"
        title="Monitor da conta"
        subtitle="Pedidos recentes e o resultado financeiro real da sua conta."
        icon={pageIcons.chart}
      />

      <DashboardPeriodFilter {...period.filterProps} />

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p>{error}</p>
          <button type="button" onClick={() => void load(period.query)} className="mt-3 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white">
            Tentar novamente
          </button>
        </div>
      )}

      {financeError ? (
        <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
          {financeError}
        </div>
      ) : finance ? (
        (() => {
          const costsIncomplete = (profit?.unitsWithoutCost ?? 0) > 0;
          const estimatedProfit = profit?.estimatedProfit ?? finance.netProceeds;
          // Repasse líquido vem somado direto da Transactions API; o resíduo
          // (reembolsos de estoque, promoções, frete) fecha a cascata sem mentir.
          const otherAdjustments = Math.round((finance.netProceeds - (finance.revenue - finance.fees - finance.refunds)) * 100) / 100;
          const marginPct = finance.revenue > 0 ? (estimatedProfit / finance.revenue) * 100 : 0;
          return (
            <div className="dashboard-sections space-y-8">
              {finance.orderCount === 0 && (
                <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
                  Nenhum evento financeiro no período ainda — assim que houver vendas conciliadas, os valores abaixo se preenchem (receita, taxas efetivas e reembolsos).
                </div>
              )}
              <CustomizableMetricGrid
                viewKey="amazon-monitor"
                ariaLabel="Resumo financeiro Amazon"
                gridClassName="metric-grid grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5"
                widgets={[
                  {
                    id: "receita-conciliada",
                    label: "Receita conciliada",
                    node: <Metric label="Receita conciliada" value={money(finance.revenue, finance.currency)} sub={metrics ? `${metrics.totalOrders} pedido(s) no período` : "repasses da Amazon"} />,
                  },
                  {
                    id: "reembolsos",
                    label: "Reembolsos",
                    node: <Metric label="Reembolsos" value={money(finance.refunds, finance.currency)} sub="estornos ao comprador" tone={finance.refunds > 0 ? "danger" : "ok"} className="metric-cancelled" />,
                  },
                  {
                    id: "repasse-liquido",
                    label: "Repasse líquido",
                    node: <Metric label="Repasse líquido" value={money(finance.netProceeds, finance.currency)} sub="após taxas e reembolsos" />,
                  },
                  {
                    id: "lucro",
                    label: costsIncomplete ? "Repasse antes do custo" : "Lucro estimado",
                    node: <Metric label={costsIncomplete ? "Repasse antes do custo" : "Lucro estimado"} value={money(estimatedProfit, finance.currency)} sub={costsIncomplete ? "cadastre custos para o lucro real" : "repasse − custo dos produtos"} tone="positive" />,
                  },
                  {
                    id: "margem-pct",
                    label: "Margem %",
                    node: (
                      <article className="metric-cell metric-primary p-5">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">Margem %</p>
                        <p className="mt-2 text-[27px] font-bold leading-none tabular-nums text-emerald-800">{finance.revenue > 0 ? percent(marginPct) : "—"}</p>
                        <p className="mt-1.5 text-xs font-medium text-emerald-700/70">sobre a receita</p>
                      </article>
                    ),
                  },
                ]}
              />

              <section className="work-panel space-y-4" aria-labelledby="amz-financial-title">
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 pb-3">
                  <div>
                    <p className="section-kicker">Financeiro realizado</p>
                    <h2 id="amz-financial-title" className="mt-1 text-lg font-semibold text-slate-900">Do faturamento à margem</h2>
                  </div>
                  <span className="text-xs text-slate-400">repasses conciliados da Amazon</span>
                </div>
                <div className="financial-lines">
                  <Flow label="Receita de produtos" value={money(finance.revenue, finance.currency)} />
                  {finance.feeBreakdown.length > 0 ? (
                    <FlowExpandable
                      label="Taxas Amazon"
                      value={money(finance.fees, finance.currency)}
                      open={feesOpen}
                      onToggle={() => setFeesOpen((open) => !open)}
                      items={finance.feeBreakdown.map((f) => ({ label: FEE_LABELS[f.type] || f.type, value: money(f.amount, finance.currency) }))}
                    />
                  ) : (
                    <Flow label="Taxas Amazon" value={money(finance.fees, finance.currency)} sign="−" />
                  )}
                  <Flow label="Reembolsos" value={money(finance.refunds, finance.currency)} sign="−" />
                  {Math.abs(otherAdjustments) >= 0.005 && (
                    <Flow label="Outros ajustes (promoções, frete, estoque)" value={money(otherAdjustments, finance.currency)} />
                  )}
                  <Flow label="Repasse líquido" value={money(finance.netProceeds, finance.currency)} sign="=" />
                  <Flow label="Custo dos produtos" value={money(profit?.cogs ?? 0, finance.currency)} sign="−" />
                  <Flow label={costsIncomplete ? "Repasse antes do custo" : "Lucro estimado"} value={money(estimatedProfit, finance.currency)} sign="=" accent />
                </div>
                {costsIncomplete && (
                  <p className="text-xs leading-relaxed text-amber-700">
                    {profit?.unitsWithoutCost} unidade(s) vendida(s) sem custo cadastrado — o lucro está superestimado.{" "}
                    <a href="/produtos" className="font-semibold underline">Cadastrar custos em Produtos</a>
                  </p>
                )}
              </section>
            </div>
          );
        })()
      ) : (
        <PanelLoading label="Carregando resumo financeiro" />
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">Conciliação de transações</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Valores liberados e diferidos na movimentação financeira mais recente.
            </p>
          </div>
          <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
            Dados financeiros atualizados
          </span>
        </div>

        {transactionsError ? (
          <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            {transactionsError}
          </div>
        ) : transactions ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Stat label="Saldo liberado" value={money(transactions.releasedAmount, transactions.currency)} />
              <Stat label="Saldo diferido" value={money(transactions.deferredAmount, transactions.currency)} />
              <Stat label="Transações" value={String(transactions.transactionCount)} />
            </div>

            {transactions.recent.length > 0 && (
              <div className="overflow-x-auto rounded-2xl border border-slate-200/70 bg-white shadow-sm ring-1 ring-slate-900/[0.02]">
                <table className="w-full min-w-[720px] text-sm">
                  <caption className="sr-only">Transações financeiras recentes</caption>
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th scope="col" className="px-4 py-3">Data</th>
                      <th scope="col" className="px-4 py-3">Transação</th>
                      <th scope="col" className="px-4 py-3">Pedido / SKU</th>
                      <th scope="col" className="px-4 py-3">Status</th>
                      <th scope="col" className="px-4 py-3 text-right">Valor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {transactions.recent.map((transaction) => (
                      <tr key={transaction.id} className="hover:bg-slate-50">
                        <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                          {brDate(transaction.postedDate)}
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-800">{transaction.description}</p>
                          <p className="text-xs text-slate-400">{transaction.type}</p>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-600">
                          {transaction.orderId || transaction.sku || "—"}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            transaction.status === "RELEASED"
                              ? "bg-emerald-100 text-emerald-700"
                              : transaction.status === "DEFERRED"
                                ? "bg-amber-100 text-amber-700"
                                : "bg-slate-100 text-slate-600"
                          }`}>
                            {transaction.status === "RELEASED"
                              ? "Liberada"
                              : transaction.status === "DEFERRED"
                                ? "Diferida"
                                : transaction.status}
                          </span>
                        </td>
                        <td className={`px-4 py-3 text-right font-semibold tabular-nums ${
                          transaction.amount < 0 ? "text-red-600" : "text-emerald-700"
                        }`}>
                          {money(transaction.amount, transaction.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <PanelLoading label="Carregando transações" />
        )}
      </section>

      <OrderProfitabilityTable lines={profitabilityLines} loading={profitabilityLoading} error={profitabilityError} scopeNote={profitabilityScope} />
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
