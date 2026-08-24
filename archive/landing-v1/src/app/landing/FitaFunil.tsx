"use client";

import { useEntradaEmLoop } from "./entradaEmLoop";

/**
 * A conta como uma fita que estreita — padrão "Visualize your journey" de
 * `dub.co/analytics`, aplicado ao que o NEXO faz de mais próprio.
 *
 * No dub a fita é o funil de conversão (clique → lead → venda). Aqui ela é a
 * conciliação: entra o faturamento largo, cada dedução estreita a faixa, e o
 * que sai do outro lado é o lucro. A leitura acontece antes de ler — é a
 * vantagem sobre a cascata de linhas, que exige percorrer valor por valor.
 *
 * ## Os números são reais e as larguras derivam deles
 *
 * Mesma base da `AnimacaoConciliacao` (painel dela em 16/08/2026):
 *
 *   108,34 − 6,63 (cupons) = 101,71 − 6,12 (taxas) = 95,59 − 34,10 (custo) = 61,49
 *
 * A largura de cada trecho é `valor / faturamento`, calculada aqui a partir dos
 * centavos — não é proporção "de olho". Se alguém trocar um número e esquecer
 * de ajustar o desenho, o desenho se ajusta sozinho. A fita mede o que diz.
 *
 * A paleta é a do produto (azul de entrada → verde de resultado), não a do dub:
 * `docs/landing-nexo.md` fecha questão sobre copiar o efeito e não a cor.
 */

/** Em centavos, para a conta fechar sem erro de ponto flutuante. */
const FATURAMENTO = 10834;

type Etapa = {
  /** Sobra depois desta etapa, em centavos. */
  restante: number;
  rotulo: string;
  /** Ausente na primeira faixa: ela é a entrada, não uma dedução. */
  deducao?: string;
  tom: "entrada" | "cupom" | "taxa" | "lucro";
};

const ETAPAS: Etapa[] = [
  { restante: 10834, rotulo: "Faturamento", tom: "entrada" },
  { restante: 10171, rotulo: "Cupons e promoções", deducao: "− R$ 6,63", tom: "cupom" },
  { restante: 9559, rotulo: "Taxas Amazon", deducao: "− R$ 6,12", tom: "taxa" },
  { restante: 6149, rotulo: "Custo dos produtos", deducao: "− R$ 34,10", tom: "lucro" },
];

const L = 1000; // largura do viewBox
const A = 300; // altura do viewBox
const MEIO = A / 2;
const MAX = 118; // meia-altura da faixa cheia

/** Trecho reto no começo de cada faixa, antes de estreitar. */
const PLATO = 0.42;

function meiaAltura(centavos: number) {
  return (centavos / FATURAMENTO) * MAX;
}

/**
 * Uma faixa: segue reta pelo platô e depois estreita até a altura seguinte, com
 * bezier horizontal — a curva em S do dub, que evita o bico de um trapézio.
 */
function caminho(x0: number, x1: number, h0: number, h1: number) {
  const plato = x0 + (x1 - x0) * PLATO;
  const k = (x1 - plato) * 0.5;
  return [
    `M ${x0} ${MEIO - h0}`,
    `L ${plato} ${MEIO - h0}`,
    `C ${plato + k} ${MEIO - h0}, ${x1 - k} ${MEIO - h1}, ${x1} ${MEIO - h1}`,
    `L ${x1} ${MEIO + h1}`,
    `C ${x1 - k} ${MEIO + h1}, ${plato + k} ${MEIO + h0}, ${plato} ${MEIO + h0}`,
    `L ${x0} ${MEIO + h0}`,
    "Z",
  ].join(" ");
}

export function FitaFunil() {
  // Uma entrada por faixa, mais o cartão do lucro no fim.
  const visiveis = useEntradaEmLoop(ETAPAS.length + 1, 620, 9000, 500);

  const largura = L / ETAPAS.length;

  return (
    <figure className="lp-funil" aria-hidden="true">
      <figcaption className="lp-funil-topo">
        <span className="lp-funil-kicker">Conciliação</span>
        <h3>De quanto entrou até quanto sobrou</h3>
      </figcaption>

      <div className="lp-funil-palco">
        <svg className="lp-funil-svg" viewBox={`0 0 ${L} ${A}`} preserveAspectRatio="none">
          {ETAPAS.map((etapa, i) => {
            const x0 = i * largura;
            // A última faixa vai reta até o fim: o lucro precisa terminar em bloco.
            const anterior = i === 0 ? etapa.restante : ETAPAS[i - 1].restante;
            return (
              <path
                key={etapa.rotulo}
                className={`lp-funil-faixa is-${etapa.tom}${i < visiveis ? " is-visivel" : ""}`}
                d={caminho(x0 - 0.5, x0 + largura + 0.5, meiaAltura(anterior), meiaAltura(etapa.restante))}
                style={{ transitionDelay: `${i * 160}ms` }}
              />
            );
          })}
        </svg>

        {/* Cartões flutuando sobre a fita, como os do dub. */}
        {ETAPAS.map((etapa, i) => (
          <div
            key={etapa.rotulo}
            className={`lp-funil-cartao${etapa.deducao ? " is-deducao" : ""}${
              i < visiveis ? " is-visivel" : ""
            }`}
            style={{ left: `${(i + 0.5) * (100 / ETAPAS.length)}%` }}
          >
            <span>{etapa.rotulo}</span>
            <strong>{etapa.deducao ?? "R$ 108,34"}</strong>
          </div>
        ))}

        <div className={`lp-funil-saida${visiveis > ETAPAS.length ? " is-visivel" : ""}`}>
          <span>Lucro</span>
          <strong>R$ 61,49</strong>
          <em>60,5% de margem</em>
        </div>
      </div>

      <p className="lp-funil-nota">
        A largura de cada trecho é o valor dividido pelo faturamento — a fita mede o que diz.
      </p>
    </figure>
  );
}
