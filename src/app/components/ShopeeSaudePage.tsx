"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { PageHeader } from "./PageHeader";
import { EmptyState } from "./EmptyState";
import { DashboardSkeleton } from "./LoadingState";
import { ChannelConnectionEmpty } from "./ChannelConnectionEmpty";
import { shopeeModuleHref } from "./ShopeeModulesModel";
import { shopeeProviderIssueContent, type ShopeeProviderIssue } from "./ShopeeWorkspaceModel";
import { brDate } from "@/lib/datetime";
import {
  EXPLICACAO_DA_METRICA,
  GRUPO_DA_METRICA,
  NOME_DA_METRICA,
  NOTA_GERAL,
  UNIDADE,
  rotuloDeCodigo,
} from "@/lib/integrations/shopeeAccountHealthMapa";
import type { MetricaDeSaude, ShopeeSaudeDaConta } from "@/lib/integrations/shopeeAccountHealth";

/**
 * Saúde da conta Shopee (decisão da Ana, 28/08/2026; desenho aprovado pelo
 * cérebro após sondagem na loja real). Regras desta tela, todas travadas por
 * teste: a situação de cada métrica vem do comparador da PRÓPRIA API; valor
 * null vira "—" sem julgamento; código sem mapa vira "código N da Shopee";
 * nenhum total de pontos vigentes é afirmado (o endpoint consolidado responde
 * api_suspended ao nosso app); e a página diz há quanto tempo os dados foram
 * lidos — o cache de 30 min precisa ser honesto na tela.
 */

type Connection = { id: string; status: string; displayName?: string; externalAccountId?: string };
type Resposta = { availability: "AVAILABLE" | "NOT_AVAILABLE"; saude?: ShopeeSaudeDaConta };

function valor(metrica: MetricaDeSaude, campo: "valorAtual" | "valorAnterior" | "alvo"): string {
  const bruto = metrica[campo];
  if (bruto == null) return "—";
  const formatar = metrica.unidade != null ? UNIDADE[metrica.unidade] : undefined;
  return formatar ? formatar(bruto) : String(bruto);
}

function minutosDesde(iso: string, agoraMs: number): number {
  return Math.max(0, Math.floor((agoraMs - new Date(iso).getTime()) / 60_000));
}

