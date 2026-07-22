"use client";

import { useEffect, useState } from "react";
import { PageHeader, pageIcons } from "../components/PageHeader";
import { PanelLoading } from "../components/LoadingState";
import { OrderProfitabilityTable } from "../components/OrderProfitabilityTable";
import { DashboardPeriodFilter, useDashboardPeriod } from "../components/DashboardPeriodFilter";
import type { ProfitabilityLine } from "@/lib/profitability";
import { readJson } from "@/lib/readJson";

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

      {metrics && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Pedidos" value={String(metrics.totalOrders)} />
          <Stat label="Faturamento" value={money(metrics.totalRevenue, metrics.currency)} />
          <Stat label="FBA nos recentes" value={String(metrics.fbaOrders)} />
          <Stat label="Itens a enviar nos recentes" value={String(metrics.pendingItems)} />
        </div>
      )}

      {/* Financeiro realizado */}
      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Financeiro realizado</h2>
          <span className="text-xs text-slate-400">repasses efetivos · dados conciliados</span>
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
          <PanelLoading label="Carregando resumo financeiro" />
        )}
      </div>

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
                          {new Date(transaction.postedDate).toLocaleDateString("pt-BR")}
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
