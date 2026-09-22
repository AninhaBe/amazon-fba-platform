// Assinatura das notificações da Amazon POR CONTA, ligada no fluxo de conectar
// conta (ADR-023). Idempotente: pode rodar em toda conexão e no backfill sem
// duplicar nada. NÃO escala fazer isto à mão — com N vendedores, cada um assina
// sozinho ao conectar.

const HOST = process.env.SPAPI_HOST || "https://sellingpartnerapi-na.amazon.com";
const NOTIFICATION_TYPE = "ORDER_CHANGE";

function clientCredenciais(): { id: string; secret: string } | null {
  const id = process.env.OAUTH_CLIENT_ID || process.env.LWA_CLIENT_ID;
  const secret = process.env.OAUTH_CLIENT_SECRET || process.env.LWA_CLIENT_SECRET;
  return id && secret ? { id, secret } : null;
}

/**
 * ARN da fila derivado do `SQS_QUEUE_URL` — a mesma fila que o consumidor lê.
 * `https://sqs.<região>.amazonaws.com/<conta>/<nome>` → `arn:aws:sqs:<região>:<conta>:<nome>`.
 * Puro e testável: um ARN errado faz o `createDestination` recusar, calado.
 */
export function arnDaFila(queueUrl: string): string | null {
  const m = queueUrl.match(/^https:\/\/sqs\.([^.]+)\.amazonaws\.com\/(\d+)\/(.+)$/);
  if (!m) return null;
  const [, regiao, conta, nome] = m;
  return `arn:aws:sqs:${regiao}:${conta}:${nome}`;
}

async function token(body: Record<string, string>): Promise<string | null> {
  const cred = clientCredenciais();
  if (!cred) return null;
  const r = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...body, client_id: cred.id, client_secret: cred.secret }),
  });
  const d = (await r.json()) as { access_token?: string };
  return d.access_token ?? null;
}

const tokenGrantless = () => token({ grant_type: "client_credentials", scope: "sellingpartnerapi::notifications" });
const tokenDaConta = (refreshToken: string) => token({ grant_type: "refresh_token", refresh_token: refreshToken });

/**
 * Garante que a fila está registrada como destino (nível do APP — uma vez para
 * todos os vendedores). Devolve o `destinationId` existente ou o recém-criado.
 * `null` se a infra AWS não está configurada (degradação limpa do ADR).
 */
export async function garantirDestinoSqs(): Promise<string | null> {
  const queueUrl = process.env.SQS_QUEUE_URL;
  if (!queueUrl) return null;
  const arn = arnDaFila(queueUrl);
  if (!arn) return null;
  const T = await tokenGrantless();
  if (!T) return null;
  const H = { "x-amz-access-token": T, "Content-Type": "application/json" };

  const lista = await fetch(`${HOST}/notifications/v1/destinations`, { headers: H });
  if (lista.ok) {
    const d = (await lista.json()) as { payload?: Array<{ destinationId: string; resource?: { sqs?: { arn?: string } } }> };
    const existente = d.payload?.find((x) => x.resource?.sqs?.arn === arn);
    if (existente) return existente.destinationId;
  }
  const criado = await fetch(`${HOST}/notifications/v1/destinations`, {
    method: "POST", headers: H,
    body: JSON.stringify({ name: "nexo-amazon-sqs", resourceSpecification: { sqs: { arn } } }),
  });
  if (!criado.ok) {
    console.error("[amazon-notif-setup] createDestination falhou", criado.status, (await criado.text()).slice(0, 200));
    return null;
  }
  const d = (await criado.json()) as { payload?: { destinationId?: string } };
  return d.payload?.destinationId ?? null;
}

/**
 * Garante a assinatura ORDER_CHANGE da CONTA. Idempotente: se já existe, não faz
 * nada. Best-effort — falha não trava a conexão (o polling cobre). Devolve true
 * se a conta está assinada ao fim.
 *
 * ⚠️ O `eventFilter` do ORDER_CHANGE NÃO aceita `marketplaceIds` (issue oficial
 * #4135) — só `orderChangeTypes` + `eventFilterType`. Ver ADR-023.
 */
export async function garantirAssinaturaAmazon(sellerId: string, refreshToken: string): Promise<boolean> {
  try {
    const destinationId = await garantirDestinoSqs();
    if (!destinationId) return false;
    const T = await tokenDaConta(refreshToken);
    if (!T) return false;
    const H = { "x-amz-access-token": T, "Content-Type": "application/json" };

    const atual = await fetch(`${HOST}/notifications/v1/subscriptions/${NOTIFICATION_TYPE}`, { headers: H });
    if (atual.ok) return true; // já assinada

    const criada = await fetch(`${HOST}/notifications/v1/subscriptions/${NOTIFICATION_TYPE}`, {
      method: "POST", headers: H,
      body: JSON.stringify({
        payloadVersion: "1.0",
        destinationId,
        processingDirective: { eventFilter: { orderChangeTypes: ["OrderStatusChange"], eventFilterType: "ORDER_CHANGE" } },
      }),
    });
    if (!criada.ok) {
      console.error("[amazon-notif-setup] createSubscription falhou", sellerId, criada.status, (await criada.text()).slice(0, 200));
      return false;
    }
    return true;
  } catch (erro) {
    console.error("[amazon-notif-setup] garantirAssinatura erro", sellerId, erro instanceof Error ? erro.message : erro);
    return false;
  }
}
