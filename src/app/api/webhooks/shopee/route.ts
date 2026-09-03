import { NextRequest, NextResponse } from "next/server";
import { dbQuery, hasDb } from "@/lib/db";
import { currentWorkspaceId, runWithWorkspace } from "@/lib/workspaceScope";
import { depoisDaResposta } from "@/lib/depoisDaResposta";
import {
  chaveDoEvento,
  interpretarPush,
  ehPingDeVerificacao,
  urlPublicaDoPush,
  verificarAssinaturaDoPush,
  type EventoDePush,
} from "@/lib/integrations/shopeePush";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PUSH DA SHOPEE — o canal nos avisa, em vez de a gente perguntar.
 *
 * ⚠️ A VARREDURA CONTINUA. Push acelera, poll garante: se o push falhar, atrasar
 * ou nunca ser cadastrado, o ciclo de 3 minutos cobre. Esta rota nunca é a
 * ÚNICA fonte de um pedido — é por isso que ela pode ser simples e recusar em
 * caso de dúvida, em vez de tentar salvar o evento a qualquer custo.
 *
 * ⚠️ E ELA NÃO CARIMBA `last_success_at`. Essa coluna é da varredura e é o que o
 * vigia de defasagem lê; push gravando nela faria varredura PARADA parecer
 * saudável — foi o defeito medido no webhook do ML em 02/09/2026. Push carimba
 * `last_push_at` (migration 0031).
 *
 * 🔴 DEPENDÊNCIA DE SEQUÊNCIA: esta rota escreve `last_push_at`. Ela **não pode
 * subir antes do apply da 0031** — seria o espelho do incidente da manhã, onde o
 * leitor exigia coluna que a view não tinha; aqui o escritor exigiria coluna que
 * a tabela não tem.
 */

export async function GET() {
  // Diagnóstico sem segredo: diz se está configurada, nunca o quê.
  return NextResponse.json({
    service: "shopee-push",
    configured: Boolean(process.env.SHOPEE_PUSH_PARTNER_KEY && process.env.DATABASE_URL),
  });
}

