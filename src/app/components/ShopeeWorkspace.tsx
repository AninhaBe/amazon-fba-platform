"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatedNumber } from "./AnimatedNumber";
import { EmptyState } from "./EmptyState";
import { DashboardSkeleton } from "./LoadingState";
import { PageHeader } from "./PageHeader";
import { RevenueChart, type DailyPoint } from "./RevenueChart";
import { LegendaDeVendas } from "./LegendaDeVendas";
import { DashboardPeriodFilter, useDashboardPeriod } from "./DashboardPeriodFilter";
import { OrderProfitabilityTable } from "./OrderProfitabilityTable";
import { TopProductsRanking } from "./TopProductsRanking";
import { BriefingLead } from "./BriefingLead";
import { NexoDoDia } from "./NexoDoDia";
import { IntegrationDashboardFrame } from "./IntegrationDashboardFrame";
import { ConnectionBroken } from "./ConnectionBroken";
import { ChannelConnectionEmpty } from "./ChannelConnectionEmpty";
import { CompactMetric, Flow, FlowExpandable, Metric, getRevenueTrend } from "./Metric";
import { buildFinancialComposition, FinancialSummaryPanel } from "./FinancialSummaryPanel";
import { brDate, brTime } from "@/lib/datetime";
import { coberturaDoPeriodo } from "@/lib/coberturaPeriodo";
import { SincronizacaoCompleta } from "./SincronizacaoCompleta";
import { FlaskConical } from "lucide-react";
import type { ProfitabilityLine } from "@/lib/profitability";
import type { ShopeeSyncStatus } from "@/lib/integrations/shopeeSync";
import { SHOPEE_CATALOG_CAPABILITIES } from "@/lib/integrations/shopeeCapabilities";
import {
  resolveShopeeConnectionState,
  shopeeProviderIssueContent,
  shopeeSyncContent,
  shopeeTaxLabel,
  type ShopeeProviderIssue,
} from "./ShopeeWorkspaceModel";
import type { PublicIntegrationConnection } from "@/lib/integrations/types";
import { marginMetricTone } from "@/lib/marginTone";
import { comSemImposto } from "@/lib/semImposto";
import { rotuloStatusShopee } from "./statusDeExibicao";
import { shopeeTaxRateHref } from "./ShopeeSettingsModel";

interface Overview {
  account: { id: string; name: string; region: string };
  period: { from: string; to: string; label: string };
  metrics: {
    activeListings: number;
    productsWithoutCost: number;
    orders30d: number;
    paidOrders: number;
    revenue30d: number;
    cancelledRevenue: number;
    cancelledOrders: number;
    lastSaleAt: string | null;
    currency: string;
    revenueCoverage: { capturedOrders: number; totalOrders: number; complete: boolean };
  };
  profit: {
    fees: number | null; ads: number | null; taxesWithheld: number | null; refunds: number | null;
    cogs: number | null; taxes: number | null; taxRate: number | null;
    sellerShipping: number | null; buyerShipping: number | null; feesComplete: boolean;
    revenueProcessed: number;
    coverage: { processedOrders: number; paidOrders: number; complete: boolean };
    estimatedProfit: number | null; marginPct: number | null; unitsWithoutCost: number;
  };
  dailySales: DailyPoint[];
  topProducts: Array<{ id: string; sku: string | null; title: string; units: number; revenue: number; cost: number; contribution: number; complete: boolean; marginPct: number | null }>;
  stockRadar: Array<{ id: string; sku: string | null; title: string; availableQuantity: number; unitsSold: number; calculationDays: number; daysRemaining: number | null; status: "out" | "critical" | "ok" }>;
  profitabilityLines: ProfitabilityLine[];
  profitabilityPage: { limit: number; offset: number; totalOrders: number; returnedOrders: number; hasMore: boolean; complete: boolean };
  recentOrders: Array<{ id: string; status: string; createdAt: string; total: number; currency: string; items: number }>;
}

interface ProviderStatus {
  configured: boolean;
  connected: boolean;
  connectionStatus: "connected" | "attention" | "disconnected" | "missing";
  connectHref?: string;
  connectionCount: number;
  demo: boolean;
  connections: PublicIntegrationConnection[];
  issue?: ShopeeProviderIssue;
}

interface OverviewResponse {
  pending?: boolean;
  overview?: Overview;
  sync: ShopeeSyncStatus;
  selectedConnectionId?: string;
  connections?: Array<{ id: string; name: string; externalAccountId: string }>;
}

function money(value: number, currency = "BRL") {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
}

