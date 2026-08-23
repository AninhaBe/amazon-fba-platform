"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AnimatedNumber } from "./components/AnimatedNumber";
import { PageHeader, pageIcons } from "./components/PageHeader";
import { DashboardSkeleton } from "./components/LoadingState";
import { MarketplaceIcon } from "./components/MarketplaceIcon";
import { Metric } from "./components/Metric";
import { RevenueChart, type DailyPoint } from "./components/RevenueChart";
import { brTime } from "@/lib/datetime";
import { tendenciaSemanal, detectarAlerta, leituraRapidaDosCanais, margemDoCanal, percent } from "@/lib/centralOverview";
import { NexoMensagem } from "./components/NexoMensagem";
import { gatherCentralChannels, type ChannelSnapshot } from "./centralChannels";

function money(value: number | null, currency = "BRL") {
  if (value == null) return "Indisponível";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
}

function QuickReadItem({
  label,
  channel,
  detail,
  tone = "default",
  emptyLabel,
}: {
  label: string;
  channel: ChannelSnapshot | null;
  detail?: string;
  tone?: "default" | "positive" | "negative";
  emptyLabel: string;
}) {
  return (
    <div className={`central-quick-read-item is-${tone}`}>
      <dt>{label}</dt>
      <dd>
        {channel ? (
          <Link href={channel.href} aria-label={`${label}: ${channel.name}. Abrir canal`}>
            <MarketplaceIcon provider={channel.id} size={18} />
            <span><strong>{channel.name}</strong>{detail ? <small>{detail}</small> : null}</span>
            <b aria-hidden="true">→</b>
          </Link>
        ) : (
          <span className="central-quick-read-empty"><i aria-hidden="true">—</i><strong>{emptyLabel}</strong></span>
        )}
      </dd>
    </div>
  );
}

// Escopo de módulo: ao navegar para um canal e voltar, a central renderiza o
// consolidado já conhecido no primeiro paint e revalida em segundo plano.
let centralCache: { channels: ChannelSnapshot[]; series: DailyPoint[]; updatedAt: Date } | null = null;

