// Tendência de faturamento — função PURA, fora do componente.
//
// Vivia dentro de `Metric.tsx`, que é "use client" e importa `next/link`; por
// isso nunca teve teste, e a regra de base pequena passou despercebida até
// aparecer um "2281,1%" ao lado do faturamento (23/08/2026).

/** Um ponto da série diária. Espelha `DailyPoint` sem arrastar o componente. */
export interface PontoDeFaturamento {
  revenue: number;
  orders?: number;
}

export interface RevenueTrend {
  direction: "up" | "down" | "flat";
  percentage: number | null;
}

/** Compara as duas metades do período: a seta dos KPIs de faturamento. */
export function getRevenueTrend(points: PontoDeFaturamento[]): RevenueTrend | null {
  if (points.length < 2) return null;
  const blockSize = Math.floor(points.length / 2);
  const comparable = points.slice(points.length - blockSize * 2);
  const previous = comparable.slice(0, blockSize).reduce((total, point) => total + point.revenue, 0);
  const current = comparable.slice(blockSize).reduce((total, point) => total + point.revenue, 0);
  if (previous === 0 && current === 0) return { direction: "flat", percentage: 0 };
  if (previous === 0) return { direction: "up", percentage: null };
  // BASE PEQUENA DEMAIS = "novo ritmo", não um percentual de quatro dígitos.
  //
  // Base zero já virava "novo ritmo"; base QUASE zero não, e o resultado foi um
  // "2281,1%" ao lado do faturamento (23/08/2026). Estava certo na aritmética —
  // a primeira metade do período tinha uma venda de R$ 19,90 porque a conta
  // começou a vender 15 dias antes — e completamente inútil: lido de relance,
  // parece que algo explodiu.
  //
  // O critério é PEDIDOS, não o percentual: menos de 3 pedidos na metade
  // anterior não é uma base de comparação, é uma coincidência. Percentual sobre
  // amostra dessa ordem carrega mais ruído que informação, qualquer que seja o
  // valor que ele assuma.
  const pedidosAnteriores = comparable.slice(0, blockSize).reduce((total, point) => total + (point.orders ?? 0), 0);
  if (pedidosAnteriores < 3) return { direction: current >= previous ? "up" : "down", percentage: null };
  const percentage = ((current - previous) / previous) * 100;
  const direction = percentage > 0.5 ? "up" : percentage < -0.5 ? "down" : "flat";
  return { direction, percentage };
}
