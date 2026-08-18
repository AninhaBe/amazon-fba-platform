import { curva } from "./curva";

/**
 * O desenho que ocupa o hero — padrão de `dub.co/analytics`, onde o gráfico
 * **é** a ilustração: sobe atrás do texto, sangra pela direita e não tem
 * moldura de janela.
 *
 * ⚠️ **Aqui não há número, e é de propósito.** As três linhas são forma, não
 * medição: não têm eixo, rótulo nem valor. Um gráfico decorativo com escala
 * numerada afirmaria um resultado que ninguém apurou — é a mesma regra dos
 * contadores (`Contadores.tsx`), só que resolvida tirando os números em vez de
 * conferi-los. O dado com valor aparece logo abaixo, na vitrine e no gráfico de
 * métricas, onde cada número tem origem.
 *
 * Sem estado e sem efeito: componente de servidor, a entrada é CSS pura.
 */

const L = 640;
const A = 400;

/** Alturas relativas (0 = base, 1 = topo). Três séries que sobem juntas. */
const SERIES: Array<{ tom: string; pontos: number[] }> = [
  { tom: "azul", pontos: [0.34, 0.4, 0.36, 0.5, 0.46, 0.62, 0.58, 0.78, 0.9] },
  { tom: "roxo", pontos: [0.2, 0.24, 0.22, 0.31, 0.3, 0.4, 0.44, 0.56, 0.68] },
  { tom: "verde", pontos: [0.1, 0.14, 0.11, 0.2, 0.17, 0.24, 0.28, 0.36, 0.46] },
];

export function HeroGrafico() {
  return (
    <div className="lp-hero-arte" aria-hidden="true">
      <svg viewBox={`0 0 ${L} ${A}`} preserveAspectRatio="none">
        {SERIES.map(({ tom, pontos }, i) => {
          const coords: Array<[number, number]> = pontos.map((v, j) => [
            (j / (pontos.length - 1)) * L,
            A - v * A,
          ]);
          const linha = curva(coords);
          return (
            <g key={tom} style={{ animationDelay: `${i * 180}ms` }} className="lp-hero-serie">
              <path className={`lp-hero-area is-${tom}`} d={`${linha} L ${L} ${A} L 0 ${A} Z`} />
              <path className={`lp-hero-linha is-${tom}`} d={linha} />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
