import { dbQuery, hasDb } from "../db";
import {
  apagarMensagem,
  credenciaisAwsDoAmbiente,
  receberMensagens,
  type MensagemSqs,
} from "./amazonSqs";

// Consumidor das notificações da Amazon (ADR-023). Long poll da fila SQS, grava
// o aviso na MESMA caixa do Mercado Livre (`workspace_marketplace_events`), e só
// então apaga a mensagem. A notificação traz "mudou", não o dado — quem busca é a
// SP-API autenticada, e o polling de 2 min continua sendo a rede.

const PROVIDER = "amazon";

export interface NotificacaoAmazon {
  notificationId: string;
  notificationType: string;
  sellerId: string;
  amazonOrderId: string | null;
}

/**
 * Interpreta o corpo de UMA mensagem SQS. Função pura — é o que o teste exercita
 * sem AWS nem banco. Devolve `null` para o que não é notificação de negócio
 * (confirmação de assinatura, corpo ilegível): o chamador apaga sem gravar.
 *
 * Forma do ORDER_CHANGE (medida): `Payload.OrderChangeNotification.{SellerId,
 * AmazonOrderId}` e `NotificationMetadata.NotificationId`.
 */
export function interpretarNotificacao(body: string): NotificacaoAmazon | null {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return null;
  }
  const obj = (v: unknown): Record<string, unknown> =>
    v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

  const n = obj(json);
  const notificationType = str(n.NotificationType);
  const notificationId = str(obj(n.NotificationMetadata).NotificationId);
  if (!notificationType || !notificationId) return null;

  // O SellerId mora dentro do payload específico do tipo. ORDER_CHANGE é o único
  // que assinamos hoje; outros tipos entram aqui quando forem assinados — por
  // isso pegamos a primeira sub-carga quando não é o ORDER_CHANGE nomeado.
  const payload = obj(n.Payload);
  const carga = obj(payload.OrderChangeNotification ?? payload[Object.keys(payload)[0] ?? ""]);
  const sellerId = str(carga.SellerId);
  if (!sellerId) return null;
  const amazonOrderId = str(carga.AmazonOrderId);
  return { notificationId, notificationType, sellerId, amazonOrderId };
}

/** workspace da conta pelo seller_id — o evento só é gravado se a conta é nossa. */
async function workspaceDoSeller(sellerId: string): Promise<string | null> {
  const rows = await dbQuery<{ workspace_id: string }>(
    `SELECT workspace_id FROM workspace_accounts WHERE seller_id = $1 LIMIT 1`,
    [sellerId],
  );
  return rows[0]?.workspace_id ?? null;
}

/**
 * Grava o aviso na caixa (dedup por `event_key = NotificationId`). Mesmo INSERT do
 * Mercado Livre: reabre para `pending` se o evento anterior falhou ou travou em
 * `processing` por mais de 5 min. `connection_id = amazon:<sellerId>`.
 */
async function gravarNaCaixa(workspaceId: string, evento: NotificacaoAmazon, body: string): Promise<void> {
  await dbQuery(
    `INSERT INTO workspace_marketplace_events
       (workspace_id, provider, event_key, connection_id, topic, resource, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
     ON CONFLICT (workspace_id, provider, event_key) DO UPDATE SET
       connection_id = EXCLUDED.connection_id, topic = EXCLUDED.topic,
       resource = EXCLUDED.resource, payload = EXCLUDED.payload,
       status = 'pending', processing_at = NULL, last_error = NULL
     WHERE workspace_marketplace_events.status IN ('pending', 'error')
        OR (workspace_marketplace_events.status = 'processing'
            AND (workspace_marketplace_events.processing_at IS NULL
                 OR workspace_marketplace_events.processing_at < now() - interval '5 minutes'))`,
    [workspaceId, PROVIDER, evento.notificationId, `amazon:${evento.sellerId}`,
     evento.notificationType, evento.amazonOrderId ?? "", body],
  );
}

export interface ResultadoConsumo {
  executou: boolean;
  recebidas: number;
  gravadas: number;
  ignoradas: number;
  motivo?: string;
}

/**
 * Um ciclo de consumo: recebe (long poll), grava e apaga. Best-effort por
 * mensagem — uma que falha ao gravar NÃO é apagada (volta à fila; a DLQ pega
 * veneno depois de N tentativas). Sem infra AWS, retorna sem fazer nada
 * (degradação limpa do ADR — o polling cobre).
 */
export async function consumirNotificacoesAmazon(
  { signal }: { signal?: AbortSignal } = {},
): Promise<ResultadoConsumo> {
  if (!hasDb()) return { executou: false, recebidas: 0, gravadas: 0, ignoradas: 0, motivo: "sem banco" };
  const creds = credenciaisAwsDoAmbiente();
  if (!creds) return { executou: false, recebidas: 0, gravadas: 0, ignoradas: 0, motivo: "infra AWS não configurada" };

  let mensagens: MensagemSqs[];
  try {
    mensagens = await receberMensagens(creds.queueUrl, creds, { signal });
  } catch (erro) {
    console.error("[amazon-notif] ReceiveMessage falhou", erro instanceof Error ? erro.message : erro);
    return { executou: false, recebidas: 0, gravadas: 0, ignoradas: 0, motivo: "receive falhou" };
  }

  let gravadas = 0, ignoradas = 0;
  for (const m of mensagens) {
    const evento = interpretarNotificacao(m.body);
    try {
      if (!evento) {
        // Corpo que não é notificação de negócio (confirmação/teste): apaga e segue.
        ignoradas += 1;
        await apagarMensagem(creds.queueUrl, m.receiptHandle, creds);
        continue;
      }
      const workspaceId = await workspaceDoSeller(evento.sellerId);
      if (!workspaceId) {
        // Conta que não é nossa (não deveria acontecer — só assinamos as nossas).
        // Apaga para não travar a fila; fica o log.
        ignoradas += 1;
        console.warn("[amazon-notif] seller sem workspace, descartando", evento.sellerId);
        await apagarMensagem(creds.queueUrl, m.receiptHandle, creds);
        continue;
      }
      await gravarNaCaixa(workspaceId, evento, m.body);
      await apagarMensagem(creds.queueUrl, m.receiptHandle, creds);
      gravadas += 1;
    } catch (erro) {
      // Falha ao gravar/apagar: NÃO apaga a mensagem — ela volta à fila.
      console.error("[amazon-notif] falha ao processar mensagem", m.messageId, erro instanceof Error ? erro.message : erro);
    }
  }
  return { executou: true, recebidas: mensagens.length, gravadas, ignoradas };
}
