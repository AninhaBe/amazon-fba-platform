export interface ChartPoint {
  x: number;
  y: number;
}

/**
 * Cria uma curva que atravessa todos os pontos sem ultrapassar os valores do
 * intervalo. Isso suaviza a leitura da tendência sem inventar picos entre dias.
 */
export function monotoneCurvePath(points: ChartPoint[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  const slopes = points.slice(0, -1).map((point, index) => {
    const next = points[index + 1];
    const width = next.x - point.x;
    return width === 0 ? 0 : (next.y - point.y) / width;
  });

  const tangents = points.map((_, index) => {
    if (index === 0) return slopes[0];
    if (index === points.length - 1) return slopes[slopes.length - 1];

    const previous = slopes[index - 1];
    const next = slopes[index];
    return previous * next <= 0 ? 0 : (previous + next) / 2;
  });

  // Filtro de Fritsch-Carlson: limita os controles de cada segmento para a
  // curva permanecer dentro do intervalo delimitado pelos seus dois pontos.
  slopes.forEach((slope, index) => {
    if (slope === 0) {
      tangents[index] = 0;
      tangents[index + 1] = 0;
      return;
    }

    const startRatio = tangents[index] / slope;
    const endRatio = tangents[index + 1] / slope;
    const length = Math.hypot(startRatio, endRatio);

    if (length > 3) {
      const scale = 3 / length;
      tangents[index] = scale * startRatio * slope;
      tangents[index + 1] = scale * endRatio * slope;
    }
  });

  const segments = points.slice(0, -1).map((point, index) => {
    const next = points[index + 1];
    const width = next.x - point.x;
    const controlOffset = width / 3;

    return [
      "C",
      point.x + controlOffset,
      point.y + tangents[index] * controlOffset,
      next.x - controlOffset,
      next.y - tangents[index + 1] * controlOffset,
      next.x,
      next.y,
    ].join(" ");
  });

  return `M ${points[0].x} ${points[0].y} ${segments.join(" ")}`;
}