export function ShopeeSaudePage() {
  const router = useRouter();
  const params = useSearchParams();
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [providerIssue, setProviderIssue] = useState<ShopeeProviderIssue | null>(null);
  const [data, setData] = useState<{ id: string; body: Resposta } | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  // Relógio ancorado no fetch (react-hooks/purity) para o "lido há X min".
  const [agoraMs, setAgoraMs] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/integrations", { cache: "no-store" })
      .then((r) => r.json().then((b) => { if (!r.ok) throw Error(); return b; }))
      .then((b) => {
        const p = b.providers?.find((x: { id: string }) => x.id === "shopee");
        if (!live) return;
        setConnections(p?.connections ?? []);
        setProviderIssue(p?.issue ?? null);
      })
      .catch(() => live && setError("Não foi possível carregar as conexões."));
    return () => { live = false; };
  }, [attempt]);

  const connected = connections?.filter((item) => item.status === "connected") ?? null;
  const requested = params.get("connection_id");
  const selected = connected?.find((item) => item.id === requested) ?? connected?.[0] ?? null;

  useEffect(() => {
    if (!selected) return;
    let live = true;
    // Limpa a conexão anterior de forma síncrona para o dado dela nunca piscar
    // sob a loja nova — mesmo desenho (e mesma exceção) do TikTokModulePage.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setData(null);
    setError("");
    fetch(`/api/integrations/shopee/saude?connection_id=${encodeURIComponent(selected.id)}`, { cache: "no-store" })
      .then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw new Error(b.error || "Não foi possível ler a saúde da conta.");
        return b as Resposta;
      })
      .then((body) => {
        if (!live) return;
        setData({ id: selected.id, body });
        setAgoraMs(Date.now());
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : "Não foi possível ler a saúde da conta."));
    const tique = setInterval(() => setAgoraMs((atual) => (atual == null ? atual : Date.now())), 60_000);
    return () => { live = false; clearInterval(tique); };
  }, [attempt, selected]);

  const retry = useCallback(() => setAttempt((x) => x + 1), []);
  const issueContent = shopeeProviderIssueContent(providerIssue);
  const body = data && data.id === selected?.id ? data.body : null;

  return (
    <div className="channel-module-page analysis-page channel-module-saude">
      <PageHeader
        eyebrow="Shopee"
        title="Saúde da conta"
        subtitle="Nota, métricas com os alvos da própria Shopee, punições e pendências de anúncio."
        action={selected && connected && (
          <label className="channel-store-selector">Loja
            <select aria-label="Loja Shopee" value={selected.id} onChange={(event) => router.push(shopeeModuleHref(location.pathname, params.toString(), event.target.value), { scroll: false })}>
              {connected.map((item) => <option value={item.id} key={item.id}>{item.displayName || item.externalAccountId || item.id}</option>)}
            </select>
          </label>
        )}
      />
      {!connections && !error ? <DashboardSkeleton />
        : issueContent ? <EmptyState kind="permission" title={issueContent.title} description={issueContent.description} action={<Link href="/integracoes" className="meli-primary-action">{issueContent.actionLabel}</Link>} />
        : !selected && !error ? <ChannelConnectionEmpty channel="Shopee" description="Conecte uma loja para ver a saúde da conta." action={<Link href="/integracoes" className="meli-primary-action">Gerenciar conexões</Link>} />
        : error ? <EmptyState kind="permission" title="Não foi possível ler a saúde da conta" description={error} action={<button type="button" className="meli-primary-action" onClick={retry}>Tentar novamente</button>} />
        : !body ? <DashboardSkeleton />
        : body.availability === "NOT_AVAILABLE" || !body.saude ? <EmptyState title="Indisponível na demonstração" description="A saúde da conta é lida ao vivo da Shopee e só existe para loja real conectada." />
        : <Conteudo saude={body.saude} agoraMs={agoraMs} />}
    </div>
  );
}

