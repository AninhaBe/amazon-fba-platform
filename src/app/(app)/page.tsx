"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AnimatedNumber } from "../components/AnimatedNumber";

// A central TEM seletor de periodo desde 31/08/2026 (pedido da Ana: "coloque um
// filtro para data personalizada"). Antes disso a janela era fixa em 30 dias,
// escrita como literal no coletor — e foi por isso que a troca do padrao para
// "Hoje" nao alcancou esta tela: ela nao usava o hook do filtro.
//
// A identidade do periodo alimenta o AnimatedNumber: mesmo recorte com valor
// novo anima; recorte diferente nao. Por isso ela agora carrega a query.
import { PageHeader, pageIcons } from "../components/PageHeader";
import { DashboardPeriodFilter, useDashboardPeriod } from "../components/DashboardPeriodFilter";
import { usePrefetchDePeriodos } from "../components/prefetchDePeriodos";
import { chaveDeVoo, controleDoEscopo } from "../components/controleDeVoo";
import { DashboardSkeleton } from "../components/LoadingState";
import { MarketplaceIcon } from "../components/MarketplaceIcon";
import { Metric } from "../components/Metric";
import { RevenueChart, type DailyPoint } from "../components/RevenueChart";
import { brTime } from "@/lib/datetime";
import { tendenciaSemanal, detectarAlerta, leituraRapidaDosCanais, margemDoCanal, percent } from "@/lib/centralOverview";
import { NexoMensagem } from "../components/NexoMensagem";
import { AliquotasPorCanal } from "../components/AliquotasPorCanal";
import { gatherCentralChannels, type ChannelSnapshot } from "../centralChannels";
import { marginMetricTone, marginStateClass } from "@/lib/marginTone";
import { nomeDaBase } from "../components/baseDaMargem";

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
//
// ⚠️ A CHAVE CARREGA O PERÍODO desde 31/08/2026, quando a tela ganhou seletor.
// Um cache sem período pintaria o número de 30 dias sob o rótulo "Hoje" no
// primeiro quadro depois da troca — número certo, recorte errado, que é o modo
// de errar mais difícil de perceber.
const centralCache = new Map<string, { channels: ChannelSnapshot[]; series: DailyPoint[]; updatedAt: Date }>();

const ESCOPO_DA_CENTRAL = "central";

/**
 * UMA ida por período, com ou sem quem esteja olhando.
 *
 * A central junta os quatro canais numa coleta só, então duas idas do mesmo
 * período são quatro requisições duplicadas — o pior lugar do produto para
 * duplicar. `umaVezSo` faz a segunda esperar a primeira em vez de repetir.
 *
 * `aoParcial` é opcional de propósito: quem AQUECE não pinta nada (não há tela
 * esperando), e quem clicou pinta a cada canal que chega. Quem entra de carona
 * numa ida que já estava no ar não recebe os parciais — e por isso quem chama
 * pinta do cache depois do `await`, que é onde a ida sempre grava.
 */
function coletarCentral(
  query: string,
  aoParcial?: (parcial: { channels: ChannelSnapshot[]; series: DailyPoint[] }) => void,
) {
  return controleDoEscopo(ESCOPO_DA_CENTRAL).umaVezSo(chaveDeVoo(ESCOPO_DA_CENTRAL, query), async () => {
    const { channels, series } = await gatherCentralChannels(
      (parcial) => aoParcial?.(parcial),
      query,
    );
    const updatedAt = new Date();
    centralCache.set(query, { channels, series, updatedAt });
    return { channels, series, updatedAt };
  });
}

