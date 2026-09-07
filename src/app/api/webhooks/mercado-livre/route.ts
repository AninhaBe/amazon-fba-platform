import { NextRequest, NextResponse } from "next/server";
import {
  enqueueMercadoLivreNotification,
  processMercadoLivreEvent,
  type QueuedMercadoLivreEvent,
} from "@/lib/integrations/mercadoLivreWebhook";
import {
  MercadoLivreWebhookConfigurationError,
  parseMercadoLivreNotification,
} from "@/lib/integrations/mercadoLivreNotification";
import { depoisDaResposta } from "@/lib/depoisDaResposta";
import { avaliarOrigemDoWebhook } from "@/lib/integrations/webhookMlToken";
import { LIMITE_DE_CORPO } from "@/lib/limiteDeCorpo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Diagnóstico. ⚠️ NÃO diz se há token configurado, nem qual é a janela de
 * convivência, nem se alguma conexão existe: é rota pública, e cada campo a mais
 * é um campo que ajuda quem está sondando. `configured` já era o contrato.
 */
export async function GET() {
  return NextResponse.json({
    service: "mercado-livre-webhook",
    configured: Boolean(process.env.MELI_CLIENT_ID && process.env.DATABASE_URL),
  });
}

/** Resposta para origem não reconhecida: a rota simplesmente não existe. */
function naoEncontrado() {
  // ⚠️ 404, NUNCA 401/403. Os dois últimos CONFIRMAM que o endpoint existe e que
  // há um segredo a adivinhar — é a mesma regra do `/admin` (ADR-024). Para quem
  // não tem o token, esta rota não existe.
  return new NextResponse("Not Found", { status: 404 });
}

export async function POST(req: NextRequest) {
  // ⚠️ A ORIGEM É CONFERIDA ANTES DE QUALQUER LEITURA DO CORPO — e antes de
  // qualquer escrita. É isso que impede um evento forjado de carimbar
  // `last_push_at`: sem esse carimbo o vigia de defasagem continua vendo a
  // varredura parada, e um atacante não consegue mascarar push morto.
  const origem = avaliarOrigemDoWebhook({
    tokenRecebido: req.nextUrl.searchParams.get("token"),
    tokenEsperado: process.env.WEBHOOK_ML_TOKEN,
    agora: new Date(),
  });
  if (!origem.aceito) return naoEncontrado();
  if (origem.via === "sem-token-configurado") {
    console.warn("[webhook-ml] WEBHOOK_ML_TOKEN ausente: a rota aceita qualquer origem.");
  }
  // ⚠️ REGISTRA POR QUAL CAMINHO O PUSH ENTROU — só o nome do caminho, nunca o
  // token. Sem isto, o passo 3 da lista de morte da janela ("um push real
  // chegando pela URL nova — MEDIDO, não suposto", ver `webhookMlToken.ts`) é
  // inverificável: push chegando prova que a rota funciona, não que o DevCenter
  // já aponta para a URL com token. E é justamente essa diferença que decide se
  // o webhook continua vivo depois de FIM_DA_CONVIVENCIA.
  //
  // `convivencia` em 07/09/2026 = o cadastro no DevCenter ainda é o antigo, e
  // o push MORRE na data. `token` = o cadastro foi trocado e a janela pode cair.
  if (origem.via === "convivencia") {
    console.warn("[webhook-ml] push aceito SEM token (janela de convivência): o DevCenter do ML ainda aponta para a URL antiga.");
  } else if (origem.via === "token") {
    console.info("[webhook-ml] push aceito COM token: a URL nova está cadastrada no DevCenter.");
  }

  try {
    // ⚠️ TETO DE BYTES ANTES DO `JSON.parse`. O limite de 100 eventos existia,
    // mas só vale DEPOIS de parsear — e parsear é a parte cara. Rota pública
    // recebe o que mandarem; um lote legítimo do ML é pequeno. A Shopee já
    // tinha teto (64KB) e o formulário de orçamento também (4KB): só estes dois
    // webhooks não tinham, achado na auditoria de 07/09/2026.
    const bruto = await req.text();
    if (bruto.length > LIMITE_DE_CORPO) {
      return NextResponse.json({ error: "Corpo grande demais." }, { status: 413 });
    }
    const body = JSON.parse(bruto) as unknown;
    const candidates = body && typeof body === "object" && Array.isArray((body as { messages?: unknown[] }).messages)
      ? (body as { messages: unknown[] }).messages
      : [body];
    if (!candidates.length) throw new RangeError("Lote de notificações vazio.");
    if (candidates.length > 100) throw new RangeError("Lote de notificações excede o limite de 100 eventos.");
    const notifications = candidates.map(parseMercadoLivreNotification);
    const queued: QueuedMercadoLivreEvent[] = [];
    for (const notification of notifications) {
      queued.push(...await enqueueMercadoLivreNotification(notification));
    }

    if (queued.length) {
      depoisDaResposta("webhook-ml:processa", async () => {
        for (const event of queued) {
          try {
            await processMercadoLivreEvent(event);
          } catch (error) {
            console.error("Falha ao processar webhook do Mercado Livre", {
              eventKey: event.eventKey,
              reason: error instanceof Error ? error.message : "Erro desconhecido",
            });
          }
        }
      });
    }

    // ⚠️ A RESPOSTA NÃO DIZ QUANTOS ENTRARAM NA FILA. `queued.length` era zero
    // para `user_id` desconhecido e maior que zero para conhecido — o que
    // transformava esta rota num oráculo de enumeração: bastava variar o id até
    // a resposta mudar para descobrir quais vendedores usam o NEXO.
    //
    // O Mercado Livre recomenda confirmação imediata para evitar reentregas, e
    // ele não lê este corpo. O processamento segue igual, em segundo plano.
    return NextResponse.json({ received: true });
  } catch (error) {
    const invalid = error instanceof RangeError;
    const misconfigured = error instanceof MercadoLivreWebhookConfigurationError;
    return NextResponse.json(
      { error: invalid || misconfigured ? error.message : "Não foi possível receber a notificação." },
      { status: invalid ? 400 : 503 }
    );
  }
}
