"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { DashboardPeriodFilter, useDashboardPeriod } from "./DashboardPeriodFilter";
import { EmptyState } from "./EmptyState";
import { DashboardSkeleton } from "./LoadingState";
import { Metric } from "./Metric";
import { PageHeader } from "./PageHeader";
import { RevenueChart } from "./RevenueChart";
import { TopProductsRanking } from "./TopProductsRanking";
import { BriefingLead } from "./BriefingLead";
import { IntegrationDashboardFrame } from "./IntegrationDashboardFrame";
import { ConnectionBroken } from "./ConnectionBroken";
import { ChannelConnectionEmpty } from "./ChannelConnectionEmpty";
import { brDate } from "@/lib/datetime";
import {
  coverageDescription,
  effectiveTiktokDashboardPhase,
  financialCards,
  historicalBacklogDescription,
  orderedTiktokConnections,
  resolveTiktokConnection,
  shouldCanonicalizeTiktokUrl,
  syncStateContent,
  syncBacklogDescription,
  parseTaxRateDraft,
  tiktokConnectionError,
  tiktokOverviewQuery,
  tiktokOrderStatusLabel,
  tiktokPageHref,
  tiktokProductsHref,
  tiktokSettingsQuery,
  type TiktokConnectionOption,
  type TiktokOverviewResponse,
  type TiktokSyncPhase,
} from "./TikTokWorkspaceModel";

interface ProviderStatus {
  configured: boolean;
  connectHref?: string;
  connections: TiktokConnectionOption[];
  issue?: { status: "attention"; code: "OWNERSHIP_CONFLICT" | "PROVIDER_READ_FAILED"; message: string };
}

const TIKTOK_PRIMARY_FINANCIAL_KEYS = new Set(["revenue", "fees", "cogs", "profit", "marginPct"]);

const MANAGE_CONNECTIONS = "/integracoes";

