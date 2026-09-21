"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { nomeDaTarifa } from "@/lib/nomeDaTarifa";
import { CANAL_AMAZON } from "@/lib/canalV3";
import { PageHeader, pageIcons } from "../../components/PageHeader";
import { PanelLoading } from "../../components/LoadingState";
import { OrderProfitabilityTableV3 } from "../../components/OrderProfitabilityTableV3";
import { Flow, FlowExpandable } from "../../components/Metric";
import { DashboardPeriodFilter, useDashboardPeriod } from "../../components/DashboardPeriodFilter";
import { usePrefetchDePeriodos } from "../../components/prefetchDePeriodos";
import { chaveDeVoo, controleDoEscopo } from "../../components/controleDeVoo";
import type { ProfitabilityLine } from "@/lib/profitability";
import { readJson } from "@/lib/readJson";
import { brDate } from "@/lib/datetime";
import { BaseDeData } from "../../components/BaseDeData";
import { AccountSwitcher } from "../../components/AccountSwitcher";

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

type MonitorSection = "transactions" | "profitability";

/**
 * Aba inicial do monitor, vinda da URL (`?secao=vendas`).
 *
 * O card "Pedidos recentes" do dashboard linka para cá, e a aba padrão é a
 * rentabilidade por venda. A URL antiga `?secao=vendas` continua chegando ao
 * mesmo destino para não quebrar atalhos salvos.
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
  return pedida === "transactions" ? "transactions" : "profitability";
}



// Escopo de módulo: sobrevive à navegação entre telas/canais (mesmo padrão do
// dashboard Amazon e do workspace ML). Ao voltar, o período já visto pinta no
// primeiro paint e a revalidação roda em segundo plano.
const monitorCache = new Map<string, MonitorSnapshot>();

const ESCOPO_DO_MONITOR = "monitor";

/**
 * As TRÊS rotas do monitor, numa ida só por período.
 *
 * ⚠️ PASSA PELO `controleDoEscopo`, e isso é condição: o aquecimento por foco e
 * o clique acontecem com 120 ms de diferença, e sem a porta compartilhada as
 * duas idas sairiam juntas — SEIS requisições no lugar de três, no arquivo cuja
 * tela já era a que mais pesa.
 *
 * Os avisos são OPCIONAIS de propósito: quem aquece não tem tela esperando e
 * não pinta nada; quem clicou pinta cada rota assim que ela chega. Uma rota que
 * falha não derruba as outras — cada uma tem o seu próprio aviso de erro, como
 * era antes.
 */
