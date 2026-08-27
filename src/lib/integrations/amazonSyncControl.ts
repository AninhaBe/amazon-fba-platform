// Helpers puros do sync da Amazon — mesmo papel do shopeeSyncControl, do
// mercadoLivreSyncControl e do tiktokSyncControl: decisão de checkpoint
// testável sem banco nem rede.

export type AmazonWindowAdvance =
  | { kind: "complete" }
  | { kind: "advance"; nextFromMs: number; nextToMs: number }
  | { kind: "extend"; targetFromMs: number; coveredFromMs: number; nextFromMs: number; nextToMs: number };

/**
 * Decide o próximo movimento da janela de pedidos ao fechar uma janela (sem
 * NextToken pendente).
 *
 * Fase 1 termina quando o cursor alcança o alvo imediato (30 dias); se o ponto
 * mais antigo já coberto ainda não alcança o histórico completo, o alvo é
 * estendido para trás ("extend") e o backfill continua nas mesmas janelas.
 *
 * ⚠️ A extensão olha `covered_from`, não `target_from`: o `requestAmazonSync`
 * ESTREITA o alvo a cada reabertura (`target_from = covered_to`), então um alvo
 * recente é rotina — só o `covered_from` diz se há história antiga de verdade
 * ainda não importada. Basear a extensão no alvo faria cada reabertura
 * redisparar o backfill inteiro.
 */
export function nextAmazonOrderWindow(input: {
  windowFromMs: number;
  targetFromMs: number;
  coveredFromMs: number | null;
  historyFloorMs: number;
  windowMs: number;
  toleranceMs: number;
}): AmazonWindowAdvance {
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
