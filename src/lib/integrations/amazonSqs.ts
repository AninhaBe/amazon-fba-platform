import { createHash, createHmac } from "node:crypto";

// Cliente SQS mínimo, sem SDK da AWS (ADR-023: nada de peça/dep nova). Assina
// requisições com SigV4 e usa o protocolo JSON do SQS (2023) — resposta JSON, sem
// XML pra parsear. Só duas ações: ReceiveMessage (long poll) e DeleteMessage.
//
// ⚠️ SEM DEPENDÊNCIA por escolha, não por economia: o repo já assina HMAC em três
// canais (Shopee, TikTok, Stripe) com `node:crypto`. SigV4 é a mesma HMAC-SHA256
// numa cadeia de quatro chaves — cabe aqui, e o SDK traria ~3 MB e uma superfície
// que este consumo (2 ações) não usa.

export interface CredenciaisAws {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

export interface MensagemSqs {
  receiptHandle: string;
  body: string;
  messageId: string;
}

const sha256Hex = (dados: string): string => createHash("sha256").update(dados, "utf8").digest("hex");
const hmac = (chave: Buffer | string, dados: string): Buffer => createHmac("sha256", chave).update(dados, "utf8").digest();

/**
 * Chave de assinatura SigV4: HMAC encadeado data → região → serviço → aws4_request.
 * Exportada para o teste de vetor conhecido (a única forma de provar que a
 * cadeia está certa sem chamar a AWS de verdade).
 */
export function chaveDeAssinatura(secret: string, data: string, region: string, service: string): Buffer {
  const kDate = hmac(`AWS4${secret}`, data);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

/**
 * Assina e envia UMA chamada JSON ao SQS. `target` é o `X-Amz-Target`
 * (`AmazonSQS.ReceiveMessage` etc.). Devolve o JSON de resposta já parseado.
 *
 * A data usada na assinatura e no header `x-amz-date` é a MESMA (`amzDate`): SigV4
 * rejeita se divergirem, e foi o erro clássico de quem assina à mão.
 */
async function chamarSqs<T>(target: string, corpo: unknown, creds: CredenciaisAws, signal?: AbortSignal): Promise<T> {
  const service = "sqs";
  const host = `sqs.${creds.region}.amazonaws.com`;
  const body = JSON.stringify(corpo);
  const agora = new Date();
  const amzDate = agora.toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);
  const contentType = "application/x-amz-json-1.0";

  const headersCanonicos =
    `content-type:${contentType}\n` +
    `host:${host}\n` +
    `x-amz-date:${amzDate}\n` +
    `x-amz-target:${target}\n`;
  const signedHeaders = "content-type;host;x-amz-date;x-amz-target";
  const canonicalRequest = [
    "POST", "/", "", headersCanonicos, signedHeaders, sha256Hex(body),
  ].join("\n");

  const scope = `${dateStamp}/${creds.region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const assinatura = hmac(chaveDeAssinatura(creds.secretAccessKey, dateStamp, creds.region, service), stringToSign).toString("hex");
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${assinatura}`;

  const resposta = await fetch(`https://${host}/`, {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      "X-Amz-Target": target,
      "X-Amz-Date": amzDate,
      Authorization: authorization,
      Host: host,
    },
    body,
    signal,
  });
  const texto = await resposta.text();
  if (!resposta.ok) {
    throw new Error(`SQS ${target} respondeu ${resposta.status}: ${texto.slice(0, 300)}`);
  }
  return (texto ? JSON.parse(texto) : {}) as T;
}

/**
 * Long poll: espera até `waitSeconds` por até `max` mensagens. WaitTimeSeconds=20
 * é o teto do SQS e o que o ADR-023 pede — uma requisição cobre 20 s de espera.
 */
export async function receberMensagens(
  queueUrl: string,
  creds: CredenciaisAws,
  { max = 10, waitSeconds = 20, signal }: { max?: number; waitSeconds?: number; signal?: AbortSignal } = {},
): Promise<MensagemSqs[]> {
  const r = await chamarSqs<{ Messages?: Array<{ ReceiptHandle: string; Body: string; MessageId: string }> }>(
    "AmazonSQS.ReceiveMessage",
    { QueueUrl: queueUrl, MaxNumberOfMessages: max, WaitTimeSeconds: waitSeconds },
    creds,
    signal,
  );
  return (r.Messages ?? []).map((m) => ({ receiptHandle: m.ReceiptHandle, body: m.Body, messageId: m.MessageId }));
}

/** Apaga a mensagem — só depois de gravada na caixa (ADR-023: falha devolve à fila). */
export async function apagarMensagem(queueUrl: string, receiptHandle: string, creds: CredenciaisAws): Promise<void> {
  await chamarSqs("AmazonSQS.DeleteMessage", { QueueUrl: queueUrl, ReceiptHandle: receiptHandle }, creds);
}

/** Lê as credenciais do ambiente; `null` se a infra AWS não estiver configurada (degradação limpa do ADR). */
export function credenciaisAwsDoAmbiente(): (CredenciaisAws & { queueUrl: string }) | null {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const region = process.env.AWS_REGION;
  const queueUrl = process.env.SQS_QUEUE_URL;
  if (!accessKeyId || !secretAccessKey || !region || !queueUrl) return null;
  return { accessKeyId, secretAccessKey, region, queueUrl };
}
