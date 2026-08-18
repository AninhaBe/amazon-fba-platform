/**
 * Catmull-Rom convertido em bezier cúbico: passa por todos os pontos e não faz
 * bico nos vértices, que é o acabamento das curvas do `dub.co/analytics`.
 *
 * Usado pelo gráfico de métricas e pelo desenho do hero.
 */
export function curva(pontos: Array<[number, number]>) {
  if (pontos.length === 0) return "";
  let d = `M ${pontos[0][0]} ${pontos[0][1]}`;
  for (let i = 0; i < pontos.length - 1; i += 1) {
    const p0 = pontos[i - 1] ?? pontos[i];
    const p1 = pontos[i];
    const p2 = pontos[i + 1];
    const p3 = pontos[i + 2] ?? p2;
    d += ` C ${p1[0] + (p2[0] - p0[0]) / 6} ${p1[1] + (p2[1] - p0[1]) / 6},`;
    d += ` ${p2[0] - (p3[0] - p1[0]) / 6} ${p2[1] - (p3[1] - p1[1]) / 6},`;
    d += ` ${p2[0]} ${p2[1]}`;
  }
  return d;
}
