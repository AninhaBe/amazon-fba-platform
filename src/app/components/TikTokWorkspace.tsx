"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { DashboardPeriodFilter, useDashboardPeriod } from "./DashboardPeriodFilter";
import { EmptyState } from "./EmptyState";
import { DashboardSkeleton } from "./LoadingState";
import { CompactMetric, Flow, FlowExpandable, Metric } from "./Metric";
import { PageHeader } from "./PageHeader";
import { RevenueChart } from "./RevenueChart";
import { LegendaDeVendas } from "./LegendaDeVendas";
import { TopProductsRanking } from "./TopProductsRanking";
import { TikTokSaldo } from "./TikTokSaldo";
import { useAnchoredField } from "./useAnchoredField";
import { BriefingLead } from "./BriefingLead";
import { NexoDoDia } from "./NexoDoDia";
import { IntegrationDashboardFrame } from "./IntegrationDashboardFrame";
import { buildFinancialComposition, FinancialSummaryPanel } from "./FinancialSummaryPanel";
import { ConnectionBroken } from "./ConnectionBroken";
import { ChannelConnectionEmpty } from "./ChannelConnectionEmpty";
import { brDate } from "@/lib/datetime";
import { coberturaDoPeriodo, periodoDaQuery } from "@/lib/coberturaPeriodo";
import { SincronizacaoCompleta } from "./SincronizacaoCompleta";
import { marginMetricTone } from "@/lib/marginTone";
import { BaseDeData, ProgressoDaImportacao } from "./BaseDeData";
import {
  coverageDescription,
  effectiveTiktokDashboardPhase,
  financialCards,
  historicalBacklogDescription,
  orderedTiktokConnections,
  resolveTiktokConnection,
  shouldCanonicalizeTiktokUrl,
  syncStateContent,
  tiktokSyncErrorContent,
  syncBacklogDescription,
  parseTaxRateDraft,
  tiktokConnectionError,
  tiktokOverviewQuery,
  tiktokMotivoSemLucro,
  tiktokOrderStatusLabel,
  tiktokPageHref,
  tiktokPendencias,
  tiktokProductsHref,
  tiktokResultadoFechado,
  tiktokSettingsQuery,
  tiktokTaxSettingsHref,
  TIKTOK_TAX_SETTINGS_ANCHOR,
  type TiktokConnectionOption,
  type TiktokPendencia,
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
  const [overviewState, setOverviewState] = useState<{ connectionId: string; data: TiktokOverviewResponse; em: number } | null>(null);
  const [errorState, setErrorState] = useState<{ connectionId: string | null; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [costsOpen, setCostsOpen] = useState(false);

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
        if (!cancelled) setOverviewState({ connectionId: selectedConnectionId, data: body, em: Date.now() });
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
  // REGRA DE PRODUTO (28/08/2026, a mesma validada na Shopee): erro de sync com
  // overview cheio NÃO esconde o dashboard — vira banner interno. O takeover de
  // tela só existe quando não há dado nenhum para mostrar.
  const temDado = Boolean(data.overview && data.coverage);
  if (syncPhase === "first_sync") return <SyncState phase={syncPhase} onRetry={retry} headerAction={selector} />;
  if (syncPhase === "retryable_error" && !temDado) return <SyncState phase={syncPhase} onRetry={retry} headerAction={selector} syncError={data.sync.error} />;
  if (syncPhase === "reauth_required" && !temDado) return <SyncState phase={syncPhase} reconnectHref={provider.connectHref || "/api/tiktok/login"} headerAction={selector} />;
  if (syncPhase === "unavailable") return <SyncState phase={syncPhase} onRetry={retry} headerAction={selector} />;
  if (!data.overview || !data.coverage) return <SyncState phase="first_sync" onRetry={retry} headerAction={selector} />;

  // Período do filtro vs. histórico já importado (frente K): mês ainda não
  // importado nunca vira cards zerados — "não vendeu" e "não importei" são
  // fatos diferentes.
  const rangeDoFiltro = periodoDaQuery(period.query, overviewState?.em ?? 0);
  const coberturaHistorico = rangeDoFiltro ? coberturaDoPeriodo({
    periodoDeMs: rangeDoFiltro.deMs,
    periodoAteMs: rangeDoFiltro.ateMs,
    coveredFrom: data.sync.coveredFrom,
    status: data.sync.status,
  }) : null;
  if (coberturaHistorico?.periodoInteiroDescoberto) {
    const desde = coberturaHistorico.cobreDesde ? brDate(new Date(coberturaHistorico.cobreDesde)) : null;
    return (
      <IntegrationDashboardFrame
        className="channel-dashboard tiktok-dashboard-page"
        period={<DashboardPeriodFilter {...period.filterProps} />}
        header={<PageHeader eyebrow="TikTok Shop" title={data.connection.name} subtitle={data.connection.region} action={selector} />}
      >
        <EmptyState
          kind="data"
          title={coberturaHistorico.emImportacao ? "Este período ainda está sendo importado" : "Período anterior ao histórico importado"}
          description={coberturaHistorico.emImportacao
            ? `${desde ? `O histórico já cobre a partir de ${desde}. ` : ""}${data.sync.processedOrders} pedido(s) já importado(s) — este período aparece conforme o histórico avança.`
            : `O histórico importado começa em ${desde ?? "—"}. Datas anteriores não foram importadas.`}
        />
      </IntegrationDashboardFrame>
    );
  }

  const phase = effectiveTiktokDashboardPhase(syncPhase, data.financialAvailability, data.financialCoverage?.status);
  const financialBlocked = data.financialAvailability === "BLOCKED" || data.financialCoverage?.status === "blocked";
  const cards = financialCards(data.overview, data.coverage);
  const primaryCards = cards.filter((card) => TIKTOK_PRIMARY_FINANCIAL_KEYS.has(card.key));
  const componentCards = cards.filter((card) => !TIKTOK_PRIMARY_FINANCIAL_KEYS.has(card.key));
  const costCards = cards.filter((card) => !["revenue", "buyerShipping", "profit", "marginPct", "roiPct"].includes(card.key));
  // MESMA autoridade da faixa de cima: a cobertura do PERÍODO escrita pelo
  // ledger, nunca a fase do sync. Ver `tiktokResultadoFechado`.
  const resultReady = tiktokResultadoFechado(data.overview, data.coverage, financialBlocked);
  const knownCosts = resultReady && costCards.every((card) => card.raw != null && card.value !== "—")
    ? costCards.reduce((total, card) => total + Math.abs(card.raw ?? 0), 0)
    : null;
  const historicalBacklog = historicalBacklogDescription(data.coverage);
  // Pendência sem dono soa como falha nossa. Estas duas listas dizem, com número
  // e (quando há o que fazer) link, se a espera é da TikTok ou dela.
  const pendencias = tiktokPendencias(data.coverage, selectedConnectionId);
  const pendenciasDaVendedora = pendencias.filter((item) => item.espera === "vendedora");
  const pendenciasDoCanal = pendencias.filter((item) => item.espera === "canal");
  // Janela que ainda não fechou do nosso lado não entra na lista da TikTok:
  // todo período que termina hoje nasce nesse estado, e culpar o canal por isso
  // seria alarme falso diário.
  const pendenciasDaConciliacao = pendencias.filter((item) => item.espera === "conciliacao");
  const currency = data.overview.currency;
  const capturedRevenue = data.overview.revenue ?? 0;
  // A legenda sai do `statusBreakdown`, que é a contagem por status vinda do
  // canônico. "Confirmado" usa os mesmos status que compõem receita; o que não
  // é confirmado nem cancelado ainda está para fechar.
  const CONFIRMADOS = new Set(["paid", "shipped", "delivered"]);
  const porStatus = data.statusBreakdown ?? [];
  const pedidosConfirmados = porStatus.filter((i) => CONFIRMADOS.has(i.status)).reduce((t, i) => t + i.orders, 0);
  const pedidosCancelados = porStatus.filter((i) => i.status === "cancelled").reduce((t, i) => t + i.orders, 0);
  const pedidosAguardando = Math.max(0, (data.orders ?? 0) - pedidosConfirmados - pedidosCancelados);
  const formatMoney = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
  return (
    <IntegrationDashboardFrame
      className="channel-dashboard tiktok-dashboard-page"
      period={<DashboardPeriodFilter {...period.filterProps} />}
      header={<PageHeader eyebrow="TikTok Shop" title={data.connection.name} subtitle={`${data.connection.region} · ${phase === "ready" ? "Dados sincronizados" : phase === "retryable_error" || phase === "reauth_required" ? "Sincronização interrompida" : "Sincronizando"}`} action={selector} />}
    >
      <div className="dashboard-sections integration-dashboard-sections tiktok-dashboard-body">
        {/* Sync interrompido com dado na tela: banner, nunca takeover — os
            números continuam visíveis (podem estar defasados) e a ação de
            destravar mora aqui. */}
        {(syncPhase === "retryable_error" || syncPhase === "reauth_required") && (
          <AvisoDeSyncInterrompido
            phase={syncPhase}
            syncError={data.sync.error}
            onRetry={retry}
            reconnectHref={provider.connectHref || "/api/tiktok/login"}
          />
        )}
        {/* A MESMA leitura do NEXO dos outros canais — uma narracao por dia por
        workspace, nao uma por canal. So aparece se ja estiver escrita. */}
        <NexoDoDia />
        {/* Mesma abertura dos outros três canais. O TikTok é o caso mais
            extremo dessa peça: o ledger financeiro pode estar bloqueado neste
            ambiente, e a frase precisa dizer isso em vez de exibir lucro
            zerado. `lucro={null}` com o resultado ainda aberto é a tradução
            direta de `null ≠ 0` para dentro do texto.
            ⚠️ `resultReady` — a MESMA decisão do painel e dos cards. Com a fase
            do sync no lugar dela, o NEXO narrava "seu lucro continua
            desconhecido" logo acima do lucro que a própria tela exibia. */}
        <BriefingLead
          periodo={period.label}
          faturamento={data.overview?.revenue ?? null}
          pedidos={data.orders ?? 0}
          lucro={resultReady ? (data.overview?.profit ?? null) : null}
          motivoSemLucro={resultReady ? null : tiktokMotivoSemLucro((data.coverage.requestedPeriod ?? data.coverage).cogs?.missing ?? 0)}
          format={(v) => new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(v)}
          escopo="tiktok_shop"
          canalNome="TikTok Shop"
          moeda={currency}
          briefingHref="/tiktok/monitor"
          briefingLabel="Ver detalhes"
          acoes={
            data.overview?.taxRate == null
              ? [{ label: "Cadastrar alíquota", href: tiktokTaxSettingsHref(selectedConnectionId), tone: "pendencia" as const }]
              : []
          }
        />
        <SincronizacaoCompleta
          connectionId={data.connection.id}
          status={data.sync.status}
          coveredFrom={data.sync.coveredFrom}
        />

        {financialBlocked ? (
          /* Estado do AMBIENTE, nao pendencia da vendedora e nao acao de
             ninguem: nao muda enquanto o ledger nao existir. Vira linha, mesmo
             texto, colada nos numeros que ela qualifica. */
          <p className="base-de-data" role="status">
            Financeiro indisponível neste ambiente: a estrutura do ledger financeiro ainda não está disponível. Vendas e catálogo continuam visíveis, mas taxas e resultado permanecem desconhecidos; nenhum valor foi convertido em zero.
          </p>
        ) : (
          <>
            {/* Primeiro o que ela resolve hoje; depois o que só a TikTok resolve.
                A lista aparece sempre que houver pendência — inclusive quando a
                fase é "ready", porque a API pode não mandar `financialCoverage`
                e a cobertura seguir com buracos. */}
            {pendencias.length > 0 && (
              <details className="tiktok-attention-summary">
                <summary>
                  <span><strong>{pendencias.length} {pendencias.length === 1 ? "pendência" : "pendências"} no período</strong><small>Abra para separar o que depende de você, do canal ou da conciliação.</small></span>
                  <ChevronDown aria-hidden="true" />
                </summary>
                <div className="tiktok-attention-details">
                  {pendenciasDaVendedora.length > 0 && <PendenciaNotice title="Falta você cadastrar" pendencias={pendenciasDaVendedora} />}
                  {pendenciasDoCanal.length > 0 && <PendenciaNotice title="Aguardando a TikTok Shop" pendencias={pendenciasDoCanal} />}
                  {pendenciasDaConciliacao.length > 0 && <PendenciaNotice title="Aguardando o fechamento do período" pendencias={pendenciasDaConciliacao} />}
                </div>
              </details>
            )}
            {phase === "partial" && pendencias.length === 0 && (
              /* Progresso com peso de alarme virou linha discreta: mesmo texto,
                 mesma condicao, agora junto do numero que ele explica. */
              <p className="base-de-data" role="status">
                Sincronização em andamento: os números aparecem somente quando cada componente está completo. Nenhum é apresentado como definitivo antes disso.
              </p>
            )}
          </>
        )}
        {/* Mesma linha unica dos outros tres canais: o que era faixa de
            largura total agora e contexto colado na faixa de metricas. */}
        <ProgressoDaImportacao
          cobreDesde={coberturaHistorico && !coberturaHistorico.periodoCoberto ? coberturaHistorico.cobreDesde : null}
          emImportacao={coberturaHistorico?.emImportacao}
          pedidosImportados={data.sync.processedOrders}
        />
        {/* Vale para a faixa E para o painel de composicao abaixo dela: mesmo
            os valores que vem do extrato oficial entram por data do pedido. */}
        <BaseDeData base="pedido-extrato" />
        <section className="metric-grid tiktok-dashboard-metrics" aria-label="Resumo financeiro da TikTok Shop">
          {primaryCards.map((card) => <Metric key={card.key} label={card.label} value={card.value} sub={card.context} tone={card.key === "marginPct" ? marginMetricTone(card.raw) : card.key === "profit" && card.raw != null ? card.raw > 0 ? "positive" : card.raw < 0 ? "danger" : "default" : "default"} />)}
        </section>
        <section className="secondary-metrics" aria-label="Indicadores operacionais TikTok Shop">
          <CompactMetric label="Pedidos feitos" value={`${formatMoney(capturedRevenue)} · ${(data.orders ?? 0).toLocaleString("pt-BR")}`} info="Valor capturado nos pedidos e quantidade total recebida no período." />
          <CompactMetric label="Vendas" value={pedidosConfirmados.toLocaleString("pt-BR")} />
          <CompactMetric label="Unidades" value={(data.units ?? 0).toLocaleString("pt-BR")} />
          <CompactMetric label="Ticket médio" value={data.ticket == null ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(data.ticket)} />
          <CompactMetric label="Aguardando" value={pedidosAguardando.toLocaleString("pt-BR")} tone={pedidosAguardando > 0 ? "warn" : "default"} />
          <CompactMetric label="Canceladas" value={pedidosCancelados.toLocaleString("pt-BR")} tone={pedidosCancelados > 0 ? "danger" : "default"} />
        </section>
        <section className="performance-panel tiktok-performance-panel" aria-labelledby="tiktok-performance-title">
          <div className="performance-chart">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3"><div><p className="section-kicker">Desempenho diário</p><h2 id="tiktok-performance-title" className="mt-1 text-lg font-semibold text-[var(--ink)]">Evolução do faturamento operacional</h2></div><span className="text-xs text-[var(--ink-muted)]">Valores de pedidos do período; não substituem o ledger financeiro.</span></div>
            {/* Mesma legenda dos outros três canais, montada a partir do
                `statusBreakdown`: confirmado é o que já conta como receita,
                cancelado é explícito, e o resto é o que ainda não fechou. */}
            <LegendaDeVendas
              confirmados={{ pedidos: pedidosConfirmados, valor: capturedRevenue }}
              aguardando={{ pedidos: pedidosAguardando, valor: null }}
              cancelados={{ pedidos: pedidosCancelados }}
              nota="A TikTok só posta o extrato depois de a entrega fechar; até lá o pedido conta como venda, mas o valor final ainda pode mudar."
              money={(valor) => new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(valor)}
            />
            <RevenueChart points={data.dailySeries ?? []} currency={currency} explorable />
          </div>
          <FinancialSummaryPanel
            complete={resultReady}
            labelledBy="tiktok-result-title"
            description={resultReady ? "Valores oficiais da janela selecionada." : "A composição permanece aberta até o ledger financeiro cobrir todos os componentes."}
            total={capturedRevenue}
            totalLabel={resultReady ? "Faturamento" : "Faturamento capturado"}
            format={formatMoney}
            slices={buildFinancialComposition({
              total: capturedRevenue,
              costs: costCards.map((card) => ({ id: card.key, label: card.label, value: card.raw })),
              result: resultReady ? data.overview.profit : null,
              resultLabel: "Lucro",
            })}
            footer={(
              <>
                <Link href={`/tiktok/financeiro?${new URLSearchParams({ connection_id: selectedConnectionId })}`} className="meli-financial-link">Ver composição completa no financeiro <span aria-hidden="true">→</span></Link>
                <Link href={data.overview.taxRate == null ? tiktokTaxSettingsHref(selectedConnectionId) : tiktokProductsHref(selectedConnectionId)} className="meli-financial-link">{data.overview.taxRate == null ? "Cadastrar alíquota" : "Configurar custos e imposto"} <span aria-hidden="true">→</span></Link>
                {!resultReady ? <p className="text-xs leading-relaxed text-amber-700">O NEXO não estima o que falta: componente que a TikTok ainda não postou e SKU sem custo cadastrado continuam como “—”.</p> : null}
              </>
            )}
          >
              <Flow label={resultReady ? "Faturamento" : "Faturamento capturado"} value={data.overview.revenue == null ? "—" : formatMoney(data.overview.revenue)} />
              <FlowExpandable
                label="Custos do canal e do produto"
                value={knownCosts == null ? "—" : formatMoney(knownCosts)}
                open={costsOpen}
                onToggle={() => setCostsOpen((open) => !open)}
                items={costCards.map((card) => ({ label: card.label, value: card.value }))}
              />
              <Flow label={resultReady ? "Lucro" : "Lucro indisponível"} value={resultReady ? primaryCards.find((card) => card.key === "profit")?.value ?? "—" : "—"} sign="=" accent tone={!resultReady ? "default" : data.overview.profit! > 0 ? "positive" : data.overview.profit! < 0 ? "danger" : "default"} />
              <Flow
                label="Margem"
                value={resultReady ? primaryCards.find((card) => card.key === "marginPct")?.value ?? "—" : "—"}
                accent
                tone={!resultReady ? "default" : marginMetricTone(data.overview.marginPct)}
              />
          </FinancialSummaryPanel>
        </section>
        <div className="tiktok-dashboard-drilldowns">
          <details className="tiktok-financial-components">
            <summary><span>Componentes financeiros do período</span><small>{componentCards.length} valores preservados no detalhamento</small><ChevronDown aria-hidden="true" /></summary>
            <dl>
              {componentCards.map((card) => <div key={card.key}><dt>{card.label}</dt><dd className="tabular-nums">{card.value}</dd><small>{card.context}</small></div>)}
            </dl>
          </details>
          <details className="tiktok-financial-components">
            <summary><span>Distribuição dos pedidos</span><small>{porStatus.length} status informados pela TikTok Shop</small><ChevronDown aria-hidden="true" /></summary>
            <dl>
              {porStatus.map((item) => <div key={item.status}><dt>{tiktokOrderStatusLabel(item.status)}</dt><dd className={item.status === "cancelled" ? "tabular-nums text-[var(--danger)]" : "tabular-nums"}>{item.orders.toLocaleString("pt-BR")}</dd></div>)}
            </dl>
          </details>
        </div>
        <TopProductsRanking
          products={(data.topProducts ?? []).map((product) => ({ sku: product.sku || product.productId, title: product.title, units: product.units, revenue: product.revenue, marginPct: null }))}
          currency={currency}
          productsHref={`/tiktok/catalogo?${new URLSearchParams({ connection_id: selectedConnectionId })}`}
        />
        {/* Mesma posição do bloco da Amazon e do Mercado Livre: logo depois da
            conversa sobre dinheiro, respondendo o que o lucro sozinho deixa no
            ar — "então cadê?". O TikTok segura cada venda até fechar o extrato,
            e só aí emite o repasse com data. */}
        <TikTokSaldo connectionId={selectedConnectionId} />
        <TikTokOperations>
        <section className="tiktok-sync-panel" aria-labelledby="tiktok-sync-coverage-title">
          <div className="mb-4"><p className="section-kicker">Sincronização geral</p><h2 id="tiktok-sync-coverage-title" className="mt-1 text-lg font-semibold text-[var(--ink)]">Importação e backlog histórico</h2><p className="mt-1 max-w-3xl text-sm leading-relaxed text-[var(--ink-muted)]">O backlog financeiro inclui pedidos históricos, inclusive fora da janela selecionada. Ele não é comparado com os denominadores do período abaixo.</p></div>
          <dl className="tiktok-sync-grid">{syncBacklogDescription(data.sync).filter((item) => item.key !== "financial").map((item) => <div key={item.key}><dt>{item.label}</dt><dd><span>{item.status}</span> · {item.detail}</dd></div>)}<div className="is-warning"><dt>{historicalBacklog.label}</dt><dd><span>{historicalBacklog.status}</span> · <span className="tabular-nums">{historicalBacklog.detail}</span><small>{historicalBacklog.context}</small></dd></div></dl>
        </section>
        <TikTokFinancialSettings key={selectedConnectionId} connectionId={selectedConnectionId} currentTaxRate={data.overview.taxRate} onSaved={retry} />
        <section className="tiktok-coverage-panel" aria-labelledby="tiktok-coverage-title">
          <div className="mb-4">
            <p className="section-kicker">Período selecionado</p>
            <h2 id="tiktok-coverage-title" className="mt-1 text-lg font-semibold text-[var(--ink)]">Cobertura financeira da janela</h2>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-[var(--ink-muted)]">Cada razão usa sua unidade real: pedidos, unidades ou o período. Valores capturados são evidência e nunca substituem o total oficial, que permanece “—” até a cobertura ficar completa.</p>
          </div>
          <dl className="tiktok-coverage-grid">
            {coverageDescription(data.coverage, currency).map((item) => <div key={item.key}><dt>{item.label}</dt><dd><span>{item.status}</span> · <span className="tabular-nums">{item.detail}</span>{item.captured && <small>{item.captured}</small>}</dd></div>)}
          </dl>
        </section>
        </TikTokOperations>
        <div className="tiktok-detail-grid">
          <section className="tiktok-detail-panel" aria-labelledby="tiktok-orders-title">
            <h2 id="tiktok-orders-title" className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Pedidos e rentabilidade</h2>
            {!data.orderProfitability?.length ? <EmptyState compact title="Nenhum pedido no período" /> : <ul className="divide-y divide-[var(--line)]">
              {data.orderProfitability.slice(0, 8).map((order) => <li key={order.orderId} className="flex items-center justify-between gap-4 py-3 text-sm">
                <span className="min-w-0"><strong className="block truncate font-mono text-xs text-[var(--ink-soft)]">#{order.orderId}</strong><small className="text-[var(--ink-muted)]">{brDate(order.occurredAt)} · {order.financialStatus === "complete" ? "conciliado" : order.financialStatus === "partial" ? "falta custo cadastrado" : "aguardando o extrato da TikTok"}</small></span>
                <span className="shrink-0 text-right"><strong className="block tabular-nums">{new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(order.revenue)}</strong><small className={order.profit == null ? "text-[var(--ink-muted)]" : "text-emerald-700"}>{order.profit == null ? "Lucro —" : `${new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(order.profit)}${order.financialStatus === "complete" ? "" : " (sem repasse)"}`}</small></span>
              </li>)}
            </ul>}
          </section>
          <section className="tiktok-detail-panel" aria-labelledby="tiktok-catalog-title">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3"><div><h2 id="tiktok-catalog-title" className="text-sm font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Catálogo e estoque</h2><p className="mt-1 text-xs text-[var(--ink-muted)]">Quantidade disponível informada pelo catálogo da TikTok Shop.</p></div><Link className="min-h-10 rounded-lg px-3 py-2 text-sm font-semibold text-[var(--acao)] transition-[background-color,color] hover:bg-[var(--brand-soft)] active:scale-[0.96]" href={tiktokProductsHref(selectedConnectionId)}>Gerenciar custos <span aria-hidden="true">→</span></Link></div>
            {!data.catalog?.length ? <EmptyState compact title="Nenhum produto sincronizado" /> : <ul className="divide-y divide-[var(--line)]">
              {data.catalog.slice(0, 8).map((product) => <li key={`${product.id}:${product.sku || ""}`} className="flex items-center justify-between gap-4 py-3 text-sm"><span className="min-w-0"><strong className="block truncate" title={product.title}>{product.title}</strong><small className="text-[var(--ink-muted)]">{product.sku || "Sem SKU"} · {product.status}</small></span><span className={`shrink-0 font-semibold tabular-nums ${product.availableQty === 0 ? "text-red-600" : "text-[var(--ink-soft)]"}`}>{product.availableQty} un.</span></li>)}
            </ul>}
          </section>
        </div>
      </div>
    </IntegrationDashboardFrame>
  );
}

function TikTokOperations({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const syncWithHash = () => {
      if (window.location.hash === `#${TIKTOK_TAX_SETTINGS_ANCHOR}`) setOpen(true);
    };
    const syncWithLink = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLAnchorElement>("a[href]");
      if (link && new URL(link.href, window.location.href).hash === `#${TIKTOK_TAX_SETTINGS_ANCHOR}`) setOpen(true);
    };
    syncWithHash();
    window.addEventListener("hashchange", syncWithHash);
    document.addEventListener("click", syncWithLink);
    return () => {
      window.removeEventListener("hashchange", syncWithHash);
      document.removeEventListener("click", syncWithLink);
    };
  }, []);
  return (
    <details className="tiktok-operations-disclosure" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <span><strong>Operação e sincronização</strong><small>Backlog, cobertura financeira e configurações da loja</small></span>
        <ChevronDown aria-hidden="true" />
      </summary>
      <div className="tiktok-operations-content">{children}</div>
    </details>
  );
}

