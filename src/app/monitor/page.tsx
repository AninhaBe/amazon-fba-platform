"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { nomeDaTarifa } from "@/lib/nomeDaTarifa";
import { PageHeader, pageIcons } from "../components/PageHeader";
import { PanelLoading } from "../components/LoadingState";
import { OrderProfitabilityTable } from "../components/OrderProfitabilityTable";
import { Flow, FlowExpandable, Metric } from "../components/Metric";
import { CustomizableMetricGrid } from "../components/CustomizableMetricGrid";
import { DashboardPeriodFilter, useDashboardPeriod } from "../components/DashboardPeriodFilter";
import type { ProfitabilityLine } from "@/lib/profitability";
import { readJson } from "@/lib/readJson";
import { brDate } from "@/lib/datetime";
import { marginMetricTone } from "@/lib/marginTone";
import { BaseDeData } from "../components/BaseDeData";
import { EstadoDoSync } from "../components/EstadoDoSync";

interface FinanceSummary {
  currency: string;
  revenue: number;
  fees: number;
  promotions: number;
  refunds: number;
  netProceeds: number;
  orderCount: number;
  /** Faturamento do período pelo banco canônico — o MESMO que o dashboard exibe. */
  faturamentoPeriodo?: number | null;
  /** Parte dele que a Amazon ainda não valorizou. */
  aguardandoConfirmacao?: number;
  pedidosAguardando?: number;
  feeBreakdown: { type: string; amount: number }[];
}

interface ProfitSummary {
  finance: FinanceSummary;
  cogs: number;
  /**
   * Já com o gasto de anúncio dentro — fronteira em `src/lib/financialMath.ts`.
   * `null` = anúncio desconhecido; o MONITOR mostra "—", nunca o número sem ele.
   */
  estimatedProfit: number | null;
  adsDesconhecido?: boolean;
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


function money(v: number, currency: string) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(v);
}