export default function OverviewDashboard() {
  const period = useDashboardPeriod();
  const emCache = centralCache.get(period.query);
  const [channels, setChannels] = useState<ChannelSnapshot[]>(emCache?.channels ?? []);
  const [series, setSeries] = useState<DailyPoint[]>(emCache?.series ?? []);
  const [chartChannel, setChartChannel] = useState<"todos" | ChannelSnapshot["id"]>("todos");
  const [loading, setLoading] = useState(!emCache);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(emCache?.updatedAt ?? null);
  /**
   * ⚠️ NÃO EXISTE MAIS ESTADO DE NARRAÇÃO AQUI — E A CHAMADA
   * ABAIXO CONTINUA OBRIGATÓRIA. Leia antes de mexer:
   *
   * A faixa do NEXO saiu da Visão geral em 24/08/2026 **a pedido dela** (ver a
   * nota no JSX abaixo): a central é tela de passagem, e a leitura do dia mora
   * no dashboard de cada canal, onde `NexoDoDia` a exibe.
   *
   * O que ficou aqui é a **GERAÇÃO**: o POST logo abaixo é quem manda o snapshot
   * multicanal para o modelo e faz o texto existir. `NexoDoDia`, nos quatro
   * canais, só LÊ o ponteiro que essa chamada escreveu
   * (`ultimaNarracao`, em `api/central/briefing/route.ts`).
   *
   * **Quem apagar a CHAMADA achando que é código morto quebra a leitura do dia
   * dos QUATRO canais de uma vez** — e o sintoma aparece longe daqui, numa tela
   * que ninguém tocou, como "a mensagem do NEXO sumiu".
   *
   * ⚠️ O QUE SAIU EM 20/09/2026, E POR QUÊ: havia um par de
   * estados (`narracao` e `narracaoCarregando`) guardados para o dia em que a
   * faixa voltasse. Ninguém os lia, e o `setNarracaoCarregando(true)` era um
   * `setState` SÍNCRONO dentro do efeito — a cascata de render que o portão de
   * CI passou a reprovar, paga em todo recálculo de `totals`/`channels` para
   * alimentar uma tela que não existe.
   *
   * Guardar estado para um futuro hipotético é o oposto de guardar a
   * capacidade: quando a faixa voltar, ela nasce com o estado dela — o que não
   * pode voltar é o POST, e é por isso que o aviso acima é sobre a chamada.
   * A forma que existia, para quem devolver: `useState<string | null>(null)`
   * alimentado no `.then` do POST, com um booleano de carregando ligado antes
   * do `fetch` e desligado no `.finally` — e aí, sem `setState` síncrono no
   * efeito: derive o "carregando" de o texto ainda não ter chegado.
   */
  /**
   * ANTECIPAÇÃO SÓ PELO TECLADO nesta tela, e a razão é medida.
   *
   * A central já guarda por período, então antecipar por PONTEIRO somaria uma
   * requisição por hover que não vira clique (3 → 4 na sessão medida em
   * 31/08/2026) — e cada ida daqui são os quatro canais. Foco não tem esse
   * problema: quem chega ao botão pelo teclado está indo ativá-lo.
   *
   * `filaDeFundo: false` pelo mesmo motivo: a fila custa três coletas por
   * sessão, sempre, mesmo que a pessoa nunca troque de período.
   */
  const { aquecerAgora } = usePrefetchDePeriodos({
    ativo: !loading,
    atual: period.query,
    escopo: ESCOPO_DA_CENTRAL,
    jaTem: (janela) => centralCache.has(janela),
    buscar: async (janela) => { await coletarCentral(janela); },
    filaDeFundo: false,
  });

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      try {
        // PINTA A CADA CANAL QUE CHEGA, não no fim.
        //
        // A central esperava os quatro e, dentro da Amazon, esperava também o
        // `/api/profit` — que pagina a SP-API ao vivo. Media 8 a 10 segundos de
        // esqueleto na primeira tela que o vendedor abre (24/08/2026). Agora os
        // cards aparecem de imediato e cada número entra no lugar dele.
        const { channels: coletados, series: merged, updatedAt: refreshedAt } = await coletarCentral(
          period.query,
          ({ channels: parciais, series: parcial }) => {
            // Cópia rasa: o coletor muta os mesmos objetos entre as emissões, e
            // sem isto o React não vê mudança de identidade e não redesenha.
            setChannels(parciais.map((canal) => ({ ...canal })));
            setSeries(parcial);
            setLoading(false);
          },
        );
        setChannels(coletados);
        setSeries(merged);
        setUpdatedAt(refreshedAt);
      } catch {
        if (!centralCache.has(period.query)) setChannels([]);
      } finally {
        setLoading(false);
      }
    }, 0);
    return () => window.clearTimeout(timer);
    // Trocar o período REBUSCA — sem esta dependência o filtro mudaria o rótulo
    // e deixaria os números do período anterior na tela.
  }, [period.query]);


  const totals = useMemo(() => channels.reduce((summary, channel) => {
    // `revenueSources` separa "somou zero" de "ninguém respondeu". Sem ele o
    // consolidado de um dia em que TODAS as leituras falharam é indistinguível
    // de um dia sem venda — e era esse zero que ia para o narrador.
    if (channel.revenue != null) { summary.revenue += channel.revenue; summary.revenueSources += 1; }
    if (channel.profit != null) { summary.profit += channel.profit; summary.profitSources += 1; }
    if (channel.orders != null) summary.orders += channel.orders;
    if (channel.connected) summary.connected += 1;
    return summary;
  }, { revenue: 0, revenueSources: 0, profit: 0, profitSources: 0, orders: 0, connected: 0 }), [channels]);
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
      // `null`, não `0`, quando nenhum canal respondeu: com zero o NEXO narrava
      // "faturamento consolidado R$ 0,00" — que é exatamente o zero que parece
      // "não vendeu nada". Com `null` o bloco financeiro some do prompt e sobram
      // as linhas por canal, que dizem o estado real de cada leitura.
      faturamento30d: totals.revenueSources ? totals.revenue : null,
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
        // A causa do travessão vem do canal; sem ela o modelo inventa uma.
        motivoSemLucro: c.profit == null ? c.motivoSemLucro ?? null : null,
      })),
    };
    const controller = new AbortController();
    // Sem `.then` de estado: o resultado não alimenta nada NESTA tela — o valor
    // desta chamada é o ponteiro que ela escreve no servidor, lido pelo
    // `NexoDoDia` dos quatro canais. Falha é silêncio, como já era.
    void fetch("/api/central/briefing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(snapshot),
      signal: controller.signal,
    }).catch(() => {});
    return () => controller.abort();
  }, [loading, channels, totals, margemTotal, tendenciaTotal]);

  return (
    <div className="overview-page channel-dashboard">
      <PageHeader eyebrow="Central multicanal" title="Visão geral" subtitle="Acompanhe sua operação inteira e entre em cada canal quando precisar dos detalhes próprios da plataforma." icon={pageIcons.dashboard} action={updatedAt && <span className="data-freshness">Atualizado às {brTime(updatedAt)}</span>} />
      {/* O MESMO seletor dos quatro canais, não um parecido: dois seletores com
          o mesmo desenho e comportamentos diferentes divergem em três meses, e
          foi assim que nasceu o `days || "30"` que sobreviveu escondido. */}
      <DashboardPeriodFilter {...period.filterProps} onIntent={aquecerAgora} intencaoPor="foco" />
      {loading ? <DashboardSkeleton label="Consolidando seus canais" chart={false} rows={2} /> : channels.length === 0 ? (
        <section className="central-empty"><span>NEXO</span><div><p className="section-kicker">Primeira conexão</p><h2>Monte sua central de vendas</h2><p>Conecte Amazon, Mercado Livre, Shopee ou TikTok Shop para começar a consolidar faturamento e pedidos.</p></div><Link href="/integracoes">Conectar um canal <b aria-hidden="true">→</b></Link></section>
      ) : <div className="dashboard-sections channel-dashboard-sections">
        {/* A narração do modelo tem prioridade; sem ela (sem chave ou sem
            resposta), cai no alerta por regra. Os dois respondem "o que mudou e
            onde olhar" — um em prosa, o outro em uma linha. */}
        {/* A faixa do NEXO SAIU daqui em 24/08/2026, a pedido dela: a Visão geral
            é tela de passagem, e o trabalho acontece no dashboard de cada canal —
            é lá que a leitura do dia aparece agora (`NexoDoDia`).
            ⚠️ A geração continua sendo disparada por esta tela (o POST abaixo):
            sem ela, ninguém escreveria o texto que os canais exibem. */}
        {alerta ? (
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
            value={<AnimatedNumber periodo={`central:${period.query}`} id="central-revenue" value={totals.revenue} format={(amount) => money(amount)} />}
            sub={tendenciaTotal.deltaPct == null
              ? "Soma dos canais com dados"
              : `${tendenciaTotal.deltaPct >= 0 ? "▲" : "▼"} ${percent(Math.abs(tendenciaTotal.deltaPct))} vs. semana anterior`}
            className={`central-summary-revenue${tendenciaTotal.deltaPct == null ? "" : tendenciaTotal.deltaPct >= 0 ? " is-positive" : " is-negative"}`}
          />
          <Metric
            label="Lucro conhecido"
            value={totals.profitSources ? <AnimatedNumber periodo={`central:${period.query}`} id="central-profit" value={totals.profit} format={(amount) => money(amount)} /> : "—"}
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
                : nomeDaBase({
                    // ⚠️ A CAUSA ERA A UNICA PARTE DA FRASE QUE DIZ O QUE FAZER, e
                    // ela quase se perdeu na refatoracao: o numero a pessoa ja ve
                    // no cartao ao lado, a causa nao esta em lugar nenhum. Por isso
                    // a peca aprendeu a segunda razao em vez de a central escrever
                    // a dela a mao.
                    baseApurada: margemTotal.base,
                    faturamentoExibido: totals.revenue,
                    custoNaoCadastrado: true,
                    moeda: "BRL",
                    prefixo: "Lucro",
                    rotuloDaBase: "o faturamento",
                  })
            }
            tone={marginMetricTone(margemTotal.pct)}
          />
          {/* ⚠️ O RÓTULO ACOMPANHA O SELETOR (01/09/2026). Era `sub="Últimos 30
              dias"` em texto fixo, escrito quando esta tela ainda não tinha
              seletor de período. Ela ganhou um em 31/08, com padrão "Hoje" —
              e desde então o card mostrava os pedidos de HOJE com a legenda de
              um mês embaixo, na primeira tela que a vendedora abre.
              `period.label` é a mesma prosa que o filtro usa ("hoje", "nos
              últimos 7 dias"), então os dois não têm como discordar. */}
          <Metric label="Pedidos" value={totals.orders.toLocaleString("pt-BR")} sub={period.label[0].toUpperCase() + period.label.slice(1)} />
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
                  <div className="channel-comparison-number is-margin" role="cell">{(() => { const m = margemDoCanal(channel); return <><strong className={marginStateClass(m)}>{channel.connected && m != null ? percent(m) : "—"}</strong><small>{channel.profitPartial ? "faltam custos" : "sobre faturamento"}</small></>; })()}</div>
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

        {/* A alíquota dos quatro canais, num lugar só. Fica na Visão geral por
            pedido dela em 26/08/2026: é configuração da operação inteira, e
            caçá-la dentro de cada canal foi o que deixou o Mercado Livre meses
            sem imposto cadastrado. UMA POR CANAL — o componente não copia
            valor de um para o outro. */}
        <AliquotasPorCanal />

      </div>}
    </div>
  );
}