function TikTokFinancialSettings({ connectionId, currentTaxRate, onSaved }: { connectionId: string; currentTaxRate: number | null; onSaved: () => void }) {
  const [draft, setDraft] = useState(currentTaxRate == null ? "" : String(currentTaxRate));
  const [state, setState] = useState<"loading" | "idle" | "saving" | "saved" | "error">("loading");
  const [message, setMessage] = useState("");
  const inputRef = useAnchoredField(TIKTOK_TAX_SETTINGS_ANCHOR, state !== "loading");
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
  return <section className="tiktok-settings-panel" id={TIKTOK_TAX_SETTINGS_ANCHOR} aria-labelledby="tiktok-financial-settings-title"><div className="tiktok-settings-heading"><div><p className="section-kicker">Configuração da loja</p><h2 id="tiktok-financial-settings-title">Imposto e custos dos produtos</h2><p>A alíquota é aplicada ao faturamento desta loja. Sem alíquota ou custo por SKU, imposto, lucro, margem e ROI permanecem “—”.</p></div><Link href={tiktokProductsHref(connectionId)} className="meli-primary-action">Cadastrar custos</Link></div><form onSubmit={submit} className="tiktok-tax-form"><label><span>Alíquota de imposto (%)</span><input ref={inputRef} type="number" inputMode="decimal" min="0" max="100" step="0.01" value={draft} onChange={(event) => { setDraft(event.target.value); if (state === "error" || state === "saved") { setState("idle"); setMessage(""); } }} disabled={state === "loading" || state === "saving"} aria-describedby="tiktok-tax-help tiktok-tax-status" placeholder="Não configurada" /></label><button type="submit" disabled={state === "loading" || state === "saving"} className="meli-primary-action">{state === "saving" ? "Salvando…" : "Salvar alíquota"}</button><p id="tiktok-tax-help">Informe 0 somente quando zero for um fato contábil.</p><p id="tiktok-tax-status" role={state === "error" ? "alert" : "status"} aria-live="polite" className={state === "error" ? "is-error" : "is-success"}>{state === "loading" ? "Carregando alíquota…" : message}</p></form></section>;
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


/**
 * A pendência diz o que falta, com número, e só oferece link quando existe algo
 * a fazer. O que depende da TikTok sai sem botão de propósito: ação para o que
 * ela não controla seria promessa falsa.
 */
function PendenciaNotice({ title, pendencias }: { title: string; pendencias: TiktokPendencia[] }) {
  return (
    <aside className="channel-module-notice is-warning" role="status">
      <strong>{title}</strong>
      <ul className="mt-1 space-y-1 text-[var(--ink-muted)]">
        {pendencias.map((item) => (
          <li key={item.key}>
            <span className="tabular-nums">{item.text}</span>
            {item.action ? <> · <Link href={item.action.href} className="font-semibold text-[var(--acao)] underline-offset-2 hover:underline">{item.action.label} <span aria-hidden="true">→</span></Link></> : null}
          </li>
        ))}
      </ul>
    </aside>
  );
}

/**
 * Banner interno para sync interrompido COM dashboard cheio atrás (regra de
 * produto de 28/08/2026, a mesma da Shopee): erro não engole a tela — os
 * números seguem visíveis e a ação de destravar fica no aviso.
 */
function AvisoDeSyncInterrompido({ phase, syncError, onRetry, reconnectHref }: { phase: "retryable_error" | "reauth_required"; syncError?: TiktokOverviewResponse["sync"]["error"]; onRetry: () => void; reconnectHref: string }) {
  if (phase === "reauth_required") {
    return (
      <aside role="alert" className="channel-module-notice is-warning">
        <strong>Autorização da loja expirou</strong>
        <p>
          A sincronização parou e os números abaixo podem estar defasados.{" "}
          <Link className="text-[var(--acao)] underline" href={reconnectHref}>Reconectar loja <span aria-hidden="true">→</span></Link>
        </p>
      </aside>
    );
  }
  const detalhe = tiktokSyncErrorContent(syncError ?? null);
  return (
    <aside role="alert" className="channel-module-notice is-warning">
      <strong>{detalhe.title}</strong>
      <p>
        {detalhe.description}
        {detalhe.retryable !== false && <>{" "}<button type="button" className="text-[var(--acao)] underline" onClick={onRetry}>Tentar novamente</button></>}
      </p>
    </aside>
  );
}

function SyncState({ phase, onRetry, reconnectHref, headerAction, syncError }: { phase: TiktokSyncPhase; onRetry?: () => void; reconnectHref?: string; headerAction?: React.ReactNode; syncError?: TiktokOverviewResponse["sync"]["error"] }) {
  if (phase === "reauth_required") return <WorkspaceFrame action={headerAction}><ConnectionBroken channel="tiktok_shop" /></WorkspaceFrame>;
  // Em `retryable_error` o motivo importa: status novo da API não se resolve
  // tentando de novo, e oferecer o botão de repetir esconderia isso.
  const detailed = phase === "retryable_error" ? tiktokSyncErrorContent(syncError ?? null) : null;
  const selected = detailed ?? syncStateContent(phase);
  const action = reconnectHref
    ? <Link className="meli-primary-action" href={reconnectHref}>Reconectar loja <span aria-hidden="true">→</span></Link>
    : onRetry && detailed?.retryable !== false ? <RetryButton onClick={onRetry} /> : <Link className="meli-primary-action" href={MANAGE_CONNECTIONS}>Gerenciar conexão</Link>;
  return <WorkspaceFrame action={headerAction}><EmptyState kind={phase === "first_sync" ? "data" : "permission"} title={selected.title} description={selected.description} action={action} /></WorkspaceFrame>;
}