function percent(v: number) {
  return `${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

interface MonitorSnapshot {
  finance: FinanceSummary | null;
  profit: ProfitSummary | null;
  transactions: TransactionSummary | null;
  profitabilityLines: ProfitabilityLine[];
  profitabilityScope?: string;
}

type MonitorSection = "composition" | "transactions" | "profitability";

/**
 * Aba inicial do monitor, vinda da URL (`?secao=vendas`).
 *
 * O card "Pedidos recentes" do dashboard linka para cá, e a aba padrão é a
 * Composição — uma cascata financeira. O link prometia pedidos e entregava um
 * resumo que o dashboard já mostrava ("tela super crua", 23/08/2026).
 *
 * ⚠️ A 1ª tentativa lia `window.location.search` dentro de `useState`, e NÃO
 * funcionava: `/monitor` é rota PRERENDERIZADA (`○ Static` no build), o
 * inicializador roda no servidor com `window` indefinido, e a hidratação reusa
 * o estado do servidor sem re-executá-lo. O parâmetro era ignorado em silêncio.
 *
 * `useSearchParams` é a API que a doc do Next indica para isto — e ela exige
 * fronteira de `Suspense`, que é por que a página é exportada embrulhada.
 */
function useSecaoInicial(): MonitorSection {
  const bruta = useSearchParams().get("secao");
  // A URL fala português; os ids internos são os do estado.
  const pedida = bruta === "vendas" ? "profitability" : bruta === "repasses" ? "transactions" : bruta;
  return pedida === "profitability" || pedida === "transactions" ? pedida : "composition";
}



// Escopo de módulo: sobrevive à navegação entre telas/canais (mesmo padrão do
// dashboard Amazon e do workspace ML). Ao voltar, o período já visto pinta no
// primeiro paint e a revalidação roda em segundo plano.
const monitorCache = new Map<string, MonitorSnapshot>();

function MonitorPage({ secaoInicial }: { secaoInicial: MonitorSection }) {
  const period = useDashboardPeriod();
  const [initialCached] = useState(() => monitorCache.get(period.query));
  const [finance, setFinance] = useState<FinanceSummary | null>(initialCached?.finance ?? null);
  const [profit, setProfit] = useState<ProfitSummary | null>(initialCached?.profit ?? null);
  const [financeError, setFinanceError] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<TransactionSummary | null>(initialCached?.transactions ?? null);
  const [transactionsError, setTransactionsError] = useState<string | null>(null);
  const [profitabilityLines, setProfitabilityLines] = useState<ProfitabilityLine[]>(initialCached?.profitabilityLines ?? []);
  const [profitabilityLoading, setProfitabilityLoading] = useState(!initialCached);
  const [profitabilityError, setProfitabilityError] = useState<string | null>(null);
  const [profitabilityScope, setProfitabilityScope] = useState<string | undefined>(initialCached?.profitabilityScope);
  const [feesOpen, setFeesOpen] = useState(false);
  const [section, setSection] = useState<MonitorSection>(secaoInicial);

  async function load(periodQuery: string) {
    const cached = monitorCache.get(periodQuery);
    if (cached) {
      // Pinta o que já foi visto na hora; a revalidação continua em fundo.
      setFinance(cached.finance);
      setProfit(cached.profit);
      setTransactions(cached.transactions);
      setProfitabilityLines(cached.profitabilityLines);
      setProfitabilityScope(cached.profitabilityScope);
      setProfitabilityLoading(false);
    } else {
      setProfitabilityLoading(true);
    }
    // Write-through: cada fetch que completa atualiza o snapshot do período.
    const snap: MonitorSnapshot = cached ? { ...cached } : {
      finance: null, profit: null, transactions: null, profitabilityLines: [],
    };
    const store = () => monitorCache.set(periodQuery, { ...snap });
    setFinanceError(null);
    setTransactionsError(null);
    setProfitabilityError(null);
    // Financeiro (repasse + custos), transações e rentabilidade por venda em
    // paralelo; um não derruba o outro. Cada um tem o seu próprio estado de erro.
    const profitReq = fetch(`/api/profit?${periodQuery}`)
      .then((r) => readJson(r).then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error || "Erro ao carregar financeiro.");
        setProfit(data.summary);
        setFinance(data.summary.finance);
        snap.profit = data.summary;
        snap.finance = data.summary.finance;
        store();
      })
      .catch((err) =>
        setFinanceError(err instanceof Error ? err.message : "Erro desconhecido.")
      );

    const transactionsReq = fetch(`/api/transactions?${periodQuery}`)
      .then((r) => readJson(r).then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error || "Erro ao carregar transações.");
        setTransactions(data.summary);
        snap.transactions = data.summary;
        store();
      })
      .catch((err) =>
        setTransactionsError(err instanceof Error ? err.message : "Erro desconhecido.")
      );

    const profitabilityReq = fetch(`/api/order-profitability?${periodQuery}`)
      .then((r) => readJson(r).then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error || "Não foi possível calcular as vendas.");
        const scope = data.scope?.completePeriod ? undefined : `Exibindo os ${data.scope?.processedOrders ?? data.lines.length} pedidos mais recentes. Os totais financeiros acima consideram o período completo.`;
        setProfitabilityLines(data.lines);
        setProfitabilityScope(scope);
        snap.profitabilityLines = data.lines;
        snap.profitabilityScope = scope;
        store();
      })
      .catch((err) => setProfitabilityError(err instanceof Error ? err.message : "Erro desconhecido."))
      .finally(() => setProfitabilityLoading(false));

    await Promise.all([profitReq, transactionsReq, profitabilityReq]);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(period.query), 0);
    return () => window.clearTimeout(timer);
  }, [period.query]);

  const costsIncomplete = (profit?.unitsWithoutCost ?? 0) > 0;
  // ⚠️ 30/08/2026: o lucro chega COM anúncio dentro, e chega `null` quando o
  // gasto é desconhecido. Cair no repasse líquido nesse caso exibiria o número
  // otimista — sem anúncio — com o rótulo "Lucro estimado". É a versão MONITOR
  // do defeito que custou quatro consertos na tela da Amazon.
  const adsDesconhecido = profit?.adsDesconhecido === true || (profit != null && profit.estimatedProfit == null);
  const estimatedProfit = adsDesconhecido ? null : profit?.estimatedProfit ?? finance?.netProceeds ?? 0;
  const otherAdjustments = finance
    ? Math.round((finance.netProceeds - (finance.revenue - finance.fees - finance.refunds)) * 100) / 100
    : 0;
  const marginPct = estimatedProfit != null && finance && finance.revenue > 0 ? (estimatedProfit / finance.revenue) * 100 : null;

  return (
    <div className="monitor-page">
      <DashboardPeriodFilter {...period.filterProps} />

      <PageHeader
        eyebrow="Pedidos e financeiro Amazon"
        title="Monitor da conta"
        subtitle="Conciliação, movimentações e rentabilidade por venda no período selecionado."
        icon={pageIcons.chart}
      />

      {financeError ? (
        <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
          {financeError}
        </div>
      ) : finance ? (
        <div className="monitor-summary">
          {finance.orderCount === 0 && (
            <div className="monitor-empty-finance">
              Nenhum evento financeiro no período. Os valores serão preenchidos quando houver vendas conciliadas.
            </div>
          )}
          {/* O dashboard da Amazon conta por data do pedido; aqui e por data do
              lancamento do repasse. Mesma frase nos quatro canais. */}
          <BaseDeData base="lancamento" />
          <EstadoDoSync provider="amazon" />
          <CustomizableMetricGrid
            viewKey="amazon-monitor"
            ariaLabel="Resumo financeiro Amazon"
            gridClassName="metric-grid monitor-metric-grid"
            widgets={[
              {
                id: "receita-conciliada",
                label: "Receita conciliada",
                // A contagem TEM que ser a do repasse (finance.orderCount), não a de
                // pedidos criados (metrics.totalOrders): a receita aqui é por data de
                // LANÇAMENTO, e colar as duas fazia "R$ 50,01 · 1 pedido" quando o valor
                // vinha de 2 pedidos repassados hoje, vendidos em dias diferentes.
                node: <Metric label="Receita conciliada" value={money(finance.revenue, finance.currency)} sub={`${finance.orderCount} pedido(s) com repasse no período`} />,
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
                node: <Metric label={estimatedProfit != null && costsIncomplete ? "Repasse antes do custo" : "Lucro estimado"} value={estimatedProfit == null ? "—" : money(estimatedProfit, finance.currency)} sub={estimatedProfit == null ? "aguardando o gasto com anúncio do período" : costsIncomplete ? "faltam custos cadastrados" : "repasse − custo dos produtos − anúncio"} tone={estimatedProfit == null || costsIncomplete ? "default" : estimatedProfit > 0 ? "positive" : estimatedProfit < 0 ? "danger" : "default"} />,
              },
              {
                id: "margem-pct",
                label: "Margem",
                node: <Metric label="Margem" value={costsIncomplete || marginPct == null ? "—" : percent(marginPct)} sub={costsIncomplete ? "aguardando todos os custos" : "sobre a receita"} tone={costsIncomplete ? "default" : marginMetricTone(marginPct)} />,
              },
            ]}
          />
        </div>
      ) : (
        <PanelLoading label="Carregando resumo financeiro" />
      )}

      <nav className="monitor-section-tabs" aria-label="Visões do monitor">
        {([
          ["composition", "Composição"],
          ["transactions", "Transações"],
          ["profitability", "Rentabilidade por venda"],
        ] as Array<[MonitorSection, string]>).map(([key, label]) => (
          <button key={key} type="button" aria-current={section === key ? "page" : undefined} onClick={() => setSection(key)}>{label}</button>
        ))}
      </nav>

      {section === "composition" && (
        finance ? (
          <section className="monitor-composition" aria-labelledby="amz-financial-title">
            <header className="monitor-section-heading">
              <div><p>Financeiro realizado</p><h2 id="amz-financial-title">Do faturamento ao resultado</h2></div>
              <span>Repasses conciliados da Amazon</span>
            </header>
            <div className="financial-lines">
              {/* A cascata começa no MESMO número do dashboard e desconta o que a
                  Amazon ainda não valorizou. Antes ela começava direto na receita
                  conciliada, que é menor, e as duas telas não se conversavam
                  ("não bate ainda, tem que vir o mesmo dado", 23/08/2026). */}
              {finance.faturamentoPeriodo != null && finance.aguardandoConfirmacao ? (
                <>
                  <Flow label="Faturamento do período" value={money(finance.faturamentoPeriodo, finance.currency)} />
                  <Flow
                    label={`Aguardando valor da Amazon (${finance.pedidosAguardando} pedido${finance.pedidosAguardando === 1 ? "" : "s"})`}
                    value={money(finance.aguardandoConfirmacao, finance.currency)}
                    sign="−"
                  />
                  <Flow label="Receita conciliada" value={money(finance.revenue, finance.currency)} sign="=" />
                </>
              ) : (
                <Flow label="Receita de produtos" value={money(finance.revenue, finance.currency)} />
              )}
              {finance.feeBreakdown.length > 0 ? (
                <FlowExpandable
                  label="Taxas Amazon"
                  value={money(finance.fees, finance.currency)}
                  open={feesOpen}
                  onToggle={() => setFeesOpen((open) => !open)}
                  items={finance.feeBreakdown.map((fee) => ({ label: nomeDaTarifa(fee.type), value: money(fee.amount, finance.currency) }))}
                />
              ) : (
                <Flow label="Taxas Amazon" value={money(finance.fees, finance.currency)} sign="−" />
              )}
              <Flow label="Reembolsos" value={money(finance.refunds, finance.currency)} sign="−" />
              {Math.abs(otherAdjustments) >= 0.005 && <Flow label="Outros ajustes (promoções, frete, estoque)" value={money(otherAdjustments, finance.currency)} />}
              <Flow label="Repasse líquido" value={money(finance.netProceeds, finance.currency)} sign="=" />
              <Flow label="Custo dos produtos" value={money(profit?.cogs ?? 0, finance.currency)} sign="−" />
              <Flow label={estimatedProfit == null ? "Lucro indisponível" : costsIncomplete ? "Repasse antes do custo" : "Lucro estimado"} value={estimatedProfit == null ? "—" : money(estimatedProfit, finance.currency)} sign="=" accent={estimatedProfit != null && !costsIncomplete} />
            </div>
            {costsIncomplete && (
              <p className="monitor-coverage-note">
                <strong>{profit?.unitsWithoutCost} unidade(s)</strong> vendida(s) ainda sem custo cadastrado. <a href="/amazon/produtos">Cadastrar custos em Produtos</a>
              </p>
            )}
          </section>
        ) : <PanelLoading label="Carregando composição financeira" />
      )}

      {section === "transactions" && <section className="monitor-transactions">
        <header className="monitor-section-heading">
          <div>
            <p>Financeiro conciliado</p>
            <h2>Conciliação de transações</h2>
            <small>
              Transações do período, separadas pelo que já foi liberado e pelo que a Amazon
              ainda retém. Não é o saldo da sua conta.
            </small>
          </div>
          <span>Dados financeiros atualizados</span>
        </header>

        {transactionsError ? (
          <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            {transactionsError}
          </div>
        ) : transactions ? (
          <div className="monitor-transactions-body">
            {/* Estes números são a soma das transações DO PERÍODO por status — não são
                saldo de conta na Amazon. Os rótulos anteriores diziam "Saldo liberado" e
                "Saldo diferido", e um pagamento de anúncio caindo antes de uma venda
                liberar fazia a tela mostrar um negativo que parecia dívida. */}
            <div className="transaction-summary-band">
              <Stat
                label="Já liberado no período"
                value={money(transactions.releasedAmount, transactions.currency)}
                hint="O que a Amazon já movimentou. Fica negativo quando só taxas e anúncios liquidaram."
              />
              <Stat
                label="Ainda retido"
                value={money(transactions.deferredAmount, transactions.currency)}
                hint="Vendas que a Amazon segura até a entrega e o prazo de devolução."
              />
              <Stat
                label="Líquido se tudo liquidar"
                value={money(
                  +(transactions.releasedAmount + transactions.deferredAmount).toFixed(2),
                  transactions.currency
                )}
                hint="Soma dos dois. O retido ainda pode mudar por devolução ou ajuste."
              />
              <Stat label="Transações" value={String(transactions.transactionCount)} />
            </div>

            {transactions.recent.length > 0 && (
              <div className="table-scroll monitor-transaction-table">
                <table className="data-table min-w-[720px]">
                  <caption className="sr-only">Transações financeiras recentes</caption>
                  <thead className="bg-[var(--ink-03)] text-left text-xs uppercase tracking-wide text-[var(--ink-muted)]">
                    <tr>
                      <th scope="col" className="px-4 py-3">Data</th>
                      <th scope="col" className="px-4 py-3">Transação</th>
                      <th scope="col" className="px-4 py-3">Pedido / SKU</th>
                      <th scope="col" className="px-4 py-3">Status</th>
                      <th scope="col" className="px-4 py-3 text-right">Valor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--line)]">
                    {transactions.recent.map((transaction) => (
                      <tr key={transaction.id} className="hover:bg-[var(--ink-03)]">
                        <td className="whitespace-nowrap px-4 py-3 text-[var(--ink-soft)]">
                          {brDate(transaction.postedDate)}
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-[var(--ink)]">{transaction.description}</p>
                          <p className="text-xs text-[var(--ink-muted)]">{transaction.type}</p>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-[var(--ink-soft)]">
                          {transaction.orderId || transaction.sku || "—"}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            transaction.status === "RELEASED"
                              ? "bg-[var(--positive-soft)] text-[var(--positive)]"
                              : transaction.status === "DEFERRED"
                                ? "bg-[var(--warning-soft)] text-[var(--warning)]"
                                : "bg-[var(--ink-05)] text-[var(--ink-soft)]"
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
      </section>}

      {section === "profitability" && <OrderProfitabilityTable lines={profitabilityLines} loading={profitabilityLoading} error={profitabilityError} scopeNote={profitabilityScope} />}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="transaction-stat">
      <p>{label}</p>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

/**
 * `useSearchParams` obriga a fronteira de Suspense em rota prerenderizada — sem
 * ela o build falha. A leitura da URL fica isolada aqui, e o resto da árvore
 * segue podendo ser pré-renderizado.
 */
function MonitorComSecao() {
  return <MonitorPage secaoInicial={useSecaoInicial()} />;
}

export default function MonitorPageWrapper() {
  return (
    <Suspense fallback={<PanelLoading label="Carregando monitor" />}>
      <MonitorComSecao />
    </Suspense>
  );
}
