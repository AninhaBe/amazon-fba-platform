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

  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "ChannelAuthExpiredError";
  }
}

export function isChannelAuthExpired(error: unknown): error is ChannelAuthExpiredError {
  return error instanceof ChannelAuthExpiredError;
}