export async function POST(req: NextRequest) {
  const chave = process.env.SHOPEE_PUSH_PARTNER_KEY ?? null;
  const corpoBruto = await req.text().catch(() => null);
  if (corpoBruto == null) return NextResponse.json({ error: "corpo ilegivel" }, { status: 400 });
  // Teto de corpo antes de qualquer trabalho: rota pública recebe o que
  // mandarem, e um push legítimo da Shopee é pequeno.
  if (corpoBruto.length > 64 * 1024) {
    return NextResponse.json({ error: "corpo grande demais" }, { status: 413 });
  }

  // De qual header veio a assinatura importa para o diagnóstico: as fontes de
  // terceiro divergem entre `Authorization` e `x-shopee-signature`.
  const headerDaAssinatura = req.headers.get("authorization")
    ? "authorization"
    : req.headers.get("x-shopee-signature") ? "x-shopee-signature" : null;
  const assinatura = headerDaAssinatura ? req.headers.get(headerDaAssinatura) : null;
  // ⚠️ A URL PUBLICA, NAO a da requisicao: `req.nextUrl.href` e o host interno
  // atras do proxy do Fly (medido: https://0.0.0.0:3000/...), e a Shopee assina
  // o endereco cadastrado no console.
  const url = urlPublicaDoPush();
  // ⚠️ O CORPO E LIDO ANTES DA VERIFICACAO — mas so para SABER SE E O PING de
  // verificacao, nunca para agir. Um JSON.parse sobre texto ja limitado a 64 KB
  // nao e superficie de ataque; agir sobre ele antes de verificar, seria.
  let corpoJson: unknown = null;
  try { corpoJson = JSON.parse(corpoBruto); } catch { corpoJson = null; }
  const ehPing = ehPingDeVerificacao(corpoJson);

  const { valida, formulaQueBateria, chaveQueBateria } = verificarAssinaturaDoPush({
    url, corpoBruto, assinatura, ehPing,
    chaves: { push: chave },
  });
  if (!valida) {
    // ⚠️ O DIAGNÓSTICO VAI PARA O LOG E NUNCA PARA A RESPOSTA — dizer ao chamador
    // qual fórmula bateria seria entregar o mapa de como forjar.
    //
    // ⚠️ E NADA AQUI É SEGREDO, de propósito: nome do header, tamanho e prefixo
    // da assinatura RECEBIDA (que o próprio remetente escreveu), o caminho que
    // a Shopee chamou e o começo do corpo do push. Chave nenhuma é registrada,
    // nem inteira nem em pedaço.
    console.error("[push-shopee] assinatura recusada", {
      temChavePush: Boolean(chave),
      headerDaAssinatura,
      tamanhoDaAssinatura: assinatura?.length ?? 0,
      prefixoDaAssinatura: assinatura?.slice(0, 12) ?? null,
      // O que a Shopee chamou de fato — se vier com query string ou host
      // diferente do que assinamos, a base string `url|corpo` nunca bate.
      urlQueAssinamos: url,
      urlQueRecebemos: req.nextUrl.href,
      caminho: req.nextUrl.pathname,
      contentType: req.headers.get("content-type"),
      tamanhoDoCorpo: corpoBruto.length,
      inicioDoCorpo: corpoBruto.slice(0, 200),
      // Quando estes dois vierem preenchidos, a combinação certa é essa:
      // fórmula + chave. `chaveQueBateria: "app"` significaria que a Shopee
      // assinou com a partner_key do app — e aí a ação é SALVAR a página do
      // console, nunca passar a aceitar a chave da API como chave de push.
      formulaQueBateria,
      chaveQueBateria,
      ehPing,
      // E os BYTES EXATOS do corpo, sem interpretacao: se nem a matriz bater, a
      // resposta esta aqui — da para reproduzir offline com fidelidade total.
      corpoEmBase64: Buffer.from(corpoBruto, "utf8").toString("base64"),
      assinaturaCompleta: assinatura,
    });
    return NextResponse.json({ error: "assinatura invalida" }, { status: 401 });
  }

  if (corpoJson == null) return NextResponse.json({ error: "corpo invalido" }, { status: 400 });
  // Ping de verificacao: assinatura ja conferida acima, e ele nao carrega dado
  // nenhum. 200 e o console cadastra a URL.
  if (ehPing) return NextResponse.json({ received: true, verified: true });
  const evento = interpretarPush(corpoJson);
  // Push que não é de pedido (a Shopee oferece 29 tipos) é reconhecido e
  // ignorado: responder erro faria a Shopee reentregar para sempre.
  if (!evento) return NextResponse.json({ received: true, ignored: true });

  if (!hasDb()) return NextResponse.json({ error: "indisponivel" }, { status: 503 });

  const alvos = await dbQuery<{ workspace_id: string; id: string }>(
    `SELECT workspace_id, id
       FROM workspace_integrations
      WHERE provider = 'shopee' AND external_account_id = $1 AND status = 'connected'`,
    [evento.shopId],
  );
  // Loja que não é nossa: 200 e nada feito. Erro faria a Shopee reentregar um
  // evento que nunca vai nos servir.
  if (!alvos.length) return NextResponse.json({ received: true, ignored: true });

  const eventKey = chaveDoEvento(evento);
  const novos: Array<{ workspaceId: string; connectionId: string }> = [];
  for (const alvo of alvos) {
    const inserido = await dbQuery<{ event_key: string }>(
      `INSERT INTO workspace_marketplace_events
         (workspace_id, provider, event_key, connection_id, topic, resource, payload)
       VALUES ($1, 'shopee', $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (workspace_id, provider, event_key) DO NOTHING
       RETURNING event_key`,
      [alvo.workspace_id, eventKey, alvo.id, "order_status", evento.orderSn, corpoBruto],
    );
    if (inserido.length) novos.push({ workspaceId: alvo.workspace_id, connectionId: alvo.id });
  }

  if (novos.length) {
    // Resposta imediata + trabalho depois: a Shopee reentrega se demorarmos.
    depoisDaResposta("push-shopee:processa", async () => {
      for (const alvo of novos) {
        try {
          await runWithWorkspace(alvo.workspaceId, () => processarPush(alvo.connectionId, evento, eventKey));
        } catch (erro) {
          console.error("[push-shopee] falha ao processar", {
            eventKey,
            motivo: erro instanceof Error ? erro.message : "desconhecido",
          });
        }
      }
    });
  }

  return NextResponse.json({ received: true, queued: novos.length });
}

