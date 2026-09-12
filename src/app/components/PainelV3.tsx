"use client";

/**
 * O dashboard do Mercado Livre na estrutura **v3**, lida do canvas dela
 * (`Dashboard Mercado Livre v3.dc.html`, projeto de design 977f6a09) em
 * 09/09/2026 — não de screenshot: o fonte foi buscado pelo DesignSync, então
 * medida, token e regra vieram do original.
 *
 * ⚠️ O FUNDO NÃO VEM DO CANVAS — ordem dela, verbatim: *"só não
 * aplique o fundo, o fundo deixe como está"*. O canvas pinta `#fdfdfd` com uma
 * malha de 60px; aqui o `body` do produto continua como está. Tudo o mais
 * (composição, colunas, tipografia, chips) segue o v3.
 *
 * A primeira viewport tem três peças:
 *
 *   1. a faixa do período — SETE colunas, e não quatro: a v3 abre o custo em
 *      Tarifa do ML, Frete que você paga, Custo dos produtos e Impostos, em vez
 *      de somá-los num "Custou". É a diferença entre ver o resultado e ver ONDE
 *      ele se forma;
 *   2. "Top N produtos" — o ranking com barra de faturamento ao fundo da
 *      linha, contribuição e chip de margem;
 *   3. "Ritmo dos últimos 7 dias" com alternador de métrica + "O que falta para
 *      o número fechar".
 *
 * ⚠️ AS REGRAS DE DADO INCERTO DO PRODUTO CONTINUAM VALENDO, e o
 * canvas as respeita: imposto sem alíquota é travessão e a nota explica que o
 * lucro exibido é o MÁXIMO possível, não o final; produto sem custo entra sem
 * margem, nunca com margem cheia; dia sem apuração fechada fica só com o
 * contorno e não entra na média.
 */

import type { ReactNode } from "react";

import { FaixaDoPeriodoV3, type ColunaDoPeriodo, type MargemDoPeriodo } from "./FaixaDoPeriodoV3";

/* ── Cores da v3 ──────────────────────────────────────────────────────────── */

const VERDE = "#167a56";
const VERMELHO = "#c83a31";
const AMBAR_TINTA = "#b45309";
const CHIP_VERDE = "#e5f5ec";
const CHIP_VERMELHO = "#fbeae7";
const CHIP_ATENCAO = "#fceadb";

/* ── Contrato ─────────────────────────────────────────────────────────────── */

/**
 * ⚠️ A DEFINICAO MUDOU DE ARQUIVO EM 12/09/2026 (foi para a
 * `FaixaDoPeriodoV3`, quando a faixa virou peca compartilhada com a Amazon) e e
 * RE-EXPORTADA daqui de proposito: quem ja importava `ColunaDoPeriodo` do
 * `PainelV3` continua importando do mesmo lugar. Extracao nao e hora de mandar
 * o resto do produto atualizar import.
 */
export type { ColunaDoPeriodo, MargemDoPeriodo } from "./FaixaDoPeriodoV3";

export interface ProdutoDaMargem {
  id: string;
  posicao: number;
  titulo: string;
  sku: string | null;
  unidades: string;
  faturamento: string;
  /** Fração de 0 a 1 contra o maior faturamento — a barra ao fundo da linha. */
  fracao: number;
  contribuicao: string;
  margemPct: number | null;
}

export interface DiaDoRitmo {
  id: string;
  dia: string;
  /** Altura da barra cinza (o total da métrica escolhida). */
  total: number;
  /** Parte cheia em verde. `null` = dia sem apuração fechada. */
  lucro: number | null;
  rotuloTotal: string;
  /** O lucro do dia já formatado em moeda. `null` = dia sem apuração fechada. */
  rotuloLucro: string | null;
  destaque?: boolean;
}

export interface PendenciaV3 {
  id: string;
  titulo: string;
  efeito: string;
  acao: string;
  href: string;
  tom: "atencao" | "neutro";
}

export interface DadosV3 {
  periodoLabel: string;
  resumoApuracao: ReactNode;
  colunas: ColunaDoPeriodo[];
  margem: MargemDoPeriodo;
  notaDoImposto: ReactNode | null;
  produtos: ProdutoDaMargem[];
  ritmo: {
    metricas: string[];
    metricaAtiva: string;
    aoTrocarMetrica: (m: string) => void;
    legendaTotal: string;
    legendaMedia: string;
    mostraLucro: boolean;
    media: number;
    dias: DiaDoRitmo[];
    nota: string;
  };
  pendencias: PendenciaV3[];
  hrefs: { resultado: string; produtos: string; historico: string; pendencias: string };
}

