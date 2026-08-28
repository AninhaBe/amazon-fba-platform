"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader, pageIcons } from "./PageHeader";
import { NexoMensagem } from "./NexoMensagem";
import { PanelLoading } from "./LoadingState";
import { EmptyState } from "./EmptyState";
import { readJson } from "../../lib/readJson";
import { gatherCentralChannels, mergeDailySeries, type ChannelSnapshot } from "../centralChannels";
import { tendenciaSemanal, margemDoCanal } from "@/lib/centralOverview";
import { marginStateClass } from "@/lib/marginTone";

// Briefing em duas apresentações, UMA implementação (decisão da Ana em
// 27/08/2026, revendo a de 23/08): sem `canal`, é o briefing GLOBAL da Visão
// geral; com `canal`, é o briefing DO CANAL — mesmos cartões e narrador,
// escopados ao provider. Os detectores de insight hoje só cobrem a Amazon;
// canal sem detector mostra o estado honesto, nunca finge análise.

export interface BriefingCanal {
  provider: "amazon" | "mercado_livre" | "shopee" | "tiktok_shop";
  nome: string;
}

interface Insight {
  id: string;
  type: string;
  provider: string;
  entityRef?: string;
  severity: number;
  title: string;
  evidence: Record<string, unknown>;
  impact: Record<string, unknown>;
  recommendation?: string;
  actionHref?: string;
}

const CHANNEL: Record<string, string> = { amazon: "Amazon", mercado_livre: "Mercado Livre", shopee: "Shopee", tiktok_shop: "TikTok Shop" };
const TYPE_LABEL: Record<string, string> = { ruptura: "Ruptura de estoque", velocidade: "Queda de vendas", margem: "Margem apertada" };
const EVIDENCE_LABEL: Record<string, string> = {
  disponivel: "Disponível",
  aCaminho: "A caminho",
  vendasPorDia: "Vendas/dia",
  diasRestantes: "Dias restantes",
  vendidosNoPeriodo: "Vendidos (30d)",
  ultimos7d: "Últimos 7d",
  "7dAnteriores": "7d anteriores",
  quedaPct: "Queda (%)",
  receita30d: "Receita 30d (R$)",
  contribuicao30d: "Contribuição 30d (R$)",
  margemPct: "Margem (%)",
  unidades: "Unidades",
};

type BriefingFilter = "all" | "critical" | "attention" | "monitor";

const FILTERS: Array<{ key: BriefingFilter; label: string }> = [
  { key: "all", label: "Todas" },
  { key: "critical", label: "Críticas" },
  { key: "attention", label: "Atenção" },
  { key: "monitor", label: "Monitorar" },
];

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

function severityBand(severity: number): Exclude<BriefingFilter, "all"> {
  return severity >= 90 ? "critical" : severity >= 70 ? "attention" : "monitor";
}

function severityLabel(severity: number) {
  return severity >= 90 ? "Crítica" : severity >= 70 ? "Atenção" : "Monitorar";
}

function evidenceValueClass(key: string, value: unknown) {
  return key === "margemPct" && typeof value === "number" ? marginStateClass(value) : undefined;
}

