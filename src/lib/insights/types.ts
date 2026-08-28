// Seller Intelligence (ADR-008). Um insight é um achado determinístico com evidência,
// impacto estimado e recomendação — a matéria-prima do briefing diário.

export type InsightStatus = "novo" | "adiado" | "dispensado" | "resolvido";

export interface InsightCandidate {
  id: string; // fingerprint estável: `${type}:${provider}:${entity}`
  type: string; // ruptura | velocidade | margem | ...
  provider: string; // amazon | mercado_livre
  entityRef?: string; // SKU/ASIN a que se refere
  severity: number; // prioridade (maior = mais urgente)
  title: string;
  evidence: Record<string, unknown>; // números que sustentam o achado
  impact: Record<string, unknown>; // estimativa (com premissa) do que está em jogo
  recommendation?: string; // frase de ação (template)
  actionHref?: string; // tela onde agir/investigar
}

export interface Insight extends InsightCandidate {
  status: InsightStatus;
  detectedAt: string;
  updatedAt: string;
  snoozedUntil?: string | null;
}

// Um detector é uma função pura determinística: dados → candidatos.
export interface Detector {
  type: string;
  /** Canal cujos insights este detector emite — a unidade do auto-resolve. */
  provider: string;
  run(): Promise<InsightCandidate[]>;
}