export function TikTokWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const updatePeriodUrl = useCallback((query: string) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const key of ["days", "from", "to"]) next.delete(key);
    new URLSearchParams(query).forEach((value, key) => next.set(key, value));
    router.push(`/tiktok?${next}`, { scroll: false });
  }, [router, searchParams]);
  const period = useDashboardPeriod(searchParams.toString(), updatePeriodUrl);
  const [provider, setProvider] = useState<ProviderStatus | null>(null);
  const [overviewState, setOverviewState] = useState<{ connectionId: string; data: TiktokOverviewResponse } | null>(null);
  const [errorState, setErrorState] = useState<{ connectionId: string | null; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/integrations", { cache: "no-store" });
        const body = await response.json();
        if (!response.ok) throw new Error("Não foi possível carregar as integrações.");
        const item = (body.providers ?? []).find((candidate: { id: string }) => candidate.id === "tiktok_shop");
        if (!cancelled) setProvider({
          configured: Boolean(item?.configured),
          connectHref: item?.connectHref,
          connections: Array.isArray(item?.connections) ? orderedTiktokConnections(item.connections) : [],
          issue: item?.issue,
        });
      } catch (cause) {
        if (!cancelled) setErrorState({ connectionId: null, message: cause instanceof Error ? cause.message : "Não foi possível carregar a TikTok Shop." });
      }
    })();
    return () => { cancelled = true; };
  }, [attempt]);

  const requestedConnectionId = searchParams.get("connection_id");
  const selectedConnection = resolveTiktokConnection(provider?.connections ?? [], requestedConnectionId);
  const selectedConnectionId = selectedConnection?.id ?? null;

  useEffect(() => {
    if (!provider || !selectedConnectionId || !shouldCanonicalizeTiktokUrl(provider.connections.length, requestedConnectionId, selectedConnectionId)) return;
    router.replace(tiktokPageHref(searchParams.toString(), selectedConnectionId), { scroll: false });
  }, [provider, requestedConnectionId, router, searchParams, selectedConnectionId]);

  const retry = useCallback(() => {
    setErrorState(null);
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!selectedConnectionId) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/integrations/tiktok/overview?${tiktokOverviewQuery(period.query, selectedConnectionId)}`, { cache: "no-store" });
        const body = await response.json();
        const connectionError = tiktokConnectionError(body.code);
        if (!response.ok) throw new Error(response.status >= 500 ? "A TikTok Shop está temporariamente indisponível." : (connectionError || "Não foi possível carregar esta loja. Tente novamente ou gerencie as conexões."));
        if (!cancelled) setOverviewState({ connectionId: selectedConnectionId, data: body });
      } catch (cause) {
        if (!cancelled) setErrorState({ connectionId: selectedConnectionId, message: cause instanceof Error ? cause.message : "Não foi possível carregar a TikTok Shop." });
      }
    })();
    return () => { cancelled = true; };
  }, [attempt, period.query, selectedConnectionId]);

  const selectConnection = useCallback((connectionId: string) => {
    setOverviewState(null);
    setErrorState(null);
    router.push(tiktokPageHref(searchParams.toString(), connectionId), { scroll: false });
  }, [router, searchParams]);

  const selector = provider && provider.connections.length > 1 && selectedConnectionId
    ? <StoreSelector connections={provider.connections} selectedId={selectedConnectionId} onChange={selectConnection} />
    : null;
  const data = overviewState?.connectionId === selectedConnectionId ? overviewState.data : null;
  const error = errorState && (errorState.connectionId === null || errorState.connectionId === selectedConnectionId)
    ? errorState.message
    : null;

  if (error) return <WorkspaceFrame action={selector}><EmptyState kind="permission" title="Não foi possível carregar" description={error} action={<RetryButton onClick={retry} />} /></WorkspaceFrame>;
  if (!provider) return <WorkspaceFrame><DashboardSkeleton /></WorkspaceFrame>;

  if (provider.issue) {
    return <WorkspaceFrame subtitle="A leitura deste canal foi interrompida para proteger o isolamento dos dados."><EmptyState
      kind="permission"
      title={provider.issue.code === "OWNERSHIP_CONFLICT" ? "Conexão TikTok protegida" : "Canal TikTok requer atenção"}
      description={provider.issue.message}
      action={<Link className="meli-primary-action" href={MANAGE_CONNECTIONS}>Gerenciar conexões <span aria-hidden="true">→</span></Link>}
    /></WorkspaceFrame>;
  }

  if (provider.connections.length === 0) {
    return <WorkspaceFrame subtitle="Conecte uma loja para começar a sincronizar vendas e extratos."><ChannelConnectionEmpty
      channel="TikTok Shop"
      description={provider.configured ? "Autorize sua loja para iniciar a primeira sincronização." : "A conexão ainda não está disponível neste ambiente."}
      action={provider.configured && <Link className="meli-primary-action" href={provider.connectHref || MANAGE_CONNECTIONS}>Conectar loja <span aria-hidden="true">→</span></Link>}
    /></WorkspaceFrame>;
  }

  if (!data) return <WorkspaceFrame action={selector}><DashboardSkeleton /></WorkspaceFrame>;

  const syncPhase = data.sync.phase;
  if (syncPhase === "first_sync") return <SyncState phase={syncPhase} onRetry={retry} headerAction={selector} />;
  if (syncPhase === "retryable_error") return <SyncState phase={syncPhase} onRetry={retry} headerAction={selector} />;
  if (syncPhase === "reauth_required") return <SyncState phase={syncPhase} reconnectHref={provider.connectHref || "/api/tiktok/login"} headerAction={selector} />;
  if (syncPhase === "unavailable") return <SyncState phase={syncPhase} onRetry={retry} headerAction={selector} />;
  if (!data.overview || !data.coverage) return <SyncState phase="first_sync" onRetry={retry} headerAction={selector} />;

  const phase = effectiveTiktokDashboardPhase(syncPhase, data.financialAvailability, data.financialCoverage?.status);
  const financialBlocked = data.financialAvailability === "BLOCKED" || data.financialCoverage?.status === "blocked";
  const cards = financialCards(data.overview, data.coverage);
  const primaryCards = cards.filter((card) => TIKTOK_PRIMARY_FINANCIAL_KEYS.has(card.key));
  const componentCards = cards.filter((card) => !TIKTOK_PRIMARY_FINANCIAL_KEYS.has(card.key));
  const historicalBacklog = historicalBacklogDescription(data.coverage);
  const currency = data.overview.currency;
  return (
    <IntegrationDashboardFrame
      className="channel-dashboard tiktok-dashboard-page"
      period={<DashboardPeriodFilter {...period.filterProps} />}
      header={<PageHeader eyebrow="TikTok Shop" title={data.connection.name} subtitle={`${data.connection.region} · ${phase === "ready" ? "Dados sincronizados" : "Sincronização parcial"}`} action={selector} />}
    >
      <div className="dashboard-sections integration-dashboard-sections tiktok-dashboard-body">
        {/* Mesma abertura dos outros três canais. O TikTok é o caso mais
            extremo dessa peça: o ledger financeiro pode estar bloqueado neste
            ambiente, e a frase precisa dizer isso em vez de exibir lucro
            zerado. `lucro={null}` fora do estado "pronto" é a tradução direta
            de `null ≠ 0` para dentro do texto. */}
        <BriefingLead
          periodo={period.label}
          faturamento={data.overview?.revenue ?? null}
          pedidos={data.orders ?? 0}
          lucro={phase === "ready" && !financialBlocked ? (data.overview?.profit ?? null) : null}
          format={(v) => new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(v)}
          acoes={
            data.overview?.taxRate == null
              ? [{ label: "Configurar a alíquota de imposto", href: "/tiktok", tone: "pendencia" as const }]
              : []
          }
        />
        {financialBlocked
          ? <StatusNotice title="Financeiro indisponível neste ambiente">A estrutura do ledger financeiro ainda não está disponível. Vendas e catálogo continuam visíveis, mas taxas e resultado permanecem desconhecidos; nenhum valor foi convertido em zero.</StatusNotice>
          : phase === "partial" && <StatusNotice title="Sincronização em andamento">Os números aparecem somente quando cada componente está completo. Nenhum valor parcial é apresentado como definitivo.</StatusNotice>}
        <section className="metric-grid tiktok-dashboard-metrics" aria-label="Resumo financeiro da TikTok Shop">
          {primaryCards.map((card) => <Metric key={card.key} label={card.label} value={card.value} sub={card.context} tone={(card.key === "profit" || card.key === "marginPct") && card.raw != null ? card.raw > 0 ? "positive" : card.raw < 0 ? "danger" : "default" : "default"} />)}
        </section>
        <details className="tiktok-financial-components">
          <summary><span>Componentes financeiros do período</span><small>{componentCards.length} valores preservados no detalhamento</small><ChevronDown aria-hidden="true" /></summary>
          <dl>
            {componentCards.map((card) => <div key={card.key}><dt>{card.label}</dt><dd className="tabular-nums">{card.value}</dd><small>{card.context}</small></div>)}
          </dl>
        </details>
        <section className="performance-panel tiktok-performance-panel" aria-labelledby="tiktok-performance-title">
          <div className="performance-chart">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3"><div><p className="section-kicker">Desempenho diário</p><h2 id="tiktok-performance-title" className="mt-1 text-lg font-semibold text-[var(--ink)]">Evolução do faturamento operacional</h2></div><span className="text-xs text-[var(--ink-muted)]">Valores de pedidos do período; não substituem o ledger financeiro.</span></div>
            <div className="chart-inline-stats" aria-label="Indicadores operacionais do período"><span><small>Pedidos</small><strong>{(data.orders ?? 0).toLocaleString("pt-BR")}</strong></span><span><small>Unidades</small><strong>{(data.units ?? 0).toLocaleString("pt-BR")}</strong></span><span><small>Ticket médio</small><strong>{data.ticket == null ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(data.ticket)}</strong></span></div>
            <RevenueChart points={data.dailySeries ?? []} currency={currency} explorable />
          </div>
          <aside className="financial-composition" aria-labelledby="tiktok-status-title"><div><p className="section-kicker">Pedidos do período</p><h2 id="tiktok-status-title" className="mt-1 text-lg font-semibold text-[var(--ink)]">Distribuição por status</h2><p className="mt-1 text-xs leading-relaxed text-[var(--ink-muted)]">Contagem canônica dos pedidos já sincronizados.</p></div>{!data.statusBreakdown?.length?<p className="py-6 text-sm text-[var(--ink-muted)]">Nenhum pedido no período.</p>:<dl className="financial-lines">{data.statusBreakdown.map((item)=><div key={item.status} className="flex items-center justify-between gap-3 py-2 text-sm"><dt className="text-[var(--ink-soft)]">{tiktokOrderStatusLabel(item.status)}</dt><dd className="font-semibold tabular-nums text-[var(--ink)]">{item.orders.toLocaleString("pt-BR")}</dd></div>)}</dl>}</aside>
        </section>
        <TopProductsRanking
          products={(data.topProducts ?? []).map((product) => ({ sku: product.sku || product.productId, title: product.title, units: product.units, revenue: product.revenue, marginPct: null }))}
          currency={currency}
          productsHref={`/tiktok/catalogo?${new URLSearchParams({ connection_id: selectedConnectionId })}`}
        />
        <section className="tiktok-sync-panel" aria-labelledby="tiktok-sync-coverage-title">
          <div className="mb-4"><p className="section-kicker">Sincronização geral</p><h2 id="tiktok-sync-coverage-title" className="mt-1 text-lg font-semibold text-[var(--ink)]">Importação e backlog histórico</h2><p className="mt-1 max-w-3xl text-sm leading-relaxed text-[var(--ink-muted)]">O backlog financeiro inclui pedidos históricos, inclusive fora da janela selecionada. Ele não é comparado com os denominadores do período abaixo.</p></div>
          <dl className="tiktok-sync-grid">{syncBacklogDescription(data.sync).filter((item) => item.key !== "financial").map((item) => <div key={item.key}><dt>{item.label}</dt><dd><span>{item.status}</span> · {item.detail}</dd></div>)}<div className="is-warning"><dt>{historicalBacklog.label}</dt><dd><span>{historicalBacklog.status}</span> · <span className="tabular-nums">{historicalBacklog.detail}</span><small>{historicalBacklog.context}</small></dd></div></dl>
        </section>
        <TikTokFinancialSettings key={selectedConnectionId} connectionId={selectedConnectionId} currentTaxRate={data.overview.taxRate} onSaved={retry} />
        <section className="tiktok-coverage-panel" aria-labelledby="tiktok-coverage-title">
          <div className="mb-4">
            <p className="section-kicker">Período selecionado</p>
            <h2 id="tiktok-coverage-title" className="mt-1 text-lg font-semibold text-[var(--ink)]">Cobertura financeira da janela</h2>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-[var(--ink-muted)]">Cada razão usa sua unidade real: pedidos, unidades ou o período. Valores capturados são evidência parcial e nunca substituem o total oficial, que permanece “—” até a cobertura ficar completa.</p>
          </div>
          <dl className="tiktok-coverage-grid">
            {coverageDescription(data.coverage, currency).map((item) => <div key={item.key}><dt>{item.label}</dt><dd><span>{item.status}</span> · <span className="tabular-nums">{item.detail}</span>{item.captured && <small>{item.captured}</small>}</dd></div>)}
          </dl>
        </section>
        <div className="tiktok-detail-grid">
          <section className="tiktok-detail-panel" aria-labelledby="tiktok-orders-title">
            <h2 id="tiktok-orders-title" className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Pedidos e rentabilidade</h2>
            {!data.orderProfitability?.length ? <EmptyState compact title="Nenhum pedido no período" /> : <ul className="divide-y divide-[var(--line)]">
              {data.orderProfitability.slice(0, 8).map((order) => <li key={order.orderId} className="flex items-center justify-between gap-4 py-3 text-sm">
                <span className="min-w-0"><strong className="block truncate font-mono text-xs text-[var(--ink-soft)]">#{order.orderId}</strong><small className="text-[var(--ink-muted)]">{brDate(order.occurredAt)} · {order.financialStatus === "complete" ? "conciliado" : order.financialStatus === "partial" ? "resultado parcial" : "aguardando extrato"}</small></span>
                <span className="shrink-0 text-right"><strong className="block tabular-nums">{new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(order.revenue)}</strong><small className={order.profit == null ? "text-[var(--ink-muted)]" : "text-emerald-700"}>{order.profit == null ? "Lucro —" : `${new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(order.profit)}${order.financialStatus === "complete" ? "" : " (parcial)"}`}</small></span>
              </li>)}
            </ul>}
          </section>
          <section className="tiktok-detail-panel" aria-labelledby="tiktok-catalog-title">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3"><div><h2 id="tiktok-catalog-title" className="text-sm font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Catálogo e estoque</h2><p className="mt-1 text-xs text-[var(--ink-muted)]">Quantidade disponível informada pelo catálogo da TikTok Shop.</p></div><Link className="min-h-10 rounded-lg px-3 py-2 text-sm font-semibold text-sky-700 transition-[background-color,color] hover:bg-sky-50 active:scale-[0.96]" href={tiktokProductsHref(selectedConnectionId)}>Gerenciar custos <span aria-hidden="true">→</span></Link></div>
            {!data.catalog?.length ? <EmptyState compact title="Nenhum produto sincronizado" /> : <ul className="divide-y divide-[var(--line)]">
              {data.catalog.slice(0, 8).map((product) => <li key={`${product.id}:${product.sku || ""}`} className="flex items-center justify-between gap-4 py-3 text-sm"><span className="min-w-0"><strong className="block truncate" title={product.title}>{product.title}</strong><small className="text-[var(--ink-muted)]">{product.sku || "Sem SKU"} · {product.status}</small></span><span className={`shrink-0 font-semibold tabular-nums ${product.availableQty === 0 ? "text-red-600" : "text-[var(--ink-soft)]"}`}>{product.availableQty} un.</span></li>)}
            </ul>}
          </section>
        </div>
      </div>
    </IntegrationDashboardFrame>
  );
}

function TikTokFinancialSettings({ connectionId, currentTaxRate, onSaved }: { connectionId: string; currentTaxRate: number | null; onSaved: () => void }) {
  const [draft, setDraft] = useState(currentTaxRate == null ? "" : String(currentTaxRate));
  const [state, setState] = useState<"loading" | "idle" | "saving" | "saved" | "error">("loading");
  const [message, setMessage] = useState("");
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/integrations/tiktok/settings?${tiktokSettingsQuery(connectionId)}`, { cache: "no-store" }).then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "Não foi possível carregar a alíquota."); if (!cancelled) { setDraft(body.taxRate == null ? "" : String(body.taxRate)); setState("idle"); setMessage(""); } }).catch((error) => { if (!cancelled) { setState("error"); setMessage(error instanceof Error ? error.message : "Não foi possível carregar a alíquota."); } });
    return () => { cancelled = true; };
  }, [connectionId]);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); const taxRate = draft.trim() === "" ? null : parseTaxRateDraft(draft);
    if (draft.trim() !== "" && taxRate == null) { setState("error"); setMessage("Informe uma alíquota entre 0% e 100%. Zero é aceito quando for um valor conhecido."); return; }
    setState("saving"); setMessage("");
    try { const response = await fetch(`/api/integrations/tiktok/settings?${tiktokSettingsQuery(connectionId)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taxRate }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error || "Não foi possível salvar a alíquota."); setDraft(body.taxRate == null ? "" : String(body.taxRate)); setState("saved"); setMessage(body.taxRate == null ? "Alíquota removida; imposto e lucro voltaram a desconhecidos." : "Alíquota salva para esta loja."); onSaved(); }
    catch (error) { setState("error"); setMessage(error instanceof Error ? error.message : "Não foi possível salvar a alíquota."); }
  }
  return <section className="tiktok-settings-panel" aria-labelledby="tiktok-financial-settings-title"><div className="tiktok-settings-heading"><div><p className="section-kicker">Configuração da loja</p><h2 id="tiktok-financial-settings-title">Imposto e custos dos produtos</h2><p>A alíquota é aplicada ao faturamento desta loja. Sem alíquota ou custo por SKU, imposto, lucro, margem e ROI permanecem “—”.</p></div><Link href={tiktokProductsHref(connectionId)} className="meli-primary-action">Cadastrar custos</Link></div><form onSubmit={submit} className="tiktok-tax-form"><label><span>Alíquota de imposto (%)</span><input type="number" inputMode="decimal" min="0" max="100" step="0.01" value={draft} onChange={(event) => { setDraft(event.target.value); if (state === "error" || state === "saved") { setState("idle"); setMessage(""); } }} disabled={state === "loading" || state === "saving"} aria-describedby="tiktok-tax-help tiktok-tax-status" placeholder="Não configurada" /></label><button type="submit" disabled={state === "loading" || state === "saving"} className="meli-primary-action">{state === "saving" ? "Salvando…" : "Salvar alíquota"}</button><p id="tiktok-tax-help">Informe 0 somente quando zero for um fato contábil.</p><p id="tiktok-tax-status" role={state === "error" ? "alert" : "status"} aria-live="polite" className={state === "error" ? "is-error" : "is-success"}>{state === "loading" ? "Carregando alíquota…" : message}</p></form></section>;
}

function WorkspaceFrame({ children, subtitle, action }: { children: React.ReactNode; subtitle?: string; action?: React.ReactNode }) {
  return <IntegrationDashboardFrame className="channel-dashboard tiktok-dashboard-page" header={<PageHeader eyebrow="TikTok Shop" title="Visão do canal" subtitle={subtitle} action={action} />}>{children}</IntegrationDashboardFrame>;
}

function StoreSelector({ connections, selectedId, onChange }: { connections: TiktokConnectionOption[]; selectedId: string; onChange: (id: string) => void }) {
  return <label className="channel-store-selector">Loja TikTok Shop<select value={selectedId} onChange={(event) => onChange(event.target.value)}>{connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.displayName || connection.externalAccountId || connection.id}</option>)}</select></label>;
}

function RetryButton({ onClick }: { onClick: () => void }) {
  return <button type="button" onClick={onClick} className="meli-primary-action min-h-11 active:scale-[0.96] transition-transform">Tentar novamente</button>;
}

function StatusNotice({ title, children }: { title: string; children: React.ReactNode }) {
  return <aside className="channel-module-notice is-warning" role="status"><strong>{title}</strong><p>{children}</p></aside>;
}

function SyncState({ phase, onRetry, reconnectHref, headerAction }: { phase: TiktokSyncPhase; onRetry?: () => void; reconnectHref?: string; headerAction?: React.ReactNode }) {
  if (phase === "reauth_required") return <WorkspaceFrame action={headerAction}><ConnectionBroken channel="tiktok_shop" /></WorkspaceFrame>;
  const selected = syncStateContent(phase);
  const action = reconnectHref
    ? <Link className="meli-primary-action" href={reconnectHref}>Reconectar loja <span aria-hidden="true">→</span></Link>
    : onRetry ? <RetryButton onClick={onRetry} /> : <Link className="meli-primary-action" href={MANAGE_CONNECTIONS}>Gerenciar conexão</Link>;
  return <WorkspaceFrame action={headerAction}><EmptyState kind={phase === "first_sync" ? "data" : "permission"} title={selected.title} description={selected.description} action={action} /></WorkspaceFrame>;
}