function Conteudo({ saude, agoraMs }: { saude: ShopeeSaudeDaConta; agoraMs: number | null }) {
  const rotuloDaNota = saude.nota.rating != null ? NOTA_GERAL[saude.nota.rating] : undefined;
  const grupos = [1, 2, 3].map((grupo) => ({
    grupo,
    titulo: GRUPO_DA_METRICA[grupo],
    metricas: saude.metricas.filter((metrica) => metrica.grupo === grupo),
  }));
  const foraDosGrupos = saude.metricas.filter((metrica) => !GRUPO_DA_METRICA[metrica.grupo]);
  return (
    <section className="channel-module-content" aria-label="Saúde da conta Shopee">
      {agoraMs != null && (
        /* ⚠️ CLASSE PROPRIA DESDE 13/09/2026, e a troca e de NOME,
           nao de desenho: esta linha reusava `.estado-do-sync`, do componente
           de estado da varredura, que saiu do produto por ordem da dona. Ela
           NAO e aquela faixa — nao fala do nosso sync, fala de quando a SHOPEE
           publicou a saude da conta, que atualiza a cada 30 min do lado deles.
           Continuar com o nome emprestado deixaria um nome mentindo no CSS. */
        <p className="leitura-da-fonte" role="note">
          Lido da Shopee há <strong>{minutosDesde(saude.lidoEm, agoraMs)} min</strong> — atualiza a cada 30 min.
        </p>
      )}

      {/* Colapsado por padrão (pedido da Ana, 28/08/2026): explicação não pode
          virar parede de texto na frente do dado — a lição da hierarquia. */}
      <details className="channel-module-notice shopee-saude-explicacao">
        <summary><strong>Como a Shopee avalia sua loja</strong></summary>
        <p>
          A Shopee dá à loja uma nota geral de 1 a 4, calculada sobre três grupos de métricas:
          Envio, Anúncios e Atendimento. O alvo de cada métrica (a coluna &quot;Alvo&quot;) é definido
          pela própria Shopee, não pelo NEXO — a coluna &quot;Situação&quot; apenas compara o seu valor
          com o alvo deles. Violações das regras também geram pontos de penalidade, e pontos
          acumulados podem resultar em punições à loja (é o Sistema de Pontos de Penalidade do
          vendedor); as punições vigentes e o histórico aparecem mais abaixo. As definições de
          cada métrica vêm do Centro de Educação do Vendedor da Shopee.
        </p>
      </details>

      <header className="shopee-saude-nota">
        <div>
          <p className="section-kicker">Nota geral da Shopee</p>
          <h2>{saude.nota.rating == null ? "—" : `${saude.nota.rating} de 4${rotuloDaNota ? ` — ${rotuloDaNota}` : ""}`}</h2>
        </div>
        <p>
          Métricas reprovadas por grupo: Envio {saude.nota.enviosReprovados} · Anúncios {saude.nota.anunciosReprovados} · Atendimento {saude.nota.atendimentoReprovado}.
        </p>
      </header>

      {[...grupos, ...(foraDosGrupos.length ? [{ grupo: 0, titulo: "Outras métricas", metricas: foraDosGrupos }] : [])].map(({ grupo, titulo, metricas }) => metricas.length > 0 && (
        <section key={grupo} className="listing-table-shell channel-module-table-shell" aria-labelledby={`saude-grupo-${grupo}`}>
          <header><div><p className="section-kicker">Métricas</p><h2 id={`saude-grupo-${grupo}`}>{titulo}</h2></div><p>alvos definidos pela Shopee</p></header>
          <div className="overflow-x-auto">
            <table className="listing-table channel-module-table">
              <caption className="sr-only">Métricas de {titulo}</caption>
              <thead><tr><th scope="col">Métrica</th><th scope="col">Atual</th><th scope="col">Período anterior</th><th scope="col">Alvo</th><th scope="col">Situação</th></tr></thead>
              <tbody>
                {metricas.map((metrica) => (
                  <tr key={metrica.nome} className={metrica.situacao === "reprovada" ? "is-reprovada" : undefined}>
                    <td>
                      {NOME_DA_METRICA[metrica.nome] ?? metrica.nome}
                      {/* Definição só quando a doc oficial define (mapa com
                          fonte); métrica sem definição citável fica sem linha. */}
                      {EXPLICACAO_DA_METRICA[metrica.nome] && (
                        <small className="shopee-saude-definicao">{EXPLICACAO_DA_METRICA[metrica.nome].definicao}</small>
                      )}
                      {/* Estava na MESMA classe da definicao — cinza de 11px — e
                          por isso lia como rodape. E o unico texto da linha que
                          pede acao; ganha o tratamento de acao (`texto-acao`),
                          nao o de fonte. */}
                      {metrica.situacao === "reprovada" && EXPLICACAO_DA_METRICA[metrica.nome]?.oQueFazer && (
                        <small className="texto-acao"><strong>O que fazer:</strong> {EXPLICACAO_DA_METRICA[metrica.nome].oQueFazer}</small>
                      )}
                    </td>
                    <td className="tabular-nums">{valor(metrica, "valorAtual")}</td>
                    <td className="tabular-nums">{valor(metrica, "valorAnterior")}</td>
                    <td className="tabular-nums">{metrica.alvo == null ? "—" : `${metrica.comparador ?? ""} ${valor(metrica, "alvo")}`}</td>
                    <td>{metrica.situacao == null ? "—" : metrica.situacao === "ok" ? <span className="stock-status is-ok">OK</span> : <span className="stock-status is-critical">Reprovada</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <section className="listing-table-shell channel-module-table-shell" aria-labelledby="saude-punicoes">
        <header><div><p className="section-kicker">Punições</p><h2 id="saude-punicoes">{saude.punicoesVigentes.length === 0 ? "Nenhuma punição vigente" : `${saude.punicoesVigentes.length} punição(ões) vigente(s)`}</h2></div><p>{saude.punicoesEncerradas.total} no histórico</p></header>
        {(saude.punicoesVigentes.length > 0 || saude.punicoesEncerradas.recentes.length > 0) && (
          <div className="overflow-x-auto">
            <table className="listing-table channel-module-table">
              <caption className="sr-only">Punições da loja</caption>
              <thead><tr><th scope="col">Situação</th><th scope="col">Tipo</th><th scope="col">Período</th><th scope="col">Efeito</th></tr></thead>
              <tbody>
                {[...saude.punicoesVigentes.map((p) => ({ ...p, vigente: true })), ...saude.punicoesEncerradas.recentes.map((p) => ({ ...p, vigente: false }))].map((p, index) => (
                  <tr key={index}>
                    <td>{p.vigente ? <span className="stock-status is-critical">Vigente</span> : "Encerrada"}</td>
                    <td>{p.tipo == null ? "—" : rotuloDeCodigo({}, p.tipo)}</td>
                    <td className="tabular-nums">{p.inicio ? brDate(new Date(p.inicio)) : "—"} – {p.fim ? brDate(new Date(p.fim)) : "—"}</td>
                    <td>{p.limiteDePedidos ? `Limite de pedidos em ${p.limiteDePedidos}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="listing-table-shell channel-module-table-shell" aria-labelledby="saude-pontos">
        <header><div><p className="section-kicker">Pontos de penalidade</p><h2 id="saude-pontos">{saude.pontosDePenalidade.length === 0 ? "Nenhum lançamento de ponto" : `${saude.pontosDePenalidade.length} lançamento(s) de ponto`}</h2></div></header>
        {/* A Shopee não expõe ao nosso app o total VIGENTE de pontos (endpoint
            consolidado indisponível); a lista de lançamentos é o fato que a API
            entrega — nenhum total é afirmado aqui. */}
        <p className="channel-module-method">A Shopee não informa ao NEXO o total vigente de pontos — abaixo estão os lançamentos individuais que ela expõe.</p>
        {saude.pontosDePenalidade.length > 0 && (
          <div className="overflow-x-auto">
            <table className="listing-table channel-module-table">
              <caption className="sr-only">Lançamentos de pontos de penalidade</caption>
              <thead><tr><th scope="col">Data</th><th scope="col">Violação</th><th scope="col">Pontos</th></tr></thead>
              <tbody>
                {saude.pontosDePenalidade.map((ponto, index) => (
                  <tr key={index}>
                    <td className="tabular-nums">{ponto.emitidoEm ? brDate(new Date(ponto.emitidoEm)) : "—"}</td>
                    <td>{ponto.tipoDeViolacao == null ? "—" : rotuloDeCodigo({}, ponto.tipoDeViolacao)}</td>
                    <td className="tabular-nums">{ponto.pontos ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="listing-table-shell channel-module-table-shell" aria-labelledby="saude-operacao">
        <header><div><p className="section-kicker">Pendências agora</p><h2 id="saude-operacao">{saude.pedidosAtrasados} pedido(s) atrasado(s) · {saude.anunciosComProblema.length} anúncio(s) com problema</h2></div></header>
        {saude.anunciosComProblema.length > 0 && (
          <div className="overflow-x-auto">
            <table className="listing-table channel-module-table">
              <caption className="sr-only">Anúncios com problema</caption>
              <thead><tr><th scope="col">Anúncio</th><th scope="col">SKU</th><th scope="col">Motivo</th></tr></thead>
              <tbody>
                {saude.anunciosComProblema.map((anuncio) => (
                  <tr key={anuncio.itemId}>
                    <td>{anuncio.titulo ?? `Item ${anuncio.itemId}`}</td>
                    <td className="font-mono text-xs">{anuncio.sku ?? "—"}</td>
                    <td>{anuncio.motivo == null ? "—" : rotuloDeCodigo({}, anuncio.motivo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}
