"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DashboardPeriodFilter, useDashboardPeriod } from "./DashboardPeriodFilter";
import { EmptyState } from "./EmptyState";
import { DashboardSkeleton } from "./LoadingState";
import { Metric } from "./Metric";
import { PageHeader } from "./PageHeader";
import { RevenueChart } from "./RevenueChart";
import { ConnectionBroken } from "./ConnectionBroken";
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
    return <WorkspaceFrame subtitle="Conecte uma loja para começar a sincronizar vendas e extratos."><EmptyState
      title="Nenhuma loja TikTok Shop conectada"
      description={provider.configured ? "Autorize sua loja para iniciar a primeira sincronização." : "A conexão ainda não está disponível neste ambiente."}
      kind={provider.configured ? "data" : "permission"}
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
  const historicalBacklog = historicalBacklogDescription(data.coverage);
  const currency = data.overview.currency;
  return (
    <>
      <PageHeader eyebrow="TikTok Shop" title={data.connection.name} subtitle={`${data.connection.region} · ${phase === "ready" ? "Dados sincronizados" : "Sincronização parcial"}`} action={selector} />
      <DashboardPeriodFilter {...period.filterProps} />
      <div className="dashboard-sections space-y-6">
        {financialBlocked
          ? <StatusNotice title="Financeiro indisponível neste ambiente">A estrutura do ledger financeiro ainda não está disponível. Vendas e catálogo continuam visíveis, mas taxas e resultado permanecem desconhecidos; nenhum valor foi convertido em zero.</StatusNotice>
          : phase === "partial" && <StatusNotice title="Sincronização em andamento">Os números aparecem somente quando cada componente está completo. Nenhum valor parcial é apresentado como definitivo.</StatusNotice>}
        <section className="work-panel border-t border-slate-300 py-5" aria-labelledby="tiktok-sync-coverage-title">
          <div className="mb-4"><p className="section-kicker">Sincronização geral</p><h2 id="tiktok-sync-coverage-title" className="mt-1 text-lg font-semibold text-slate-900">Importação e backlog histórico</h2><p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-500">O backlog financeiro inclui pedidos históricos, inclusive fora da janela selecionada. Ele não é comparado com os denominadores do período abaixo.</p></div>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">{syncBacklogDescription(data.sync).filter((item) => item.key !== "financial").map((item) => <div key={item.key} className="rounded-xl bg-slate-50 p-4 shadow-[inset_0_0_0_1px_rgb(226_232_240)]"><dt className="text-sm font-semibold text-slate-700">{item.label}</dt><dd className="mt-1 text-sm text-slate-500"><span className="font-medium text-slate-700">{item.status}</span> · {item.detail}</dd></div>)}<div className="rounded-xl bg-amber-50 p-4 shadow-[inset_0_0_0_1px_rgb(253_230_138)]"><dt className="text-sm font-semibold text-amber-900">{historicalBacklog.label}</dt><dd className="mt-1 text-sm leading-relaxed text-amber-800"><span className="font-medium text-amber-900">{historicalBacklog.status}</span> · <span className="tabular-nums">{historicalBacklog.detail}</span><small className="mt-2 block text-xs leading-relaxed">{historicalBacklog.context}</small></dd></div></dl>
        </section>
        <TikTokFinancialSettings key={selectedConnectionId} connectionId={selectedConnectionId} currentTaxRate={data.overview.taxRate} onSaved={retry} />
        <section className="metric-grid grid grid-cols-1 gap-0 sm:grid-cols-2 lg:grid-cols-4" aria-label="Indicadores financeiros da TikTok Shop">
          {cards.map((card) => <Metric key={card.key} label={card.label} value={card.value} sub={card.context} tone={card.key === "profit" && card.raw != null ? "positive" : "default"} />)}
        </section>
        <section className="performance-panel" aria-labelledby="tiktok-performance-title">
          <div className="performance-chart">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3"><div><p className="section-kicker">Desempenho diário</p><h2 id="tiktok-performance-title" className="mt-1 text-lg font-semibold text-slate-900">Evolução do faturamento operacional</h2></div><span className="text-xs text-slate-500">Valores de pedidos do período; não substituem o ledger financeiro.</span></div>
            <div className="chart-inline-stats" aria-label="Indicadores operacionais do período"><span><small>Pedidos</small><strong>{(data.orders ?? 0).toLocaleString("pt-BR")}</strong></span><span><small>Unidades</small><strong>{(data.units ?? 0).toLocaleString("pt-BR")}</strong></span><span><small>Ticket médio</small><strong>{data.ticket == null ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(data.ticket)}</strong></span></div>
            <RevenueChart points={data.dailySeries ?? []} />
          </div>
          <aside className="financial-composition" aria-labelledby="tiktok-status-title"><div><p className="section-kicker">Pedidos do período</p><h2 id="tiktok-status-title" className="mt-1 text-lg font-semibold text-slate-900">Distribuição por status</h2><p className="mt-1 text-xs leading-relaxed text-slate-400">Contagem canônica dos pedidos já sincronizados.</p></div>{!data.statusBreakdown?.length?<p className="py-6 text-sm text-slate-400">Nenhum pedido no período.</p>:<dl className="financial-lines">{data.statusBreakdown.map((item)=><div key={item.status} className="flex items-center justify-between gap-3 py-2 text-sm"><dt className="text-slate-600">{tiktokOrderStatusLabel(item.status)}</dt><dd className="font-semibold tabular-nums text-slate-900">{item.orders.toLocaleString("pt-BR")}</dd></div>)}</dl>}</aside>
        </section>
        <section className="work-panel border-t border-slate-300 py-5" aria-labelledby="tiktok-top-products-title">
          <div className="mb-3 flex items-center justify-between gap-3"><div><p className="section-kicker">Vendas do período</p><h2 id="tiktok-top-products-title" className="mt-1 text-lg font-semibold text-slate-900">Top produtos por faturamento</h2></div><Link href={`/tiktok/catalogo?${new URLSearchParams({ connection_id: selectedConnectionId })}`} className="text-xs font-semibold text-sky-700 hover:underline">Ver anúncios <span aria-hidden="true">→</span></Link></div>
          {!data.topProducts?.length?<EmptyState compact title="Sem vendas para ranquear" description="Nenhum produto teve faturamento operacional no período."/>:<div className="overflow-x-auto"><table className="w-full min-w-[520px] text-sm"><caption className="sr-only">Produtos com maior faturamento operacional no período</caption><thead className="text-left text-xs uppercase tracking-wide text-slate-400"><tr><th className="pb-2 pr-3 font-medium" scope="col">#</th><th className="pb-2 pr-3 font-medium" scope="col">Produto</th><th className="pb-2 px-3 text-right font-medium" scope="col">Unidades</th><th className="pb-2 pl-3 text-right font-medium" scope="col">Faturamento</th></tr></thead><tbody className="divide-y divide-slate-100">{data.topProducts.map((product,index)=><tr key={`${product.productId}:${product.sku??""}`}><td className="py-2.5 pr-3 tabular-nums text-slate-400">{index+1}</td><td className="py-2.5 pr-3"><strong className="block max-w-[320px] truncate font-medium" title={product.title}>{product.title}</strong><small className="text-slate-400">{product.sku||"Sem SKU"}</small></td><td className="py-2.5 px-3 text-right tabular-nums text-slate-600">{product.units.toLocaleString("pt-BR")}</td><td className="py-2.5 pl-3 text-right font-medium tabular-nums">{new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(product.revenue)}</td></tr>)}</tbody></table><p className="mt-3 text-xs text-slate-400">Ranking por receita dos itens dos pedidos sincronizados. Não representa composição do extrato financeiro.</p></div>}
        </section>
        <section className="work-panel border-t border-slate-300 py-5" aria-labelledby="tiktok-coverage-title">
          <div className="mb-4">
            <p className="section-kicker">Período selecionado</p>
            <h2 id="tiktok-coverage-title" className="mt-1 text-lg font-semibold text-slate-900">Cobertura financeira da janela</h2>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-500">Cada razão usa sua unidade real: pedidos, unidades ou o período. Valores capturados são evidência parcial e nunca substituem o total oficial, que permanece “—” até a cobertura ficar completa.</p>
          </div>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {coverageDescription(data.coverage, currency).map((item) => <div key={item.key} className="rounded-xl bg-slate-50 p-4 shadow-[inset_0_0_0_1px_rgb(226_232_240)]"><dt className="text-sm font-semibold text-slate-700">{item.label}</dt><dd className="mt-1 text-sm leading-relaxed text-slate-500"><span className="font-medium text-slate-700">{item.status}</span> · <span className="tabular-nums">{item.detail}</span>{item.captured && <small className="mt-2 block text-xs leading-relaxed text-amber-800">{item.captured}</small>}</dd></div>)}
          </dl>
        </section>
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
          <section className="work-panel border-t border-slate-300 py-5" aria-labelledby="tiktok-orders-title">
            <h2 id="tiktok-orders-title" className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Pedidos e rentabilidade</h2>
            {!data.orderProfitability?.length ? <EmptyState compact title="Nenhum pedido no período" /> : <ul className="divide-y divide-slate-100">
              {data.orderProfitability.slice(0, 8).map((order) => <li key={order.orderId} className="flex items-center justify-between gap-4 py-3 text-sm">
                <span className="min-w-0"><strong className="block truncate font-mono text-xs text-slate-600">#{order.orderId}</strong><small className="text-slate-400">{brDate(order.occurredAt)} · {order.financialStatus === "complete" ? "conciliado" : order.financialStatus === "partial" ? "resultado parcial" : "aguardando extrato"}</small></span>
                <span className="shrink-0 text-right"><strong className="block tabular-nums">{new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(order.revenue)}</strong><small className={order.profit == null ? "text-slate-400" : "text-emerald-700"}>{order.profit == null ? "Lucro —" : `${new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(order.profit)}${order.financialStatus === "complete" ? "" : " (parcial)"}`}</small></span>
              </li>)}
            </ul>}
          </section>
          <section className="work-panel border-t border-slate-300 py-5" aria-labelledby="tiktok-catalog-title">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3"><div><h2 id="tiktok-catalog-title" className="text-sm font-semibold uppercase tracking-wide text-slate-500">Catálogo e estoque</h2><p className="mt-1 text-xs text-slate-400">Quantidade disponível informada pelo catálogo da TikTok Shop.</p></div><Link className="min-h-10 rounded-lg px-3 py-2 text-sm font-semibold text-sky-700 transition-[background-color,color] hover:bg-sky-50 active:scale-[0.96]" href={tiktokProductsHref(selectedConnectionId)}>Gerenciar custos <span aria-hidden="true">→</span></Link></div>
            {!data.catalog?.length ? <EmptyState compact title="Nenhum produto sincronizado" /> : <ul className="divide-y divide-slate-100">
              {data.catalog.slice(0, 8).map((product) => <li key={`${product.id}:${product.sku || ""}`} className="flex items-center justify-between gap-4 py-3 text-sm"><span className="min-w-0"><strong className="block truncate" title={product.title}>{product.title}</strong><small className="text-slate-400">{product.sku || "Sem SKU"} · {product.status}</small></span><span className={`shrink-0 font-semibold tabular-nums ${product.availableQty === 0 ? "text-red-600" : "text-slate-700"}`}>{product.availableQty} un.</span></li>)}
            </ul>}
          </section>
        </div>
      </div>
    </>
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
  return <section className="work-panel border-t border-slate-300 py-5" aria-labelledby="tiktok-financial-settings-title"><div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-end"><div><p className="section-kicker">Configuração da loja</p><h2 id="tiktok-financial-settings-title" className="mt-1 text-lg font-semibold text-slate-900">Imposto e custos dos produtos</h2><p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500">A alíquota é aplicada ao faturamento desta loja. Sem alíquota ou custo por SKU, imposto, lucro, margem e ROI permanecem “—” porque o resultado ainda é desconhecido.</p></div><Link href={tiktokProductsHref(connectionId)} className="min-h-11 rounded-lg bg-slate-900 px-4 py-3 text-center text-sm font-semibold text-white transition-[background-color,transform] hover:bg-slate-700 active:scale-[0.96]">Cadastrar custos TikTok</Link></div><form onSubmit={submit} className="mt-5 flex flex-wrap items-end gap-3"><label className="flex min-w-56 flex-col gap-1 text-sm font-medium text-slate-700"><span>Alíquota de imposto da loja (%)</span><input type="number" inputMode="decimal" min="0" max="100" step="0.01" value={draft} onChange={(event) => { setDraft(event.target.value); if (state === "error" || state === "saved") { setState("idle"); setMessage(""); } }} disabled={state === "loading" || state === "saving"} aria-describedby="tiktok-tax-help tiktok-tax-status" className="min-h-11 rounded-lg bg-white px-3 text-sm shadow-[inset_0_0_0_1px_rgb(203_213_225)] focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:bg-slate-50" placeholder="Não configurada" /></label><button type="submit" disabled={state === "loading" || state === "saving"} className="meli-primary-action min-h-11 active:scale-[0.96] transition-transform disabled:cursor-not-allowed disabled:opacity-50">{state === "saving" ? "Salvando…" : "Salvar alíquota"}</button><p id="tiktok-tax-help" className="w-full text-xs leading-relaxed text-slate-500">Deixe desconhecida até confirmar a alíquota. Informe 0 somente quando zero for um fato contábil.</p><p id="tiktok-tax-status" role={state === "error" ? "alert" : "status"} aria-live="polite" className={`w-full text-sm ${state === "error" ? "text-red-600" : "text-emerald-700"}`}>{state === "loading" ? "Carregando alíquota…" : message}</p></form></section>;
}

function WorkspaceFrame({ children, subtitle, action }: { children: React.ReactNode; subtitle?: string; action?: React.ReactNode }) {
  return <><PageHeader eyebrow="TikTok Shop" title="Visão do canal" subtitle={subtitle} action={action} />{children}</>;
}

function StoreSelector({ connections, selectedId, onChange }: { connections: TiktokConnectionOption[]; selectedId: string; onChange: (id: string) => void }) {
  return <label className="flex min-w-56 flex-col gap-1 text-left text-xs font-semibold text-slate-500">Loja TikTok Shop<select className="min-h-11 rounded-lg bg-white px-3 text-sm font-medium text-slate-800 shadow-[inset_0_0_0_1px_rgb(203_213_225)] focus:outline-none focus:ring-2 focus:ring-sky-500" value={selectedId} onChange={(event) => onChange(event.target.value)}>{connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.displayName || connection.externalAccountId || connection.id}</option>)}</select></label>;
}