/* ── Chip de margem — o componente do design system dela ───────────────────── */

export function ChipDeMargem({ pct }: { pct: number | null }) {
  if (pct == null) {
    return <em className="v3-chip v3-chip-vazio">—</em>;
  }
  const classe = pct < 0 ? "v3-chip-neg" : pct < 10 ? "v3-chip-aten" : "v3-chip-pos";
  return (
    <em className={`v3-chip ${classe}`}>
      {pct.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
    </em>
  );
}

/* ── A primeira viewport ──────────────────────────────────────────────────── */

export function PainelV3({ dados }: { dados: DadosV3 }) {
  const { ritmo } = dados;
  const teto = Math.max(1, ...ritmo.dias.map((d) => d.total));
  const ALTURA = 120;

  return (
    <div className="v3">
      <FaixaDoPeriodoV3
        periodoLabel={dados.periodoLabel}
        resumoApuracao={dados.resumoApuracao}
        hrefResultado={dados.hrefs.resultado}
        colunas={dados.colunas}
        margem={dados.margem}
        notaDoImposto={dados.notaDoImposto}
      />

      {/* ── Top N produtos · Ritmo + pendências ──────────────────────────── */}
      <section className="v3-duas">
        <div className="v3-card">
          <div className="v3-card-cab">
            {/* ⚠️ JA SE CHAMOU "Onde a margem escapa", e a troca nao
                foi so de estilo: aquele titulo PROMETIA UM DIAGNOSTICO que a
                lista nao faz. Ela e ordenada por FATURAMENTO, nao por vazamento
                — em 09/09/2026 o item n1 tinha a melhor margem da tela (18,2%)
                e encabecava um cartao chamado "onde a margem escapa".

                Se um dia a ordenacao mudar para ranquear por margem perdida, o
                titulo antigo volta a ser honesto; ate la, ele mentia. */}
            {/* ⚠️ O NUMERO SAI DA LISTA, nao de uma constante. Com
                "Top 8" cravado, uma conta com cinco produtos no periodo
                mostraria cinco linhas sob um titulo prometendo oito. Este
                cartao ja mentiu duas vezes hoje por rotulo fixo — vale a pena
                o titulo custar uma interpolacao. */}
            <h2>Top {dados.produtos.length} produtos</h2>
            {/* ⚠️ ESTE CARTAO NAO TEM BOTAO, e e decisao dela
                (10/09/2026): o Top N nao vai ganhar tela propria. Cartao com
                acao que leva a lugar nenhum — ou a uma tela que responde outra
                pergunta — e pior que cartao sem acao: ensina que os botoes da
                tela nao valem o clique. Se um dia existir a tela do ranking, o
                botao volta AQUI, com o destino dela. */}
          </div>

          {/* ⚠️ CABECALHO E LINHAS PRECISAM DIVIDIR UM GRID SO, e por
              isso existe este embrulho. Enquanto eram dois grids irmaos, as
              colunas so coincidiam porque as larguras estavam CRAVADAS em px
              nos dois — e largura cravada e justamente o que faz um numero
              maior invadir a coluna vizinha. Com um grid comum e `subgrid` nos
              dois, a largura sai do conteudo e a coincidencia passa a ser
              estrutural em vez de coincidencia mesmo. */}
          <div className="v3-margem-grade">
          <div className="v3-margem-cab">
            <span /><span />
            {/* ⚠️ MAIUSCULA NO TEXTO, NAO `text-transform: capitalize`.
                O CSS capitaliza CADA palavra, entao um rotulo de duas viraria
                "Margem Real" — errado em portugues e diferente dos cartoes de
                baixo, que ja escrevem "Margem real" e "Sua posicao". */}
            <span>Unidades</span>
            <span>Faturamento</span>
            <span>Contribuição</span>
            <span>Margem</span>
          </div>

          <ul className="v3-margem-lista">
            {dados.produtos.map((p, i) => (
              <li className="v3-margem-linha" key={p.id}>
                {/* A barra de faturamento vive ATRÁS da linha inteira: comparar
                    grandeza sem gastar uma coluna só para isso. */}
                <span
                  className={`v3-margem-barra${i === 0 ? " is-topo" : ""}`}
                  style={{ width: `${(5 + 95 * p.fracao).toFixed(1)}%` }}
                  aria-hidden
                />
                <span className="v3-margem-pos">{p.posicao}</span>
                <span className="v3-margem-nome">
                  <span className="v3-margem-titulo" title={p.titulo}>{p.titulo}</span>
                  <span className="v3-margem-sku">{p.sku ?? "sem SKU"}</span>
                </span>
                <span className="v3-margem-un">{p.unidades}</span>
                <span className="v3-margem-fat">{p.faturamento}</span>
                <span
                  className="v3-margem-contrib"
                  style={{
                    color:
                      p.margemPct == null
                        ? "var(--ink-32)"
                        : p.margemPct < 0
                          ? VERMELHO
                          : VERDE,
                  }}
                >
                  {p.contribuicao}
                </span>
                <span className="v3-margem-chip"><ChipDeMargem pct={p.margemPct} /></span>
              </li>
            ))}
          </ul>
          </div>

          <p className="v3-nota">
            Contribuição é faturamento menos tarifa, frete, custo e imposto do próprio produto.
            Produto sem custo cadastrado entra sem margem — nunca com margem cheia.
          </p>
        </div>

        <div className="v3-pilha">
          <div className="v3-card">
            <div className="v3-card-cab">
              <h2>Ritmo dos últimos 7 dias</h2>
              <a className="v3-btn" href={dados.hrefs.historico}>Abrir histórico →</a>
            </div>

            <div className="v3-abas">
              {ritmo.metricas.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`v3-aba${m === ritmo.metricaAtiva ? " is-ativa" : ""}`}
                  onClick={() => ritmo.aoTrocarMetrica(m)}
                >
                  {m}
                </button>
              ))}
            </div>

            <div className="v3-grafico">
              <div className="v3-legenda">
                <span><i className="v3-legenda-total" />{ritmo.legendaTotal}</span>
                {ritmo.mostraLucro ? <span><i className="v3-legenda-lucro" />lucro</span> : null}
                <span><i className="v3-legenda-media" />{ritmo.legendaMedia}</span>
              </div>

              <div className="v3-linha-valores">
                {ritmo.dias.map((d) => (
                  <span key={d.id}>{d.rotuloTotal}</span>
                ))}
              </div>

              <div className="v3-barras" style={{ height: ALTURA }}>
                <span
                  className="v3-media"
                  style={{ bottom: Math.round((ritmo.media / teto) * ALTURA) }}
                  aria-hidden
                />
                {ritmo.dias.map((d) => {
                  const semApuracao = ritmo.mostraLucro && d.lucro == null;
                  return (
                    <div className="v3-barra-col" key={d.id}>
                      <span
                        className={`v3-barra${semApuracao ? " is-vazia" : ""}`}
                        style={{ height: Math.round((d.total / teto) * ALTURA) }}
                      >
                        {ritmo.mostraLucro && d.lucro != null ? (
                          <span
                            className="v3-barra-lucro"
                            style={{ height: Math.round((d.lucro / teto) * ALTURA) }}
                          />
                        ) : null}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="v3-linha-dias">
                {ritmo.dias.map((d) => (
                  <span key={d.id}>
                    {ritmo.mostraLucro ? (
                      <b
                        style={{
                          color: d.lucro == null ? "var(--ink-50)" : d.destaque ? VERDE : "var(--ink)",
                        }}
                      >
                        {d.rotuloLucro ?? "—"}
                      </b>
                    ) : null}
                    <em style={{ color: d.destaque ? VERDE : "var(--ink-64)", fontWeight: d.destaque ? 650 : 400 }}>
                      {d.dia}
                    </em>
                  </span>
                ))}
              </div>
            </div>

            <p className="v3-nota">{ritmo.nota}</p>
          </div>

          <div className="v3-card">
            <div className="v3-card-cab">
              <h2>O que falta para o número fechar</h2>
              <a className="v3-btn" href={dados.hrefs.pendencias}>Abrir pendências →</a>
            </div>
            {dados.pendencias.map((p) => (
              <div className={`v3-pend is-${p.tom}`} key={p.id}>
                <div className="v3-pend-txt">
                  <i aria-hidden />
                  <div>
                    <strong>{p.titulo}</strong>
                    <span>{p.efeito}</span>
                  </div>
                </div>
                <a className="v3-btn" href={p.href}>{p.acao}</a>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

export const coresV3 = { VERDE, VERMELHO, AMBAR_TINTA, CHIP_VERDE, CHIP_VERMELHO, CHIP_ATENCAO };