function percent(value: number) {
  return `${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

// Status da Shopee (v2) traduzidos; o que não estiver mapeado aparece legível.
// O mapa saiu daqui para `statusDeExibicao` porque o MONITOR da Shopee mostrava
// os mesmos status crus que esta tela já traduzia — duas telas do mesmo canal
// liam o mesmo pedido de dois jeitos.
const orderStatus = rotuloStatusShopee;

export function ShopeeWorkspace() {
  const period = useDashboardPeriod();
  const router = useRouter();
  const searchParams = useSearchParams();
  const previousPeriod = useRef(period.query);
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [sync, setSync] = useState<ShopeeSyncStatus | null>(null);
  const [syncPoll, setSyncPoll] = useState(0);

  useEffect(() => {
    if (previousPeriod.current === period.query) return;
    previousPeriod.current = period.query;
    if (searchParams.get("offset") === "0" || !searchParams.has("offset")) return;
    const next = new URLSearchParams(searchParams.toString());
    next.set("offset", "0");
    router.replace(`/shopee?${next}`, { scroll: false });
  }, [period.query, router, searchParams]);

  useEffect(() => {
    if (!status?.connections.length) return;
    const requested = searchParams.get("connection_id");
    const selected = status.connections.find((connection) => connection.id === requested) ?? status.connections[0];
    if (requested === selected.id) return;
    const next = new URLSearchParams(searchParams.toString());
    next.set("connection_id", selected.id);
    next.set("offset", "0");
    router.replace(`/shopee?${next}`, { scroll: false });
  }, [router, searchParams, status]);

  function retry() {
    setError(null);
    setPending(false);
    setOverview(null);
    setStatus(null);
    setSync(null);
    setRetryKey((key) => key + 1);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        const response = await fetch("/api/integrations", { cache: "no-store" });
        if (!response.ok) throw new Error("Não foi possível carregar as integrações.");
        const data = await response.json();
        const provider = (data.providers ?? []).find((item: { id: string }) => item.id === "shopee");
        const issue = provider?.issue as ShopeeProviderIssue | undefined;
        const connections = (issue ? [] : provider?.connections ?? []) as PublicIntegrationConnection[];
        const resolved = resolveShopeeConnectionState(connections);
        if (cancelled) return;
        setStatus({
          configured: Boolean(provider?.configured),
          connected: resolved.connectionStatus === "connected",
          connectionStatus: resolved.connectionStatus,
          connectHref: provider?.connectHref,
          connectionCount: resolved.connectionCount,
          demo: resolved.demo,
          connections: connections.filter((connection) => connection.status === "connected"),
          issue,
        });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Erro ao carregar.");
      }
    })();
    return () => { cancelled = true; };
  }, [retryKey]);

  useEffect(() => {
    if (!status?.connected) return;
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        const requested = searchParams.get("connection_id");
        const selected = status.connections.find((connection) => connection.id === requested) ?? status.connections[0];
        if (!selected) return;
        const query = new URLSearchParams(period.query);
        query.set("connection_id", selected.id);
        query.set("limit", "100");
        query.set("offset", searchParams.get("offset") ?? "0");
        const response = await fetch(`/api/integrations/shopee/overview?${query}`, { cache: "no-store" });
        const data = await response.json() as OverviewResponse & { error?: string };
        if (cancelled) return;
        if (!response.ok) throw new Error(data.error || "Erro ao carregar a Shopee.");
        setSync(data.sync);
        if (data.pending) {
          setPending(true);
          setOverview(null);
        } else {
          setPending(false);
          setOverview(data.overview ?? null);
          setUpdatedAt(new Date());
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Erro ao carregar.");
      }
    })();
    return () => { cancelled = true; };
  }, [status, period.query, retryKey, searchParams, syncPoll]);

  // Enquanto a primeira sincronização roda, a tela se atualiza sozinha — o
  // vendedor vê o número de pedidos crescer em vez de recarregar a página.
  useEffect(() => {
    if (!status?.connected || !sync) return;
    const primeiraSincronizacao = (sync.phase === "idle" || sync.phase === "syncing") && (pending || !overview);
    if (!primeiraSincronizacao) return;
    const timer = setTimeout(() => setSyncPoll((value) => value + 1), 5_000);
    return () => clearTimeout(timer);
  }, [status, sync, pending, overview, syncPoll]);

  if (error) {
    return (
      <ShopeeFrame>
        <EmptyState
          title="Não foi possível carregar"
          description={error}
          kind="permission"
          action={<button type="button" className="meli-primary-action" onClick={retry}>Tentar novamente</button>}
        />
      </ShopeeFrame>
    );
  }

  if (!status) {
    return (
      <ShopeeFrame>
        <DashboardSkeleton />
      </ShopeeFrame>
    );
  }

  const providerIssue = shopeeProviderIssueContent(status.issue);
  if (providerIssue) {
    return (
      <ShopeeFrame subtitle="O canal requer atenção antes de continuar.">
        <EmptyState
          kind="permission"
          title={providerIssue.title}
          description={providerIssue.description}
          action={<Link className="meli-primary-action" href="/integracoes">{providerIssue.actionLabel}</Link>}
        />
      </ShopeeFrame>
    );
  }

  if (status.demo && status.connectionStatus !== "connected") {
    return (
      <ShopeeFrame subtitle="Ambiente de demonstração — sem loja real autorizada.">
        <ShopeeDemoNotice connectHref={status.configured ? status.connectHref : undefined} />
        <EmptyState title="Demonstração indisponível" description="Os dados sintéticos não estão ativos. Conecte uma loja real quando a autorização da Shopee estiver disponível." />
      </ShopeeFrame>
    );
  }

  if (status.connectionStatus === "attention" || status.connectionStatus === "disconnected") {
    return (
      <ShopeeFrame subtitle="A loja precisa ser reconectada para retomar a sincronização.">
        <ConnectionBroken channel="shopee" />
      </ShopeeFrame>
    );
  }

  // As credenciais do servidor habilitam *conectar* uma loja nova — não são
  // requisito para *ver* o canal. Uma loja já conectada lê tudo do modelo
  // canônico, então o dashboard renderiza mesmo sem SHOPEE_PARTNER_ID no
  // ambiente. Checar credencial antes da conexão escondia o dashboard de quem
  // já tinha dados.
  if (!status.connected) {
    if (!status.configured) {
      return (
        <ShopeeFrame subtitle="Canal ainda não configurado no servidor.">
          <EmptyState
            kind="permission"
            title="Credenciais da Shopee ausentes"
            description="Defina SHOPEE_PARTNER_ID e SHOPEE_PARTNER_KEY no ambiente para habilitar a conexão."
          />
        </ShopeeFrame>
      );
    }
    return (
      <ShopeeFrame subtitle="Conecte uma loja para começar a sincronizar pedidos e taxas.">
        <ChannelConnectionEmpty
          channel="Shopee"
          description="Ao autorizar, o NEXO passa a ler pedidos, produtos e o extrato financeiro de cada venda."
          action={
            <Link className="meli-primary-action" href={status.connectHref || "/integracoes"}>
              Conectar loja Shopee <span aria-hidden="true">→</span>
            </Link>
          }
        />
      </ShopeeFrame>
    );
  }

  // A resposta do overview ainda não chegou: enquanto busca, é CARREGAMENTO —
  // nunca uma afirmação de ausência de dado. Sem este gate, entre o status das
  // integrações chegar e o overview responder, a tela afirmava "Ainda sem dados
  // sincronizados" por um instante numa loja com 10 mil pedidos (27/08/2026).
  // Toda resposta do overview traz `sync`, então sync nulo = ainda buscando.
  if (!sync && !overview && !pending) {
    return (
      <ShopeeFrame>
        <DashboardSkeleton />
      </ShopeeFrame>
    );
  }

  if (sync && sync.phase !== "ready" && (pending || !overview || sync.phase !== "syncing")) {
    const state = shopeeSyncContent(sync.phase);
    const detail = sync.error?.message || state.description;
    const action = state.action === "refresh"
      ? <button type="button" className="meli-primary-action" onClick={retry}>Atualizar estado</button>
      : state.action === "reconnect"
        ? <Link className="meli-primary-action" href={status.connectHref || "/api/integrations/shopee/connect"}>Reconectar loja <span aria-hidden="true">→</span></Link>
        : state.action === "manage" ? <Link className="meli-primary-action" href="/integracoes">Gerenciar conexão <span aria-hidden="true">→</span></Link> : undefined;
    return (
      <ShopeeFrame subtitle={status.demo ? `Demonstração · ${sync.progress}% concluído` : `Loja conectada · ${sync.progress}% concluído`}>
        {status.demo && <ShopeeDemoNotice connectHref={status.configured ? status.connectHref : undefined} />}
        <section aria-live="polite" aria-labelledby="shopee-sync-title">
          <EmptyState title={state.title} description={detail} kind={sync.phase === "idle" ? "data" : "permission"} action={action} />
          {sync.phase === "idle" || sync.phase === "syncing" ? (
            // Progresso honesto, com o número real — não um spinner mudo.
            <p className="integration-message" id="shopee-sync-title">
              {sync.processedOrders} pedido(s) já importado(s) · {sync.progress}% do período coberto.
            </p>
          ) : (
            <p className="sr-only" id="shopee-sync-title">Progresso da sincronização: {sync.progress}%. {sync.processedOrders} pedidos processados.</p>
          )}
        </section>
      </ShopeeFrame>
    );
  }

  if (pending || !overview) {
    return (
      <ShopeeFrame subtitle={status.demo ? "Ambiente de demonstração — dados sintéticos." : "Loja conectada — primeira sincronização pendente."}>
        {status.demo && <ShopeeDemoNotice connectHref={status.configured ? status.connectHref : undefined} />}
        <EmptyState
          title="Ainda sem dados sincronizados"
          description="A loja está autorizada. Assim que a primeira sincronização rodar, os indicadores, o gráfico e a rentabilidade por pedido aparecem aqui."
          action={<Link className="meli-primary-action" href="/integracoes">Gerenciar conexão <span aria-hidden="true">→</span></Link>}
        />
      </ShopeeFrame>
    );
  }

  return (
    <IntegrationDashboardFrame
      className="channel-dashboard shopee-dashboard-page"
      period={<DashboardPeriodFilter
        {...period.filterProps}
        meta={updatedAt ? <>Atualizado às {brTime(updatedAt)}{overview.metrics.lastSaleAt ? ` · última venda às ${brTime(overview.metrics.lastSaleAt, true)}` : ""}</> : undefined}
      />}
      header={<PageHeader
        eyebrow="Shopee"
        title={status.demo ? "Visão de demonstração" : overview.account.name}
        subtitle={status.demo ? `Dados sintéticos · ${overview.period.label}` : `Loja ${overview.account.id} · ${overview.account.region} · ${overview.period.label}`}
        action={status.connections.length > 1 && <label className="channel-store-selector">Loja<select aria-label="Loja Shopee" value={status.connections.find((item)=>item.id===searchParams.get("connection_id"))?.id??status.connections[0]?.id} onChange={(event)=>{const next=new URLSearchParams(searchParams.toString());next.set("connection_id",event.target.value);next.set("offset","0");router.push(`/shopee?${next}`,{scroll:false})}}>{status.connections.map((item)=><option key={item.id} value={item.id}>{item.displayName||item.externalAccountId||item.id}</option>)}</select></label>}
      />}
    >
      {status.demo && <ShopeeDemoNotice connectHref={status.configured ? status.connectHref : undefined} />}
      <Dashboard
        overview={overview}
        sync={sync}
        periodoLabel={period.label}
        onPage={(offset) => {
          const next = new URLSearchParams(searchParams.toString());
          next.set("offset", String(offset));
          router.push(`/shopee?${next}`, { scroll: false });
        }}
      />
    </IntegrationDashboardFrame>
  );
}

function ShopeeDemoNotice({ connectHref }: { connectHref?: string }) {
  return (
    <aside className="channel-module-notice is-warning shopee-demo-notice" aria-labelledby="shopee-demo-title">
      <div className="flex gap-3">
        <FlaskConical className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <div>
          <h2 id="shopee-demo-title" className="text-sm font-bold">Dados de demonstração</h2>
          <p className="mt-1 text-sm leading-relaxed">Os pedidos, produtos e valores desta tela são sintéticos. Nenhuma loja Shopee real está autorizada neste workspace.</p>
        </div>
      </div>
      {connectHref && (
        <Link className="meli-primary-action shrink-0" href={connectHref}>
          Conectar loja real <span aria-hidden="true">→</span>
        </Link>
      )}
    </aside>
  );
}

function Dashboard({ overview, sync, onPage, periodoLabel }: { overview: Overview; sync: ShopeeSyncStatus | null; onPage: (offset: number) => void; periodoLabel: string }) {
  const [costsOpen, setCostsOpen] = useState(false);
  // Período do filtro vs. histórico já importado (frente K): mês ainda não
  // importado nunca vira cards zerados — "não vendeu" e "não importei" são
  // fatos diferentes.
  const cobertura = sync ? coberturaDoPeriodo({
    periodoDeMs: new Date(overview.period.from).getTime(),
    periodoAteMs: new Date(overview.period.to).getTime(),
    coveredFrom: sync.coveredFrom,
    status: sync.status,
  }) : null;
  if (cobertura?.periodoInteiroDescoberto) {
    const desde = cobertura.cobreDesde ? brDate(new Date(cobertura.cobreDesde)) : null;
    return (
      <div className="dashboard-sections integration-dashboard-sections shopee-dashboard-body">
        <NexoDoDia />
        <EmptyState
          kind="data"
          title={cobertura.emImportacao ? "Este período ainda está sendo importado" : "Período anterior ao histórico importado"}
          description={cobertura.emImportacao
            ? `${desde ? `O histórico já cobre a partir de ${desde}. ` : ""}${sync?.processedOrders ?? 0} pedido(s) já importado(s) — este período aparece conforme o histórico avança.`
            : `O histórico importado começa em ${desde ?? "—"}. Datas anteriores não foram importadas.`}
        />
      </div>
    );
  }
  const profitCoverage = overview.profit.coverage;
  // Bases já coincidem (receita e contagem usam o mesmo filtro de status).
  // `null` sem venda: R$ 0,00 afirmaria que cada venda rendeu zero.
  const ticket = overview.metrics.paidOrders > 0 ? overview.metrics.revenue30d / overview.metrics.paidOrders : null;
  const units = overview.dailySales.reduce((total, point) => total + point.units, 0);
  const critical = overview.stockRadar.filter((product) => product.status === "critical" || product.status === "out");
  const roi = overview.profit.cogs != null && overview.profit.cogs > 0 && overview.profit.estimatedProfit != null ? (overview.profit.estimatedProfit / overview.profit.cogs) * 100 : null;
  const costsIncomplete = overview.profit.unitsWithoutCost > 0;
  // `overview.profit.taxes == null` saiu daqui em 26/08/2026: alíquota não
  // cadastrada é configuração da vendedora, não dado que faltou da Shopee. O
  // lucro sai sem o imposto e a tela rotula "(sem imposto)"; o CTA "Cadastrar
  // alíquota →" continua no painel. Tarifa, frete, ads, retenção, estorno e
  // custo seguem bloqueando.
  const semAliquota = overview.profit.taxRate == null;
  const resultIncomplete = !profitCoverage.complete || !overview.profit.feesComplete || costsIncomplete || overview.profit.fees == null || overview.profit.sellerShipping == null || overview.profit.ads == null || overview.profit.taxesWithheld == null || overview.profit.refunds == null || overview.profit.cogs == null || overview.profit.estimatedProfit == null || overview.profit.marginPct == null;
  const knownCosts = resultIncomplete ? null : overview.profit.fees! + overview.profit.sellerShipping! + overview.profit.ads! + overview.profit.taxesWithheld! + overview.profit.refunds! + overview.profit.cogs! + (overview.profit.taxes ?? 0);
  const ordersAwaitingCapture = Math.max(0, overview.metrics.revenueCoverage.totalOrders - overview.metrics.revenueCoverage.capturedOrders);
  const ordersAwaitingStatement = Math.max(0, profitCoverage.paidOrders - profitCoverage.processedOrders);

  return (
    <div className="dashboard-sections integration-dashboard-sections shopee-dashboard-body">
      {/* A MESMA leitura do NEXO dos outros canais — uma narracao por dia por
      workspace, nao uma por canal. So aparece se ja estiver escrita. */}
      <NexoDoDia />
      {/* Mesma abertura dos outros três canais. A Shopee ainda não tem loja
          real conectada, e é justamente por isso que ela precisa nascer com a
          composição igual: no dia em que o Go Live sair, a tela já está pronta
          em vez de virar uma quarta variação. */}
      <BriefingLead
        periodo={periodoLabel}
        faturamento={overview.metrics.revenue30d}
        pedidos={overview.metrics.paidOrders}
        // Cobertura parcial é motivo suficiente para não afirmar lucro: com
        // pedidos faltando na captura, o número existiria mas estaria errado.
        lucro={overview.metrics.revenueCoverage.complete ? overview.profit.estimatedProfit : null}
        format={(v) => money(v, overview.metrics.currency)}
        escopo="shopee"
        canalNome="Shopee"
        moeda={overview.metrics.currency}
        briefingHref="/shopee/monitor"
        briefingLabel="Ver detalhes"
        acoes={[
          ...(overview.profit.taxRate == null
            ? [{ label: "Cadastrar alíquota", href: shopeeTaxRateHref(overview.account.id), tone: "pendencia" as const }]
            : []),
          ...(overview.metrics.productsWithoutCost > 0
            ? [{ label: `Cadastrar custo de ${overview.metrics.productsWithoutCost} produto(s)`, href: "/shopee/produtos", tone: "pendencia" as const }]
            : []),
          ...(critical.length > 0
            ? [{ label: `${critical.length} produto(s) em estoque crítico`, href: "/shopee/estoque", tone: "alerta" as const }]
            : []),
        ]}
      />

      {!overview.metrics.revenueCoverage.complete && (
        <div role="status" className="integration-message is-error">
          {ordersAwaitingCapture} pedido(s) do período aguardam captura pela sincronização do NEXO. <Link href="/shopee/monitor" className="font-semibold text-sky-700 underline-offset-2 hover:underline">Ver pedidos <span aria-hidden="true">→</span></Link>
        </div>
      )}

      {sync?.phase === "syncing" && <div role="status" className="integration-message">Sincronização do NEXO em andamento: {sync.processedOrders} pedido(s) processado(s) ({sync.progress}%). <Link href="/shopee/monitor" className="font-semibold text-sky-700 underline-offset-2 hover:underline">Acompanhar no monitor <span aria-hidden="true">→</span></Link></div>}

      {cobertura && !cobertura.periodoCoberto && cobertura.cobreDesde && (
        <div role="status" className="integration-message">
          Os números abaixo cobrem a partir de {brDate(new Date(cobertura.cobreDesde))}
          {cobertura.emImportacao
            ? <> — o início do período ainda está sendo importado ({sync?.processedOrders ?? 0} pedido(s) já importado(s)).</>
            : <> — o histórico importado começa aí.</>}
        </div>
      )}

      {sync && (
        <SincronizacaoCompleta
          connectionId={`shopee:${overview.account.id}`}
          status={sync.status}
          coveredFrom={sync.coveredFrom}
        />
      )}

      {!SHOPEE_CATALOG_CAPABILITIES.models && (
        <div role="status" className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
          As quantidades são agregadas por anúncio — o detalhamento por variação ainda não está disponível nesta integração.
        </div>
      )}

      <section className="metric-grid shopee-dashboard-metrics" aria-label="Resumo financeiro Shopee">
        <Metric label="Faturamento" value={<AnimatedNumber id="shopee-dash-revenue" value={overview.metrics.revenue30d} format={(amount) => money(amount, overview.metrics.currency)} />} sub={`${overview.metrics.paidOrders} pedido(s) no período`} trend={getRevenueTrend(overview.dailySales)} />
        <Metric label="Taxas" value={overview.profit.fees == null ? "—" : money(overview.profit.fees, overview.metrics.currency)} sub={overview.profit.feesComplete ? "extrato financeiro processado" : "aguardando fechamento do extrato financeiro"} />
        <Metric label="Custo dos produtos" value={overview.profit.cogs == null ? "—" : money(overview.profit.cogs, overview.metrics.currency)} sub={costsIncomplete ? `${overview.profit.unitsWithoutCost} unidade(s) sem custo` : "custos cadastrados"} tone={costsIncomplete ? "warn" : "default"} />
        <Metric label={resultIncomplete ? "Resultado processado" : "Lucro estimado"} value={resultIncomplete || overview.profit.estimatedProfit == null ? "—" : <AnimatedNumber id="shopee-dash-profit" value={overview.profit.estimatedProfit} format={(amount) => money(amount, overview.metrics.currency)} />} sub={resultIncomplete ? `${profitCoverage.processedOrders} de ${profitCoverage.paidOrders} vendas` : comSemImposto("após todos os custos", semAliquota)} tone={resultIncomplete || overview.profit.estimatedProfit == null ? "default" : overview.profit.estimatedProfit > 0 ? "positive" : overview.profit.estimatedProfit < 0 ? "danger" : "default"} />
        <Metric label="Margem" value={resultIncomplete || overview.profit.marginPct == null ? "—" : percent(overview.profit.marginPct)} sub={resultIncomplete ? "aguardando conciliação completa" : comSemImposto("sobre o faturamento", semAliquota)} tone={resultIncomplete ? "default" : marginMetricTone(overview.profit.marginPct)} />
      </section>

      <section className="secondary-metrics" aria-label="Indicadores operacionais Shopee">
        <CompactMetric label="Vendas" value={overview.metrics.paidOrders.toLocaleString("pt-BR")} />
        <CompactMetric label="Unidades" value={units.toLocaleString("pt-BR")} />
        <CompactMetric label="Ticket médio" value={ticket == null ? "—" : money(ticket, overview.metrics.currency)} />
        <CompactMetric label="ROI" value={resultIncomplete || roi == null ? "—" : `${roi.toFixed(1)}%`} tone={resultIncomplete || roi == null ? "default" : roi > 0 ? "positive" : roi < 0 ? "danger" : "default"} />
        <CompactMetric label="Canceladas" value={`${money(overview.metrics.cancelledRevenue, overview.metrics.currency)} · ${overview.metrics.cancelledOrders}`} tone={overview.metrics.cancelledOrders > 0 ? "danger" : "default"} />
        <CompactMetric label="Estoque crítico" value={critical.length.toLocaleString("pt-BR")} tone={critical.length > 0 ? "danger" : "default"} />
      </section>

      <section className="performance-panel shopee-performance-panel">
        <div className="performance-chart">
          <div className="mb-2 flex items-baseline justify-between gap-4">
            <div>
              <p className="section-kicker">Desempenho diário</p>
              <h2 className="mt-1 text-lg font-semibold text-[var(--ink)]">Evolução do faturamento</h2>
            </div>
            <span className="text-sm font-semibold tabular-nums text-[var(--ink)]">
              {money(overview.metrics.revenue30d, overview.metrics.currency)} <span className="font-normal text-[var(--ink-muted)]">no período</span>
            </span>
          </div>
          {/* Mesma legenda dos outros canais. A nota é o que muda: na Shopee o
              dinheiro fica no escrow até a entrega ser confirmada. */}
          <LegendaDeVendas
            confirmados={{ pedidos: overview.metrics.paidOrders, valor: overview.metrics.revenue30d }}
            aguardando={{
              pedidos: Math.max(0, overview.metrics.orders30d - overview.metrics.paidOrders - overview.metrics.cancelledOrders),
              // O canônico da Shopee não separa o valor dos pendentes. `null` e
              // não zero: a legenda mostra a quantidade e omite o valor.
              valor: null,
            }}
            cancelados={{ pedidos: overview.metrics.cancelledOrders }}
            nota="A Shopee retém o valor da venda no escrow até a entrega ser confirmada."
            money={(valor) => money(valor, overview.metrics.currency)}
          />
          <RevenueChart points={overview.dailySales} currency={overview.metrics.currency} explorable />
        </div>
        <FinancialSummaryPanel
          complete={!resultIncomplete}
          labelledBy="shopee-financial-summary-title"
          description={profitCoverage.complete ? "Valores efetivamente identificados no período." : `Detalhamento processado em ${profitCoverage.processedOrders} de ${profitCoverage.paidOrders} vendas.`}
          total={overview.profit.revenueProcessed}
          totalLabel="Receita processada"
          format={(value) => money(value, overview.metrics.currency)}
          slices={buildFinancialComposition({
            total: overview.profit.revenueProcessed,
            costs: [
              { id: "fees", label: "Taxas da Shopee", value: overview.profit.fees },
              { id: "shipping", label: "Frete do vendedor", value: overview.profit.sellerShipping },
              { id: "ads", label: "Anúncios", value: overview.profit.ads },
              { id: "withheld", label: "Impostos retidos", value: overview.profit.taxesWithheld },
              { id: "refunds", label: "Estornos", value: overview.profit.refunds },
              { id: "cogs", label: "Custo dos produtos", value: overview.profit.cogs },
              { id: "taxes", label: "Impostos", value: overview.profit.taxes },
            ],
            result: resultIncomplete ? null : overview.profit.estimatedProfit,
          })}
          footer={(
            <>
              <Link href="/shopee/monitor" className="meli-financial-link">Ver composição completa no monitor <span aria-hidden="true">→</span></Link>
              <Link href="/shopee/produtos" className="meli-financial-link">Configurar custos e imposto <span aria-hidden="true">→</span></Link>
              {overview.profit.taxRate == null && <Link href={shopeeTaxRateHref(overview.account.id)} className="meli-financial-link">Cadastrar alíquota <span aria-hidden="true">→</span></Link>}
              {!overview.profit.feesComplete && (
                <p className="text-xs leading-relaxed text-amber-700">
                  {ordersAwaitingStatement > 0 ? `${ordersAwaitingStatement} venda(s) aguardam a postagem do extrato financeiro pela Shopee.` : "A Shopee ainda não postou o extrato financeiro de todas as vendas do período."} <Link href="/shopee/monitor" className="font-semibold text-sky-700 underline-offset-2 hover:underline">Ver no monitor <span aria-hidden="true">→</span></Link>
                </p>
              )}
              {overview.profit.unitsWithoutCost > 0 && (
                <p className="text-xs leading-relaxed text-amber-700">{overview.profit.unitsWithoutCost} unidade(s) vendida(s) ainda estão sem custo cadastrado.</p>
              )}
            </>
          )}
        >
            <Flow label={profitCoverage.complete ? "Receita paga" : "Receita processada"} value={money(overview.profit.revenueProcessed, overview.metrics.currency)} />
            <FlowExpandable
              label="Custos do canal e do produto"
              value={knownCosts == null ? "—" : money(knownCosts, overview.metrics.currency)}
              open={costsOpen}
              onToggle={() => setCostsOpen((open) => !open)}
              items={[
                { label: "Taxas da Shopee", value: overview.profit.fees == null ? "—" : money(overview.profit.fees, overview.metrics.currency) },
                { label: "Frete pago pelo vendedor", value: overview.profit.sellerShipping == null ? "—" : money(overview.profit.sellerShipping, overview.metrics.currency) },
                { label: "Anúncios", value: overview.profit.ads == null ? "—" : money(overview.profit.ads, overview.metrics.currency) },
                { label: "Impostos retidos", value: overview.profit.taxesWithheld == null ? "—" : money(overview.profit.taxesWithheld, overview.metrics.currency) },
                { label: "Estornos", value: overview.profit.refunds == null ? "—" : money(overview.profit.refunds, overview.metrics.currency) },
                { label: "Custo dos produtos", value: overview.profit.cogs == null ? "—" : money(overview.profit.cogs, overview.metrics.currency) },
                { label: shopeeTaxLabel(overview.profit.taxRate), value: overview.profit.taxes == null ? "—" : money(overview.profit.taxes, overview.metrics.currency) },
              ]}
            />
            <Flow label={resultIncomplete ? "Lucro indisponível" : comSemImposto("Lucro estimado", semAliquota)} value={resultIncomplete || overview.profit.estimatedProfit == null ? "—" : money(overview.profit.estimatedProfit, overview.metrics.currency)} sign="=" accent tone={resultIncomplete || overview.profit.estimatedProfit == null ? "default" : overview.profit.estimatedProfit > 0 ? "positive" : overview.profit.estimatedProfit < 0 ? "danger" : "default"} />
            <Flow
              label={comSemImposto("Margem", semAliquota)}
              value={resultIncomplete || overview.profit.marginPct == null ? "—" : percent(overview.profit.marginPct)}
              accent
              tone={resultIncomplete ? "default" : marginMetricTone(overview.profit.marginPct)}
            />
        </FinancialSummaryPanel>
      </section>

      <TopProductsRanking
        products={overview.topProducts.map((product) => ({ sku: product.sku || product.id, title: product.title, units: product.units, revenue: product.revenue, marginPct: product.marginPct }))}
        currency={overview.metrics.currency}
        productsHref="/shopee/produtos"
      />

      <div className="shopee-detail-grid">
        <Panel title="Estoque crítico" href="/shopee/estoque" linkLabel="Ver radar">
          {critical.length === 0 ? <Empty>Nenhum produto em ruptura iminente.</Empty> : (
            <ul className="divide-y divide-[var(--line)]">
              {critical.slice(0, 6).map((product) => (
                <li key={product.id} className="flex items-center justify-between py-2.5 text-sm">
                  <span className="min-w-0 truncate pr-3">{product.title || product.sku || product.id}</span>
                  <span className="shrink-0 font-semibold text-red-600">{product.status === "out" ? "esgotado" : `${product.daysRemaining} dias`}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Pedidos recentes" href="/shopee/monitor?secao=vendas" linkLabel="Ver todos os pedidos">
          {overview.recentOrders.length === 0 ? <Empty>Nenhum pedido no período.</Empty> : (
            <ul className="divide-y divide-[var(--line)]">
              {overview.recentOrders.slice(0, 6).map((order) => (
                <li key={order.id} className="flex items-center justify-between py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-xs text-[var(--ink-muted)]">#{order.id}</span>
                    <span className="text-xs text-[var(--ink-muted)]">{brDate(order.createdAt)} · {orderStatus(order.status)}</span>
                  </span>
                  <span className="shrink-0 font-medium tabular-nums">{money(order.total, order.currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <section className="shopee-profitability-section">
        {!overview.profitabilityPage.complete && <div role="status" className="mb-3 integration-message is-error">Exibindo {overview.profitabilityPage.offset + 1}–{overview.profitabilityPage.offset + overview.profitabilityPage.returnedOrders} de {overview.profitabilityPage.totalOrders} pedido(s). Há mais resultados.</div>}
        <OrderProfitabilityTable lines={overview.profitabilityLines} />
        <nav aria-label="Paginação da rentabilidade" className="mt-3 flex justify-end gap-2"><button type="button" className="min-h-11 rounded-lg px-4 shadow-[inset_0_0_0_1px_rgb(203_213_225)] active:scale-[0.96] transition-transform disabled:opacity-40" disabled={overview.profitabilityPage.offset===0} onClick={()=>onPage(Math.max(0,overview.profitabilityPage.offset-overview.profitabilityPage.limit))}>Anterior</button><button type="button" className="min-h-11 rounded-lg px-4 shadow-[inset_0_0_0_1px_rgb(203_213_225)] active:scale-[0.96] transition-transform disabled:opacity-40" disabled={!overview.profitabilityPage.hasMore} onClick={()=>onPage(overview.profitabilityPage.offset+overview.profitabilityPage.limit)}>Próxima</button></nav>
      </section>

    </div>
  );
}

function Panel({ title, href, linkLabel, children }: { title: string; href: string; linkLabel: string; children: React.ReactNode }) {
  return (
    <section className="shopee-detail-panel">
      <div className="mb-3 flex items-center justify-between border-b border-[var(--line)] pb-3">
        <h2 className="text-[13px] font-semibold text-[var(--ink-soft)]">{title}</h2>
        <Link href={href} className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:gap-1.5 hover:text-blue-700">{linkLabel}<span aria-hidden="true">→</span></Link>
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <EmptyState compact title={String(children)} />;
}

function ShopeeFrame({ children, subtitle }: { children: React.ReactNode; subtitle?: string }) {
  return (
    <IntegrationDashboardFrame
      className="channel-dashboard shopee-dashboard-page"
      header={<PageHeader eyebrow="Shopee" title="Visão do canal" subtitle={subtitle} />}
    >
      {children}
    </IntegrationDashboardFrame>
  );
}