function RetryButton({ onClick }: { onClick: () => void }) {
  return <button type="button" onClick={onClick} className="meli-primary-action min-h-11 active:scale-[0.96] transition-transform">Tentar novamente</button>;
}

function StatusNotice({ title, children }: { title: string; children: React.ReactNode }) {
  return <aside className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900 shadow-[inset_0_0_0_1px_rgb(253_230_138)]" role="status"><strong className="block">{title}</strong><p className="mt-1 leading-relaxed">{children}</p></aside>;
}

function SyncState({ phase, onRetry, reconnectHref, headerAction }: { phase: TiktokSyncPhase; onRetry?: () => void; reconnectHref?: string; headerAction?: React.ReactNode }) {
  if (phase === "reauth_required") return <WorkspaceFrame action={headerAction}><ConnectionBroken channel="tiktok_shop" /></WorkspaceFrame>;
  const selected = syncStateContent(phase);
  const action = reconnectHref
    ? <Link className="meli-primary-action" href={reconnectHref}>Reconectar loja <span aria-hidden="true">→</span></Link>
    : onRetry ? <RetryButton onClick={onRetry} /> : <Link className="meli-primary-action" href={MANAGE_CONNECTIONS}>Gerenciar conexão</Link>;
  return <WorkspaceFrame action={headerAction}><EmptyState kind={phase === "first_sync" ? "data" : "permission"} title={selected.title} description={selected.description} action={action} /></WorkspaceFrame>;
}
