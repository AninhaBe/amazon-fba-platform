// Helpers puros do sync do Mercado Livre — mesmo papel do shopeeSyncControl e
// do tiktokSyncControl: decisão de checkpoint testável sem banco nem rede.

export class MercadoLivreLeaseLostError extends Error {}

export type MercadoLivreWindowAdvance =
  | { kind: "complete" }
  | { kind: "advance"; nextFromMs: number; nextToMs: number }
  | { kind: "extend"; targetFromMs: number; coveredFromMs: number; nextFromMs: number; nextToMs: number };

/**
 * Decide o próximo movimento da janela de pedidos ao fechar uma página completa.
 *
 * Fase 1 termina quando o cursor alcança o alvo imediato (30 dias); se o ponto
 * mais antigo já coberto ainda não alcança o histórico completo, o alvo é
 * estendido para trás ("extend") e o backfill continua nas mesmas janelas.
 *
 * ⚠️ A extensão olha `covered_from`, não `target_from`: o
 * `requestMercadoLivreSync` ESTREITA o alvo a cada reabertura incremental
 * (`target_from = covered_to`), então um alvo recente é rotina — só o
 * `covered_from` diz se há história antiga de verdade ainda não importada.
 * Basear a extensão no alvo faria cada ciclo incremental redisparar o backfill
 * inteiro.
 */
export function nextMercadoLivreOrderWindow(input: {
  windowFromMs: number;
  targetFromMs: number;
  coveredFromMs: number | null;
  historyFloorMs: number;
  windowMs: number;
  toleranceMs: number;
}): MercadoLivreWindowAdvance {
  if (input.windowFromMs > input.targetFromMs) {
    const nextToMs = input.windowFromMs;
    return {
      kind: "advance",
      nextToMs,
      nextFromMs: Math.max(input.targetFromMs, nextToMs - input.windowMs),
    };
  }
  const oldestCoveredMs = Math.min(input.windowFromMs, input.coveredFromMs ?? Number.POSITIVE_INFINITY);
  if (oldestCoveredMs > input.historyFloorMs + input.toleranceMs) {
    return {
      kind: "extend",
      targetFromMs: input.historyFloorMs,
      coveredFromMs: oldestCoveredMs,
      nextToMs: oldestCoveredMs,
      nextFromMs: Math.max(input.historyFloorMs, oldestCoveredMs - input.windowMs),
    };
  }
  return { kind: "complete" };
}
