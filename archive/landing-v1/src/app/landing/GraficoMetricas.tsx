"use client";

import { useState } from "react";
import { curva } from "./curva";

/**
 * Métricas que trocam o gráfico — padrão "Success at a glance" de
 * `dub.co/analytics`: três números grandes com bolinha colorida, o ativo
 * sublinhado em preto, e um gráfico de área embaixo que muda junto.
 *
 * ## Por que a curva é acumulada
 *
 * O período real tem 5 vendas (16/08/2026). Um gráfico diário seria quase todo
 * zero com cinco picos — e zero, nesta base, significa "não vendeu nada". A
 * curva **acumulada** resolve os dois lados: sobe de verdade, e cada ponto é um
 * fato ("até aqui, tinha entrado tanto"). Nada foi inventado para encher.
 *
 * As três séries compartilham a forma do faturamento porque taxa e lucro andam
 * com a venda; o **ponto final de cada uma é o valor real do período**, que é o
 * número exibido em cima. A distribuição intermediária é proporcional, não
 * medida — está dito na nota ao pé do gráfico, não escondido.
 */

const DIAS = ["03/08", "05/08", "07/08", "09/08", "11/08", "13/08", "16/08"];

/** Faturamento acumulado, em reais — as cinco vendas do período, somando. */
const ACUMULADO = [0, 19.9, 39.8, 39.8, 59.7, 88.44, 108.34];

const METRICAS = [
  { id: "faturamento", rotulo: "Faturamento", total: 108.34, tom: "azul" },
  { id: "taxas", rotulo: "Taxas", total: 6.12, tom: "vermelho" },
  { id: "lucro", rotulo: "Lucro", total: 61.49, tom: "verde" },
] as const;

const L = 720;
const A = 220;
const TOPO = 12;

const reais = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function GraficoMetricas() {
  const [ativa, setAtiva] = useState<(typeof METRICAS)[number]["id"]>("faturamento");
  const metrica = METRICAS.find((m) => m.id === ativa) ?? METRICAS[0];

  const fator = metrica.total / ACUMULADO[ACUMULADO.length - 1];
  const serie = ACUMULADO.map((v) => v * fator);
  const teto = metrica.total * 1.12;

  const pontos: Array<[number, number]> = serie.map((v, i) => [
    (i / (serie.length - 1)) * L,
    TOPO + (1 - v / teto) * (A - TOPO),
  ]);

  const linha = curva(pontos);
  const area = `${linha} L ${L} ${A} L 0 ${A} Z`;
  const destaque = pontos[pontos.length - 1];

  return (
    <section className="lp-metricas">
      <div className="lp-metricas-topo">
        <p className="lp-kicker">Visão do canal</p>
        <h2>Tudo num relance</h2>
        <p>Os três números que decidem o dia, e como cada um chegou até aqui.</p>
      </div>

      <div className="lp-metricas-quadro">
        <div className="lp-metricas-abas" role="tablist" aria-label="Métrica do gráfico">
          {METRICAS.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={m.id === ativa}
              className={`is-${m.tom}${m.id === ativa ? " is-ativa" : ""}`}
              onClick={() => setAtiva(m.id)}
            >
              <span className="lp-metricas-rotulo">
                <span className="lp-metricas-ponto" aria-hidden="true" />
                {m.rotulo}
              </span>
              <strong>{reais(m.total)}</strong>
            </button>
          ))}
        </div>

        <div className="lp-metricas-grafico">
          <svg viewBox={`0 0 ${L} ${A}`} preserveAspectRatio="none" aria-hidden="true">
            {[0.25, 0.5, 0.75].map((f) => (
              <line key={f} className="lp-metricas-guia" x1="0" x2={L} y1={A * f} y2={A * f} />
            ))}
            {/* `key` na métrica remonta os paths: a curva se redesenha na troca. */}
            <path key={`a-${ativa}`} className={`lp-metricas-area is-${metrica.tom}`} d={area} />
            <path key={`l-${ativa}`} className={`lp-metricas-linha is-${metrica.tom}`} d={linha} />
          </svg>

          {/* Marcador em HTML, não em SVG: com `preserveAspectRatio="none"` o
              `<circle>` é esticado junto com o desenho e vira elipse.
              No `top`, 18px é o padding do contêiner e `100% − 18px` a altura
              do SVG — assim o ponto cai exatamente sobre o fim da curva. */}
          <span
            className={`lp-metricas-alvo is-${metrica.tom}`}
            style={{ top: `calc(18px + (100% - 18px) * ${destaque[1] / A})` }}
            aria-hidden="true"
          />

          <div className="lp-metricas-balao">
            <span>16/08/2026</span>
            <strong>
              <span className={`lp-metricas-ponto is-${metrica.tom}`} aria-hidden="true" />
              {metrica.rotulo} {reais(metrica.total)}
            </strong>
          </div>
        </div>

        <div className="lp-metricas-eixo" aria-hidden="true">
          {DIAS.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>
      </div>

      <p className="lp-metricas-nota">
        Acumulado do período: cada ponto é quanto já tinha entrado até aquele dia. O total de
        cada métrica é o valor real de 16/08/2026; a distribuição entre os dias é proporcional.
      </p>
    </section>
  );
}