/**
 * ⚠️ O PUSH NÃO ESCREVE O PEDIDO A PARTIR DO CORPO DO EVENTO.
 *
 * Ele usa o `order_sn` para buscar o detalhe pela MESMA rota da varredura e
 * grava pelo MESMO caminho canônico. Escrever a partir do corpo do push criaria
 * um segundo caminho de escrita: o push gravaria um formato, o poll outro, e a
 * divergência apareceria semanas depois como número que não bate — o defeito que
 * a ADR-025 nasceu para matar, em outra roupa.
 */
async function processarPush(connectionId: string, evento: EventoDePush, eventKey: string) {
  const { getIntegration } = await import("@/lib/integrations/integrationStore");
  const { getShopeeOrderDetail } = await import("@/lib/integrations/shopee");
  const { normalizeShopeeOrder } = await import("@/lib/integrations/shopeeCanonical");
  const { saveCanonicalOrders } = await import("@/lib/integrations/canonicalStore");
  type PedidoDaShopee = Parameters<typeof normalizeShopeeOrder>[0];

  const conexao = await getIntegration(connectionId);
  if (!conexao) return;
  const detalhe = await getShopeeOrderDetail(conexao, [evento.orderSn]);
  const pedidos = (detalhe.order_list ?? []) as PedidoDaShopee[];
  if (!pedidos.length) return;
  await saveCanonicalOrders(
    { provider: "shopee", connectionId },
    pedidos.map((pedido) => normalizeShopeeOrder(pedido)),
  );

  // ⚠️ O EVENTO É MARCADO COMO PROCESSADO — medido em 02/09/2026: os dois
  // primeiros pushes reais entraram, os pedidos foram gravados, e as linhas
  // ficaram em `status = 'pending'` para sempre. Não quebrava nada hoje, e é
  // exatamente por isso que passaria despercebido: uma fila cujo "pendente"
  // nunca esvazia deixa de distinguir "falta processar" de "já foi", e o dia em
  // que alguém escrever um reprocessador ele varre tudo de novo.
  await dbQuery(
    `UPDATE workspace_marketplace_events
        SET status = 'processed', processed_at = now()
      WHERE workspace_id = $1 AND provider = 'shopee' AND event_key = $2`,
    [currentWorkspaceId(), eventKey],
  );

  // `last_push_at`, NUNCA `last_success_at` — ver a nota no topo e a 0031.
  //
  // ⚠️ E NUNCA `updated_at` TAMBEM. O scheduler usa essa coluna como "quando foi
  // a ultima tentativa da varredura" para decidir o backoff de erro; push
  // gravando nela mantem a conexao eternamente "recem-tentada" e ela nunca volta
  // a ser candidata. Aconteceu no ML em 03/09/2026 — 11 horas sem varredura, com
  // o push entregando e a tela parecendo viva.
  // ⚠️ COM `workspace_id`, mesmo estando dentro de `runWithWorkspace`: o escopo
  // do AsyncLocalStorage protege quem o usa, e este UPDATE nao usa — ele iria
  // por `connection_id`, que e o mesmo id de conexao para qualquer inquilino que
  // conecte a MESMA loja. Filtro do cliente ESTREITA o escopo, nunca o define.
  await dbQuery(
    `UPDATE workspace_marketplace_syncs
        SET last_push_at = now()
      WHERE workspace_id = $1 AND provider = 'shopee' AND connection_id = $2`,
    [currentWorkspaceId(), connectionId],
  );
}
