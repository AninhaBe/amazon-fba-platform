export type MarginTone = "danger" | "warning" | "positive" | "unknown";

/**
 * Regra visual global de margem do NEXO.
 *
 * O valor real e classificado antes do arredondamento de tela: abaixo de 12%
 * exige acao, de 12% a 15% pede atencao e acima de 15% e saudavel. Margem
 * negativa segue sendo risco; ausencia de dado nunca vira zero.
 */
export function marginTone(marginPct: number | null | undefined): MarginTone {
  if (marginPct == null || !Number.isFinite(marginPct)) return "unknown";
  if (marginPct < 12) return "danger";
  if (marginPct <= 15) return "warning";
  return "positive";
}

export function marginMetricTone(marginPct: number | null | undefined): "danger" | "warn" | "positive" | "default" {
  const tone = marginTone(marginPct);
  return tone === "warning" ? "warn" : tone === "unknown" ? "default" : tone;
}

export function marginStateClass(marginPct: number | null | undefined): "is-negative" | "is-warning" | "is-positive" | "is-unknown" {
  const tone = marginTone(marginPct);
  if (tone === "danger") return "is-negative";
  return `is-${tone}`;
}
