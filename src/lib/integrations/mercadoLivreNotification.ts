export interface MercadoLivreNotification {
  _id?: string;
  resource: string;
  user_id: string | number;
  topic: string;
  application_id: string | number;
  attempts?: number;
  sent?: string;
  received?: string;
}

export class MercadoLivreWebhookConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MercadoLivreWebhookConfigurationError";
  }
}

export function parseMercadoLivreNotification(value: unknown): MercadoLivreNotification {
  if (!value || typeof value !== "object") throw new RangeError("Notificação inválida.");
  const input = value as Partial<MercadoLivreNotification>;
  const topic = typeof input.topic === "string" ? input.topic.trim() : "";
  const resource = typeof input.resource === "string" ? input.resource.trim() : "";
  const userId = input.user_id == null ? "" : String(input.user_id).trim();
  const applicationId = input.application_id == null ? "" : String(input.application_id).trim();
  const eventId = typeof input._id === "string" ? input._id.trim() : "";
  const sent = typeof input.sent === "string" ? input.sent.trim() : "";
  const received = typeof input.received === "string" ? input.received.trim() : "";
  if (!topic || !resource || !userId || !applicationId || !resource.startsWith("/")) {
    throw new RangeError("Notificação incompleta.");
  }
  const expectedApplicationId = process.env.MELI_CLIENT_ID?.trim();
  if (!expectedApplicationId) {
    throw new MercadoLivreWebhookConfigurationError("MELI_CLIENT_ID não está configurado.");
  }
  if (applicationId !== expectedApplicationId) {
    throw new RangeError("Aplicação do Mercado Livre não reconhecida.");
  }
  return {
    resource,
    topic,
    user_id: userId,
    application_id: applicationId,
    ...(eventId ? { _id: eventId } : {}),
    ...(typeof input.attempts === "number" ? { attempts: input.attempts } : {}),
    ...(sent ? { sent } : {}),
    ...(received ? { received } : {}),
  };
}