export function BriefingView({ canal }: { canal?: BriefingCanal }) {
  const [insights, setInsights] = useState<Insight[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<BriefingFilter>("all");
  const [visibleLimit, setVisibleLimit] = useState(12);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Narração do NEXO (Gemini) que sintetiza os insights numa conversa. Null sem
  // chave/resposta; aí a tela mostra só os cartões, como antes.
  const [narracao, setNarracao] = useState<string | null>(null);
  // Começa true: sempre vamos tentar narrar, então mostramos o "analisando…"
  // desde o início em vez de deixar o espaço em branco durante a coleta.
  const [narracaoCarregando, setNarracaoCarregando] = useState(true);
  // Incrementar re-dispara o efeito que pede a narração ao servidor.
  const [narracaoTentativa, setNarracaoTentativa] = useState(0);
  // Financeiro — a MESMA fonte da Visão geral; no briefing de canal, só a fatia
  // daquele canal. Alimenta o NEXO para raciocinar sobre a história do dinheiro.
  const [canais, setCanais] = useState<ChannelSnapshot[] | null>(null);

  // Detecção automática existe só onde há detector implementado — hoje, os
  // quatro canais. O portão continua existindo para um canal futuro nascer
  // honesto ("nenhuma prioridade detectada ainda") em vez de fingir análise.
  const CANAIS_COM_DETECTOR = ["amazon", "mercado_livre", "shopee", "tiktok_shop"];
  const provider = canal?.provider ?? null;
  const temDetector = provider == null || CANAIS_COM_DETECTOR.includes(provider);
  const escopoNarracao = provider ?? "geral";

  const load = useCallback(async (analyze = false) => {
    setError(null);
    if (analyze) setInsights(null);
    try {
      const res = await fetch("/api/briefing", analyze ? { method: "POST" } : undefined);
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || "Não foi possível montar o briefing.");
      const lista = data.insights as Insight[];
      setInsights(provider ? lista.filter((insight) => insight.provider === provider) : lista);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro desconhecido.");
      setInsights([]);
    }
  }, [provider]);

  useEffect(() => {
    // Re-detecta ao abrir (POST) onde há detector; canal sem detector só lê —
    // rodar a detecção da Amazon a partir do briefing da Shopee seria trabalho
    // alheio disfarçado de análise do canal.
    const t = window.setTimeout(() => void load(temDetector), 0);
    // CAMINHO RÁPIDO: se o NEXO já escreveu o briefing deste escopo hoje,
    // mostra AGORA. O POST abaixo continua e corrige se os fatos mudaram.
    fetch(`/api/central/briefing?modo=briefing&escopo=${escopoNarracao}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.texto) return;
        setNarracao(d.texto as string);
        setNarracaoCarregando(false);
      })
      .catch(() => {});
    // Em paralelo, junta o financeiro (não bloqueia os insights).
    gatherCentralChannels()
      .then(({ channels }) => setCanais(provider ? channels.filter((c) => c.id === provider) : channels))
      .catch(() => setCanais([]));
    return () => window.clearTimeout(t);
  }, [escopoNarracao, load, provider, temDetector]);

  // Quando insights E financeiro chegam, o NEXO sintetiza o briefing. Recebe as
  // duas coisas — a história do dinheiro E os sinais operacionais. Só narra
  // fato; não inventa.
  useEffect(() => {
    if (insights == null || canais == null) return;
    const conectados = canais.filter((c) => c.connected);
    let revenue = 0;
    let profit = 0;
    // Receita APENAS dos canais cujo lucro é conhecido. É a base correta da
    // margem: dividir lucro parcial pela receita total produzia "margem 0,7%"
    // numa operação saudável (visto em 23/08/2026).
    let receitaComLucro = 0;
    let algumLucro = false;
    for (const c of conectados) {
      if (c.revenue != null) revenue += c.revenue;
      if (c.profit != null && c.revenue != null && c.revenue > 0) {
        profit += c.profit;
        receitaComLucro += c.revenue;
        algumLucro = true;
      }
    }
    const serieTotal = mergeDailySeries(conectados.map((c) => c.series));
    const payload = {
      modo: "briefing",
      escopo: escopoNarracao,
      data: "",
      moeda: conectados[0]?.currency ?? "BRL",
      faturamento30d: conectados.some((c) => c.revenue != null) ? revenue : null,
      lucro30d: algumLucro ? profit : null,
      margemPct: algumLucro && receitaComLucro > 0 ? Math.round((profit / receitaComLucro) * 1000) / 10 : null,
      receitaComLucro: algumLucro ? receitaComLucro : null,
      variacaoSemanaPct: tendenciaSemanal(serieTotal).deltaPct,
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
      insights: insights.slice(0, 12).map((i) => ({
        canal: CHANNEL[i.provider] ?? i.provider,
        tipo: TYPE_LABEL[i.type] ?? i.type,
        severidade: i.severity,
        titulo: i.title,
        recomendacao: i.recommendation,
      })),
    };
    let cancelado = false;
    fetch("/api/central/briefing", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelado && d?.texto) setNarracao(d.texto as string); })
      .catch(() => {})
      .finally(() => { if (!cancelado) setNarracaoCarregando(false); });
    return () => { cancelado = true; };
  }, [insights, canais, narracaoTentativa, escopoNarracao]);

  async function act(id: string, action: "dispensar" | "adiar" | "resolver") {
    setBusy(id);
    try {
      const res = await fetch("/api/briefing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, snoozeDays: 3 }),
      });
      const data = await readJson(res);
      if (res.ok) {
        const lista = data.insights as Insight[];
        setInsights(provider ? lista.filter((insight) => insight.provider === provider) : lista);
      }
    } finally {
      setBusy(null);
    }
  }

  const counts = insights?.reduce(
    (current, insight) => {
      current.all += 1;
      current[severityBand(insight.severity)] += 1;
      return current;
    },
    { all: 0, critical: 0, attention: 0, monitor: 0 } as Record<BriefingFilter, number>,
  );
  const filteredInsights = insights?.filter((insight) => filter === "all" || severityBand(insight.severity) === filter) ?? [];
  const visibleInsights = filteredInsights.slice(0, visibleLimit);

  return (
    <div className="briefing-page">
      <PageHeader
        eyebrow={canal ? `Prioridades · ${canal.nome}` : "Prioridades da operação"}
        title="Briefing"
        icon={pageIcons.chart}
        subtitle={canal
          ? `Evidência, impacto e próximo passo para o que precisa de atenção no ${canal.nome} hoje.`
          : "Evidência, impacto e próximo passo para o que realmente precisa de atenção hoje."}
      />

      {/* O NEXO abre o briefing em prosa: lê os sinais detectados e diz, do jeito
          de um colega, o que priorizar. Os cartões abaixo são a evidência. */}
      {/* Três estados, nunca ausência: texto, carregando, ou falha com botão.
          Renderizar `null` na falha era o "aparece e some" de 23/08/2026. */}
      {narracao ? (
        <NexoMensagem texto={narracao} />
      ) : narracaoCarregando ? (
        <NexoMensagem carregando />
      ) : (
        <NexoMensagem
          aoTentarDeNovo={() => {
            // Volta ao estado de carregamento aqui, no evento: sem isto o clique
            // não muda nada na tela até o servidor responder (~18s) e parece
            // que o botão não funcionou.
            setNarracaoCarregando(true);
            setNarracaoTentativa((n) => n + 1);
          }}
        />
      )}

      {error && (
        <div role="alert" className="briefing-error">
          <div><strong>Não foi possível atualizar o briefing.</strong><p>{error}</p></div>
          <button type="button" onClick={() => void load()}>Tentar novamente</button>
        </div>
      )}

      {insights == null ? (
        <div className="briefing-loading"><PanelLoading label={canal ? `Analisando o ${canal.nome}` : "Analisando sua operação"} /></div>
      ) : insights.length === 0 ? (
        <div className="briefing-empty">
          {temDetector ? (
            <EmptyState
              title="Tudo sob controle"
              description="Nenhuma prioridade exige sua atenção agora. A análise roda todo dia junto com o sync."
              action={<button type="button" onClick={() => void load(true)} className="briefing-primary-action">Analisar agora</button>}
            />
          ) : (
            // Estado honesto: o canal ainda não tem detector — dizer "tudo sob
            // controle" afirmaria uma análise que não aconteceu.
            <EmptyState
              title="Nenhuma prioridade detectada ainda para este canal"
              description={`A detecção automática (ruptura, queda de vendas e margem) ainda não roda para o ${canal!.nome}. A leitura do NEXO acima já cobre o canal; os detectores chegam por canal.`}
            />
          )}
        </div>
      ) : (
        <>
          <section className="briefing-summary" aria-labelledby="briefing-summary-title">
            <div>
              <p className="briefing-summary-label">Resumo de hoje</p>
              <h2 id="briefing-summary-title">
                {greeting()}. Há {insights.length} {insights.length === 1 ? "prioridade" : "prioridades"} para revisar.
              </h2>
              <p>Ordenadas por severidade, sempre com a evidência que sustenta cada recomendação.</p>
            </div>
            <dl className="briefing-counts" aria-label="Prioridades por severidade">
              <div className="is-critical"><dt>Críticas</dt><dd>{counts?.critical ?? 0}</dd></div>
              <div className="is-attention"><dt>Atenção</dt><dd>{counts?.attention ?? 0}</dd></div>
              <div className="is-monitor"><dt>Monitorar</dt><dd>{counts?.monitor ?? 0}</dd></div>
            </dl>
          </section>

          <section className="briefing-worklist" aria-labelledby="briefing-list-title">
            <header className="briefing-toolbar">
              <div>
                <h2 id="briefing-list-title">Fila de decisões</h2>
                <p>{filteredInsights.length} {filteredInsights.length === 1 ? "item" : "itens"} neste recorte</p>
              </div>
              {temDetector && (
                <button type="button" className="briefing-refresh" onClick={() => void load(true)}>Analisar agora <span aria-hidden>↻</span></button>
              )}
            </header>

            <div className="briefing-tabs" role="tablist" aria-label="Filtrar prioridades por severidade">
              {FILTERS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={filter === item.key}
                  onClick={() => { setFilter(item.key); setVisibleLimit(12); }}
                >
                  {item.label}<span>{counts?.[item.key] ?? 0}</span>
                </button>
              ))}
            </div>

            {visibleInsights.length === 0 ? (
              <div className="briefing-filter-empty"><p>Nenhuma prioridade neste recorte.</p><button type="button" onClick={() => setFilter("all")}>Ver todas</button></div>
            ) : (
              <div className="briefing-table-scroll">
                <div className="briefing-table" role="table" aria-label="Prioridades da operação">
                  <div className="briefing-table-head" role="row">
                    <span role="columnheader">Prioridade</span>
                    <span role="columnheader" className="text-center">Evidência</span>
                    <span role="columnheader" className="text-center">Impacto</span>
                    <span role="columnheader">Canal</span>
                    <span role="columnheader"><span className="sr-only">Ações</span></span>
                  </div>
                  {visibleInsights.map((it) => {
                  const impactUnits = it.impact?.unidadesEmRiscoEstimadas as number | undefined;
                  const premissa = it.impact?.premissa as string | undefined;
                  const band = severityBand(it.severity);
                  const evidence = Object.entries(it.evidence);
                  const expanded = expandedId === it.id;
                  return (
                    <div key={it.id} className={`briefing-table-group is-${band}${expanded ? " is-expanded" : ""}`} role="rowgroup">
                      <div className="briefing-table-row" role="row">
                        <div className="briefing-priority-cell" role="cell">
                          <span className="briefing-severity-mark" aria-hidden />
                          <div>
                            <strong>{it.title}</strong>
                            <span>{it.recommendation || TYPE_LABEL[it.type] || it.type}</span>
                          </div>
                        </div>
                        <div className="briefing-evidence-cell justify-center text-center" role="cell">
                          {evidence.slice(0, 2).map(([key, value]) => <span className="justify-items-center" key={key}><small>{EVIDENCE_LABEL[key] || key}</small><strong className={evidenceValueClass(key, value)}>{value == null ? "—" : String(value)}</strong></span>)}
                          {evidence.length > 2 && <em>+{evidence.length - 2}</em>}
                        </div>
                        <div className="briefing-impact-cell justify-items-center text-center" role="cell">
                          {impactUnits == null ? <span>—</span> : <><strong>≈ {impactUnits}</strong><small>unidade(s) em risco</small></>}
                        </div>
                        <div className="briefing-channel-cell" role="cell">
                          <strong>{CHANNEL[it.provider] || it.provider}</strong>
                          <span>{severityLabel(it.severity)}</span>
                        </div>
                        <div className="briefing-row-actions" role="cell">
                          {it.actionHref ? <Link href={it.actionHref} aria-label={`Ver e agir sobre ${it.title}`} title="Ver e agir">→</Link> : null}
                          <button type="button" aria-expanded={expanded} onClick={() => setExpandedId(expanded ? null : it.id)}>{expanded ? "Fechar" : "Detalhes"}</button>
                        </div>
                      </div>
                      {expanded && (
                        <div className="briefing-row-detail">
                          <dl>{evidence.map(([key, value]) => <div key={key}><dt>{EVIDENCE_LABEL[key] || key}</dt><dd className={evidenceValueClass(key, value)}>{value == null ? "—" : String(value)}</dd></div>)}</dl>
                          <p>{impactUnits == null ? "Impacto ainda não estimado." : <>Impacto estimado: <strong>≈ {impactUnits} unidade(s) em risco</strong>{premissa ? <small>{premissa}</small> : null}</>}</p>
                          <div>
                            <button type="button" disabled={busy === it.id} onClick={() => void act(it.id, "adiar")}>Adiar 3d</button>
                            <button type="button" disabled={busy === it.id} onClick={() => void act(it.id, "dispensar")}>Dispensar</button>
                            <button type="button" className="is-resolve" disabled={busy === it.id} onClick={() => void act(it.id, "resolver")}>Resolver</button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                  })}
                </div>
              </div>
            )}

            {visibleLimit < filteredInsights.length && (
              <div className="briefing-more"><button type="button" onClick={() => setVisibleLimit((current) => current + 12)}>Mostrar mais 12</button><span>{visibleInsights.length} de {filteredInsights.length}</span></div>
            )}
          </section>

          <p className="briefing-method-note">
            Detectores ativos nos quatro canais: ruptura, queda de vendas e margem — na Shopee e no TikTok a margem é avaliada no nível da loja, porque o canal não permite lucro por SKU com segurança. A análise é determinística e recalculada diariamente junto com a sincronização.
          </p>
        </>
      )}
    </div>
  );
}
