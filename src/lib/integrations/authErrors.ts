/**
 * Erro de autorização de canal: o refresh token foi revogado ou perdeu a
 * validade, e nenhuma nova tentativa vai adiantar — só reconectar.
 *
 * Existe para a UI conseguir distinguir "o marketplace está instável" (tentar de
 * novo) de "a autorização caiu" (reconectar). Sem essa distinção, o app mostra
 * erro genérico e manda procurar problema no lugar errado.
 */
export class ChannelAuthExpiredError extends Error {
  readonly code = "CHANNEL_AUTH_EXPIRED";
  // ⚠️ Campo declarado e atribuído no corpo, NÃO como parameter property
  // (`constructor(msg, readonly cause)`). O `--experimental-strip-types` do Node
  // recusa parameter property, e como este arquivo está na cadeia de imports de
  // TODO adapter de canal, a forma antiga tornava intestável qualquer módulo que
  // importasse o adapter — o teste morria antes de rodar, com um erro de sintaxe
  // que não tinha nada a ver com o que estava sendo testado (28/08/2026).
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ChannelAuthExpiredError";
    this.cause = cause;
  }
}

export function isChannelAuthExpired(error: unknown): error is ChannelAuthExpiredError {
  return error instanceof ChannelAuthExpiredError;
}