function buscarMonitor(periodQuery: string, ao?: {
  profit?: (resumo: ProfitSummary) => void;
  transactions?: (resumo: TransactionSummary) => void;
  profitability?: (linhas: ProfitabilityLine[], escopo: string | undefined) => void;
  erroFinanceiro?: (mensagem: string) => void;
  erroTransacoes?: (mensagem: string) => void;
  erroRentabilidade?: (mensagem: string) => void;
}) {
  return controleDoEscopo(ESCOPO_DO_MONITOR).umaVezSo(chaveDeVoo(ESCOPO_DO_MONITOR, periodQuery), async () => {
    const cached = monitorCache.get(periodQuery);
    // Write-through: cada fetch que completa atualiza o snapshot do período.
    const snap: MonitorSnapshot = cached ? { ...cached } : {
      finance: null, profit: null, transactions: null, profitabilityLines: [],
    };
    const store = () => monitorCache.set(periodQuery, { ...snap });
    // Financeiro (repasse + custos), transações e rentabilidade por venda em
    // paralelo; um não derruba o outro.
    const profitReq = fetch(`/api/profit?${periodQuery}`)
      .then((r) => readJson(r).then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error || "Erro ao carregar financeiro.");
        snap.profit = data.summary;
        snap.finance = data.summary.finance;
        store();
        ao?.profit?.(data.summary);
      })
      .catch((err) => ao?.erroFinanceiro?.(err instanceof Error ? err.message : "Erro desconhecido."));

    const transactionsReq = fetch(`/api/transactions?${periodQuery}`)
      .then((r) => readJson(r).then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error || "Erro ao carregar transações.");
        snap.transactions = data.summary;
        store();
        ao?.transactions?.(data.summary);
      })
      .catch((err) => ao?.erroTransacoes?.(err instanceof Error ? err.message : "Erro desconhecido."));

    const profitabilityReq = fetch(`/api/order-profitability?${periodQuery}`)
      .then((r) => readJson(r).then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error || "Não foi possível calcular as vendas.");
        const scope = data.scope?.completePeriod ? undefined : `Exibindo os ${data.scope?.processedOrders ?? data.lines.length} pedidos mais recentes. Os totais financeiros acima consideram o período completo.`;
        snap.profitabilityLines = data.lines;
        snap.profitabilityScope = scope;
        store();
        ao?.profitability?.(data.lines, scope);
      })
      .catch((err) => ao?.erroRentabilidade?.(err instanceof Error ? err.message : "Erro desconhecido."));

    await Promise.all([profitReq, transactionsReq, profitabilityReq]);
    return monitorCache.get(periodQuery) ?? snap;
  });
}

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
      pintar(cached);
      setProfitabilityLoading(false);
    } else {
      setProfitabilityLoading(true);
    }
    setFinanceError(null);
    setTransactionsError(null);
    setProfitabilityError(null);
    await buscarMonitor(periodQuery, {
      profit: (resumo) => { setProfit(resumo); setFinance(resumo.finance); },
      transactions: setTransactions,
      profitability: (linhas, escopo) => { setProfitabilityLines(linhas); setProfitabilityScope(escopo); },
      erroFinanceiro: setFinanceError,
      erroTransacoes: setTransactionsError,
      erroRentabilidade: setProfitabilityError,
    });
    // ⚠️ PINTA DO CACHE DEPOIS DO `await`, e não é redundante: se esta chamada
    // entrou de CARONA numa ida que já estava no ar (o aquecimento por foco),
    // os avisos acima não foram chamados — quem os passou foi a primeira. A ida
    // sempre grava no cache, então é dele que se pinta.
    const pronto = monitorCache.get(periodQuery);
    if (pronto) pintar(pronto);
    setProfitabilityLoading(false);
  }

  function pintar(snap: MonitorSnapshot) {
    setFinance(snap.finance);
    setProfit(snap.profit);
    setTransactions(snap.transactions);
    setProfitabilityLines(snap.profitabilityLines);
    setProfitabilityScope(snap.profitabilityScope);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(period.query), 0);
    return () => window.clearTimeout(timer);
  }, [period.query]);

  /**
   * ANTECIPAÇÃO SÓ PELO TECLADO, como na central e pelo mesmo motivo medido em
   * 31/08/2026: o monitor já guarda por período, então antecipar por ponteiro
   * somaria uma requisição por hover que não vira clique (3 → 4 na sessão
   * medida) — e cada ida daqui são TRÊS rotas. Foco não tem hover perdido.
   */
  const { aquecerAgora } = usePrefetchDePeriodos({
    ativo: !profitabilityLoading,
    atual: period.query,
    escopo: ESCOPO_DO_MONITOR,
    jaTem: (janela) => monitorCache.has(janela),
    buscar: async (janela) => { await buscarMonitor(janela); },
    filaDeFundo: false,
  });

  const costsIncomplete = (profit?.unitsWithoutCost ?? 0) > 0;
  // ⚠️ 30/08/2026: o lucro chega COM anúncio dentro, e chega `null` quando o
  // gasto é desconhecido. Cair no repasse líquido nesse caso exibiria o número
  // otimista — sem anúncio — sob o rótulo de lucro. É a versão MONITOR do
  // defeito que custou quatro consertos na tela da Amazon.
  // ⚠️ O rótulo é "Lucro", sem "estimado" (ADR-030): quando ele aparece, é
  // após custo e anúncio — o número é o número. A ressalva de que a tarifa
  // ainda não liquidou mora POR LINHA (a marca de procedência na tabela de
  // rentabilidade), nunca no nome do card. A palavra "estimado" só continua no
  // caminho da Shopee, que é outro canal com outro calendário (AGENTS.md).
  const adsDesconhecido = profit?.adsDesconhecido === true || (profit != null && profit.estimatedProfit == null);
  const estimatedProfit = profit == null || adsDesconhecido ? null : profit.estimatedProfit;
  const otherAdjustments = finance
    ? Math.round((finance.netProceeds - (finance.revenue - finance.fees - finance.refunds)) * 100) / 100
    : 0;
  const marginPct = estimatedProfit != null && finance && finance.revenue > 0 ? (estimatedProfit / finance.revenue) * 100 : null;

  return (
    <div className="v3 ml-monitor-body monitor-page">
      <DashboardPeriodFilter {...period.filterProps} onIntent={aquecerAgora} intencaoPor="foco" />

      <PageHeader
        eyebrow="Pedidos e financeiro Amazon"
        title="Monitor da conta"
        subtitle="Conciliação, movimentações e rentabilidade por venda no período selecionado."
        icon={pageIcons.chart}
        action={<AccountSwitcher appearance="chip" />}
      />

      {financeError ? (
        <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
          {financeError}
        </div>
      ) : finance ? (
        <>
          <BaseDeData base="lancamento" />
          <h2 className="v3-titulo-solto">{period.label.charAt(0).toUpperCase() + period.label.slice(1)}</h2>
          <div className="v3-colunas amazon-monitor-faixa" aria-label="Resumo financeiro Amazon">
            <ColunaDoMonitor rotulo="Receita conciliada" valor={money(finance.revenue, finance.currency)} nota={`${finance.orderCount} pedido(s) com repasse`} />
            <ColunaDoMonitor rotulo="Reembolsos" valor={money(finance.refunds, finance.currency)} tom={finance.refunds > 0 ? "negativo" : undefined} nota="estornos ao comprador" />
            <ColunaDoMonitor rotulo="Repasse líquido" valor={money(finance.netProceeds, finance.currency)} nota="após taxas e reembolsos" />
            <ColunaDoMonitor rotulo={costsIncomplete ? "Repasse antes do custo" : "Lucro"} valor={estimatedProfit == null ? "—" : money(estimatedProfit, finance.currency)} tom={estimatedProfit == null ? "vazio" : estimatedProfit < 0 ? "negativo" : "positivo"} nota={estimatedProfit == null ? "aguardando gasto com anúncio" : costsIncomplete ? "faltam custos cadastrados" : "após custos e anúncio"} />
            <ColunaDoMonitor rotulo="Margem" valor={costsIncomplete || marginPct == null ? "—" : percent(marginPct)} tom={costsIncomplete || marginPct == null ? "vazio" : marginPct < 0 ? "negativo" : "positivo"} nota={costsIncomplete ? "aguardando todos os custos" : "sobre a receita conciliada"} />
          </div>
        </>
      ) : (
        <PanelLoading label="Carregando resumo financeiro" />
      )}

      <nav className="v3-abas" aria-label="Visões do monitor Amazon">
        {([
          ["profitability", "Rentabilidade por venda"],
          ["transactions", "Transações"],
        ] as Array<[MonitorSection, string]>).map(([key, label]) => (
          <button key={key} type="button" className={`v3-aba${section === key ? " is-ativa" : ""}`} aria-current={section === key ? "page" : undefined} onClick={() => setSection(key)}>{label}</button>
        ))}
      </nav>

      {section === "transactions" && <>
        {finance ? (
          <section className="monitor-composition v3-card" aria-labelledby="amz-financial-title">
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
                  label={CANAL_AMAZON.rotuloDaTarifa}
                  value={money(finance.fees, finance.currency)}
                  open={feesOpen}
                  onToggle={() => setFeesOpen((open) => !open)}
                  items={finance.feeBreakdown.map((fee) => ({ label: nomeDaTarifa(fee.type), value: money(fee.amount, finance.currency) }))}
                />
              ) : (
                <Flow label={CANAL_AMAZON.rotuloDaTarifa} value={money(finance.fees, finance.currency)} sign="−" />
              )}
              <Flow label="Reembolsos" value={money(finance.refunds, finance.currency)} sign="−" />
              {Math.abs(otherAdjustments) >= 0.005 && <Flow label="Outros ajustes (promoções, frete, estoque)" value={money(otherAdjustments, finance.currency)} />}
              <Flow label="Repasse líquido" value={money(finance.netProceeds, finance.currency)} sign="=" />
              <Flow label="Custo dos produtos" value={money(profit?.cogs ?? 0, finance.currency)} sign="−" />
              <Flow label={estimatedProfit == null ? "Lucro indisponível" : costsIncomplete ? "Repasse antes do custo" : "Lucro"} value={estimatedProfit == null ? "—" : money(estimatedProfit, finance.currency)} sign="=" accent={estimatedProfit != null && !costsIncomplete} />
            </div>
            {costsIncomplete && (
              <p className="monitor-coverage-note">
                <strong>{profit?.unitsWithoutCost} unidade(s)</strong> vendida(s) ainda sem custo cadastrado. <a href="/amazon/anuncios?custo=missing">Cadastrar custos em Anúncios</a>
              </p>
            )}
          </section>
        ) : <PanelLoading label="Carregando composição financeira" />}

      <section className="monitor-transactions v3-card">
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
            <div className="v3-colunas amazon-transaction-summary">
              <ColunaDoMonitor rotulo="Já liberado" valor={money(transactions.releasedAmount, transactions.currency)} nota="movimentado no período" />
              <ColunaDoMonitor rotulo="Ainda retido" valor={money(transactions.deferredAmount, transactions.currency)} nota="até entrega e devolução" />
              <ColunaDoMonitor rotulo="Se tudo liquidar" valor={money(+(transactions.releasedAmount + transactions.deferredAmount).toFixed(2), transactions.currency)} nota="liberado + retido" />
              <ColunaDoMonitor rotulo="Transações" valor={transactions.transactionCount.toLocaleString("pt-BR")} nota="lançamentos no período" />
            </div>

            {transactions.recent.length > 0 ? (
              <div className="v3-tabela v3-tabela-transacoes-amazon">
                <div className="v3-transacao-cab"><span>Data</span><span>Transação</span><span>Pedido / SKU</span><span>Status</span><span>Valor</span></div>
                {transactions.recent.map((transaction) => (
                  <div className="v3-transacao-linha" key={transaction.id}>
                    <span className="v3-cel-num">{brDate(transaction.postedDate)}</span>
                    <span className="v3-cel-nome"><span className="v3-margem-titulo">{transaction.description}</span><span className="v3-cel-sub">{transaction.type}</span></span>
                    <span className="v3-cel-pedido">{transaction.orderId || transaction.sku || "—"}</span>
                    <span className="v3-cel-centro"><em className={`v3-chip v3-cobertura ${transaction.status === "RELEASED" ? "is-saudavel" : transaction.status === "DEFERRED" ? "is-atencao" : "is-vazio"}`}>{transaction.status === "RELEASED" ? "Liberada" : transaction.status === "DEFERRED" ? "Diferida" : transaction.status}</em></span>
                    <span className={`v3-cel-num${transaction.amount < 0 ? " is-negativo" : ""}`}>{money(transaction.amount, transaction.currency)}</span>
                  </div>
                ))}
              </div>
            ) : <p className="v3-nota">Nenhuma transação financeira no período.</p>}
          </div>
        ) : (
          <PanelLoading label="Carregando transações" />
        )}
      </section>
      </>}

      {section === "profitability" && <OrderProfitabilityTableV3 canal={CANAL_AMAZON} lines={profitabilityLines} loading={profitabilityLoading} error={profitabilityError} scopeNote={profitabilityScope} />}
    </div>
  );
}

function ColunaDoMonitor({ rotulo, valor, tom, nota }: { rotulo: string; valor: React.ReactNode; tom?: "positivo" | "negativo" | "vazio"; nota?: React.ReactNode }) {
  return (
    <div className="v3-coluna">
      <p className="v3-coluna-rotulo">{rotulo}</p>
      <strong className={`v3-coluna-valor${tom ? ` is-${tom}` : ""}`}>{valor}</strong>
      {nota ? <span className="v3-coluna-share">{nota}</span> : null}
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
