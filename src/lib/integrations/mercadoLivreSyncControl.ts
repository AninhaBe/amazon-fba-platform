// Helpers puros do sync do Mercado Livre — mesmo papel do shopeeSyncControl e
// do tiktokSyncControl: decisão de checkpoint testável sem banco nem rede.

export class MercadoLivreLeaseLostError extends Error {}

export type MercadoLivreWindowAdvance =
  | { kind: "complete" }
  | { kind: "advance"; nextFromMs: number; nextToMs: number };

/**
 * Decide o próximo movimento da janela de pedidos ao fechar uma página
 * completa: anda para trás até o alvo e conclui ao alcançá-lo. O alvo de conta
 * nova é o mês vigente (ver `inicioDoMes.ts`) — sem aprofundamento retroativo
 * além dele (decisão da Ana, 27/08/2026).
 */
export function nextMercadoLivreOrderWindow(input: {
  windowFromMs: number;
  targetFromMs: number;
  windowMs: number;
}): MercadoLivreWindowAdvance {
  if (input.windowFromMs > input.targetFromMs) {
    const nextToMs = input.windowFromMs;
    return {
      kind: "advance",
      nextToMs,
      nextFromMs: Math.max(input.targetFromMs, nextToMs - input.windowMs),
    };
  }
  return { kind: "complete" };
}