export default function OverviewDashboard() {
  const [channels, setChannels] = useState<ChannelSnapshot[]>(centralCache?.channels ?? []);
  const [series, setSeries] = useState<DailyPoint[]>(centralCache?.series ?? []);
  const [chartChannel, setChartChannel] = useState<"todos" | ChannelSnapshot["id"]>("todos");
  const [loading, setLoading] = useState(!centralCache);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(centralCache?.updatedAt ?? null);
  // Narração do dia gerada por modelo (Gemini). Fica null sem chave ou enquanto
  // não responde, e aí a tela usa o alerta por regra.
  const [narracao, setNarracao] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      try {
        const { channels: coletados, series: merged } = await gatherCentralChannels();
        const refreshedAt = new Date();
        centralCache = { channels: coletados, series: merged, updatedAt: refreshedAt };
        setChannels(coletados);
        setSeries(merged);
        setUpdatedAt(refreshedAt);
      } catch {
        if (!centralCache) setChannels([]);
      } finally {
        setLoading(false);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);


  const totals = useMemo(() => channels.reduce((summary, channel) => {
    if (channel.revenue != null) summary.revenue += channel.revenue;
    if (channel.profit != null) { summary.profit += channel.profit; summary.profitSources += 1; }
    if (channel.orders != null) summary.orders += channel.orders;
    if (channel.connected) summary.connected += 1;
    return summary;
  }, { revenue: 0, profit: 0, profitSources: 0, orders: 0, connected: 0 }), [channels]);
  const maxRevenue = Math.max(...channels.map((channel) => channel.revenue ?? 0), 1);

  // Feature 1: variação do consolidado na semana, da própria série já carregada.
  const tendenciaTotal = useMemo(() => tendenciaSemanal(series), [series]);
  // Feature 2: a única frase de alerta, priorizada.
  const alerta = useMemo(() => detectarAlerta(channels), [channels]);
  // Feature 3: margem consolidada, só sobre canais com lucro E faturamento conhecidos.
  const margemTotal = useMemo(() => {
    let revenue = 0;
    let profit = 0;
    let algum = false;
    for (const channel of channels) {
      if (channel.profit != null && channel.revenue != null && channel.revenue > 0) {
        revenue += channel.revenue;
        profit += channel.profit;
        algum = true;
      }
    }
    // Devolve TAMBÉM a base, não só o percentual. A margem aqui já era calculada
    // certo (só canais com lucro conhecido), mas o snapshot mandava ao modelo o
    // faturamento TOTAL ao lado dela — e ele leu "margem 0,7%" como resultado da
    // operação inteira (23/08/2026). Percentual sem base é meia informação.
    return {
      pct: algum && revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : null,
      base: algum ? revenue : null,
    };
  }, [channels]);
  // Feature 4: qual série o gráfico mostra — todos (soma) ou um canal.
  const serieExibida = useMemo(() => {
    if (chartChannel === "todos") return series;
    return channels.find((channel) => channel.id === chartChannel)?.series ?? [];
  }, [chartChannel, channels, series]);
  const canaisComSerie = useMemo(() => channels.filter((channel) => channel.series?.length), [channels]);
  const leituraRapida = useMemo(() => leituraRapidaDosCanais(channels), [channels]);

  // Monta o snapshot do que a central já calculou e pede a narração do dia. O
  // modelo só recebe números prontos — não consulta nada. Servidor cacheia por
  // dia, então isto é uma chamada barata (e sem chave, volta null em silêncio).
  useEffect(() => {
    if (loading) return;
    const conectados = channels.filter((c) => c.connected);
    if (!conectados.length) return;
    const snapshot = {
      data: "",
      moeda: "BRL",
      faturamento30d: totals.revenue,
      lucro30d: totals.profitSources ? totals.profit : null,
      margemPct: margemTotal.pct,
      receitaComLucro: margemTotal.base,
      variacaoSemanaPct: tendenciaTotal.deltaPct,
      canais: conectados.map((c) => ({
        nome: c.name,
        faturamento: c.revenue,
        lucro: c.profit,
        margemPct: margemDoCanal(c),
        variacaoSemanaPct: tendenciaSemanal(c.series).deltaPct,
        semLeitura: !!c.error,
        unidadesSemCusto: c.unitsWithoutCost ?? 0,
      })),
    };
    let cancelado = false;
    fetch("/api/central/briefing", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(snapshot) })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelado && d?.texto) setNarracao(d.texto as string); })
      .catch(() => {});
    return () => { cancelado = true; };
  }, [loading, channels, totals, margemTotal, tendenciaTotal]);

  return (
    <div className="overview-page channel-dashboard">
      <PageHeader eyebrow="Central multicanal" title="Visão geral" subtitle="Acompanhe sua operação inteira e entre em cada canal quando precisar dos detalhes próprios da plataforma." icon={pageIcons.dashboard} action={updatedAt && <span className="data-freshness">Atualizado às {brTime(updatedAt)}</span>} />
      {loading ? <DashboardSkeleton label="Consolidando seus canais" chart={false} rows={2} /> : channels.length === 0 ? (
        <section className="central-empty"><span>SC</span><div><p className="section-kicker">Primeira conexão</p><h2>Monte sua central de vendas</h2><p>Conecte Amazon, Mercado Livre, Shopee ou TikTok Shop para começar a consolidar faturamento e pedidos.</p></div><Link href="/integracoes">Conectar um canal <b aria-hidden="true">→</b></Link></section>
      ) : <div className="dashboard-sections channel-dashboard-sections">
        {/* A narração do modelo tem prioridade; sem ela (sem chave ou sem
            resposta), cai no alerta por regra. Os dois respondem "o que mudou e
            onde olhar" — um em prosa, o outro em uma linha. */}
        {narracao ? (
          <NexoMensagem texto={narracao} ctaHref="/briefing" />
        ) : alerta ? (
          <Link href={alerta.href ?? "#"} className={`central-alerta is-${alerta.tom}`} aria-label={alerta.texto}>
            <span aria-hidden="true" className="central-alerta-ponto" />
            <span className="central-alerta-texto">{alerta.texto}</span>
            {alerta.href && <span aria-hidden="true" className="central-alerta-seta">→</span>}
          </Link>
        ) : null}
        {/* Uma faixa contínua responde primeiro “quanto, quanto sobrou e onde”.
            Nenhum indicador ganha um card próprio ou um número desproporcional. */}
        <section className="metric-grid central-summary-band" aria-label="Indicadores consolidados">
          <Metric
            label="Faturamento conhecido"
            value={<AnimatedNumber id="central-revenue" value={totals.revenue} format={(amount) => money(amount)} />}
            sub={tendenciaTotal.deltaPct == null
              ? "Soma dos canais com dados"
              : `${tendenciaTotal.deltaPct >= 0 ? "▲" : "▼"} ${percent(Math.abs(tendenciaTotal.deltaPct))} vs. semana anterior`}
            className={`central-summary-revenue${tendenciaTotal.deltaPct == null ? "" : tendenciaTotal.deltaPct >= 0 ? " is-positive" : " is-negative"}`}
          />
          <Metric
            label="Lucro conhecido"
            value={totals.profitSources ? <AnimatedNumber id="central-profit" value={totals.profit} format={(amount) => money(amount)} /> : "—"}
            sub={`${totals.profitSources} de ${totals.connected} canais com cálculo`}
            tone={!totals.profitSources ? "default" : totals.profit > 0 ? "positive" : totals.profit < 0 ? "danger" : "default"}
          />
          <Metric
            label="Margem consolidada"
            value={margemTotal.pct == null ? "—" : percent(margemTotal.pct)}
            // A legenda nomeia a BASE em reais. "Faturamento conhecido" era vago
            // demais para quem olha um faturamento total muito maior logo ao lado.
            sub={
              margemTotal.pct == null
                ? "Aguardando lucro dos canais"
                : margemTotal.base != null && margemTotal.base < totals.revenue
                  ? `Sobre ${money(margemTotal.base)} — a parte com custo cadastrado`
                  : "Lucro sobre o faturamento"
            }
            tone={margemTotal.pct == null ? "default" : margemTotal.pct > 0 ? "positive" : margemTotal.pct < 0 ? "danger" : "default"}
          />
          <Metric label="Pedidos" value={totals.orders.toLocaleString("pt-BR")} sub="Últimos 30 dias" />
          <Metric label="Canais ativos" value={`${totals.connected} de ${channels.length}`} sub="Contas conectadas agora" />
        </section>

        <section className="central-channel-section" aria-labelledby="channel-comparison-title">
          <div className="central-section-heading"><div><p className="section-kicker">Comparação por canal</p><h2 id="channel-comparison-title">Onde sua operação acontece</h2></div><p>Valores indisponíveis permanecem explícitos e nunca entram como zero no consolidado.</p></div>
          <div className="central-channel-layout">
            <div className="channel-comparison-table" role="table" aria-label="Comparação de canais">
              <div className="channel-comparison-head" role="row"><span role="columnheader">Canal</span><span role="columnheader">Faturamento conhecido</span><span role="columnheader">Pedidos</span><span role="columnheader">Resultado</span><span role="columnheader">Margem</span><span role="columnheader"><span className="sr-only">Ação</span></span></div>
              {channels.map((channel) => (
                <div key={channel.id} className={`channel-comparison-row is-${channel.id}`} role="row">
                  <div className="channel-comparison-identity" role="cell"><span aria-hidden="true"><MarketplaceIcon provider={channel.id} size={28} app /></span><div><strong>{channel.name}</strong><small>{channel.attention ? "Canal temporariamente indisponível" : !channel.connected ? "Aguardando conexão" : channel.error ? "Conectado, sem leitura" : channel.error || channel.note}</small></div><em className={`channel-health${channel.connected && !channel.error ? " is-connected" : ""}`}>{channel.attention ? "Atenção" : !channel.connected ? "Conectar" : channel.error ? "Atenção" : "Ativo"}</em></div>
                  <div className="channel-comparison-revenue" role="cell"><strong>{channel.connected && !channel.error ? money(channel.revenue, channel.currency) : "—"}</strong><span aria-label={`Participação relativa de ${channel.name}`}><i style={{ width: `${channel.connected ? ((channel.revenue ?? 0) / maxRevenue) * 100 : 0}%` }} /></span></div>
                  <div className="channel-comparison-number is-orders" role="cell"><strong>{channel.orders?.toLocaleString("pt-BR") ?? "—"}</strong><small>últimos 30 dias</small></div>
                  <div className="channel-comparison-number is-result" role="cell"><strong className={channel.profit == null ? undefined : channel.profit < 0 ? "is-negative" : "is-positive"}>{channel.connected ? money(channel.profit, channel.currency) : "—"}</strong><small>{channel.profitPartial ? "faltam custos" : "lucro conhecido"}{channel.cancelled != null && channel.cancelled > 0 ? ` · ${money(channel.cancelled, channel.currency)} canceladas` : ""}</small></div>
                  <div className="channel-comparison-number is-margin" role="cell">{(() => { const m = margemDoCanal(channel); return <><strong className={m == null ? undefined : m < 0 ? "is-negative" : "is-positive"}>{channel.connected && m != null ? percent(m) : "—"}</strong><small>{channel.profitPartial ? "faltam custos" : "sobre faturamento"}</small></>; })()}</div>
                  <div className="channel-comparison-action" role="cell"><Link href={channel.connected && !channel.attention ? channel.href : "/integracoes"} aria-label={channel.attention ? `Revisar integração ${channel.name}` : channel.connected ? `Abrir ${channel.name}` : `Conectar ${channel.name}`} title={channel.attention ? "Revisar integração" : channel.connected ? `Abrir ${channel.name}` : `Conectar ${channel.name}`}>→</Link></div>
                </div>
              ))}
            </div>

            <aside className="central-quick-read" aria-labelledby="central-quick-read-title">
              <header><p className="section-kicker">Leitura rápida</p><h3 id="central-quick-read-title">O que pede atenção</h3></header>
              <dl>
                <QuickReadItem
                  label="Maior faturamento"
                  channel={leituraRapida.maiorFaturamento}
                  detail={leituraRapida.maiorFaturamento ? money(leituraRapida.maiorFaturamento.revenue, leituraRapida.maiorFaturamento.currency) : undefined}
                  emptyLabel="Faturamento ainda desconhecido"
                />
                <QuickReadItem
                  label="Maior ritmo"
                  channel={leituraRapida.maiorAlta?.canal ?? null}
                  detail={leituraRapida.maiorAlta ? `+${percent(leituraRapida.maiorAlta.variacaoPct)} na semana` : undefined}
                  tone="positive"
                  emptyLabel={leituraRapida.canaisComTendencia ? "Nenhuma alta medida" : "Sem duas semanas de base"}
                />
                <QuickReadItem
                  label="Queda no período"
                  channel={leituraRapida.maiorQueda?.canal ?? null}
                  detail={leituraRapida.maiorQueda ? `${percent(leituraRapida.maiorQueda.variacaoPct)} na semana` : undefined}
                  tone={leituraRapida.maiorQueda ? "negative" : "default"}
                  emptyLabel={leituraRapida.canaisComTendencia ? "Nenhuma queda medida" : "Sem duas semanas de base"}
                />
              </dl>
              <p>{totals.orders.toLocaleString("pt-BR")} pedidos conhecidos vistos como uma única operação.</p>
            </aside>
          </div>
        </section>

        {series.length > 0 && (
          <section className="central-revenue-panel" aria-labelledby="central-revenue-title">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
              <div><p className="section-kicker">{chartChannel === "todos" ? "Todos os canais" : canaisComSerie.find((c) => c.id === chartChannel)?.name}</p><h2 id="central-revenue-title" className="mt-1 text-lg font-semibold text-[var(--ink)]">Faturamento {chartChannel === "todos" ? "consolidado" : "do canal"} por dia</h2></div>
              <span className="inline-flex flex-none items-baseline gap-1 whitespace-nowrap">
                <strong className="text-lg font-semibold tabular-nums text-[var(--ink)]">{money(serieExibida.reduce((soma, p) => soma + p.revenue, 0))}</strong>
                <span className="text-sm font-normal text-[var(--ink-muted)]">nos últimos 30 dias</span>
              </span>
            </div>
            {/* Feature 4: abrir a linha consolidada por canal — ver ONDE aconteceu. */}
            {canaisComSerie.length > 1 && (
              <div className="central-chart-tabs" role="tablist" aria-label="Ver faturamento por canal">
                <button type="button" role="tab" aria-selected={chartChannel === "todos"} className={chartChannel === "todos" ? "is-active" : ""} onClick={() => setChartChannel("todos")}>Todos</button>
                {canaisComSerie.map((channel) => (
                  <button key={channel.id} type="button" role="tab" aria-selected={chartChannel === channel.id} className={chartChannel === channel.id ? "is-active" : ""} onClick={() => setChartChannel(channel.id)}>{channel.name}</button>
                ))}
              </div>
            )}
            <RevenueChart key={chartChannel} points={serieExibida} explorable />
          </section>
        )}

      </div>}
    </div>
  );
}
