import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { exchangeAuthCode, getAuthorizedShops, epochToIso, TIKTOK_OAUTH_STATE_COOKIE } from "@/lib/tiktok";
import { saveTiktokAuthorization } from "@/lib/tiktokStore";
import { validarConviteTiktok } from "@/lib/tiktokInvite";
import { appDaAutorizacao, type AppDoTikTok } from "@/lib/integrations/tiktokApps";
import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";
import { TiktokOwnershipConflictError } from "@/lib/integrations/tiktokOwnership";
import { registrarTentativaDeConexao } from "@/lib/integrations/tiktokConexaoTentativa";
import { currentWorkspaceId, runWithWorkspace } from "@/lib/workspaceScope";
import { runTiktokSyncBatch, tiktokConnectionId } from "@/lib/integrations/tiktokSync";
import { depoisDaResposta } from "@/lib/depoisDaResposta";

/** Orçamento do sync imediato pós-conexão: cobre a janela recente de pedidos. */
const KICK_BUDGET_MS = 60_000;

/**
 * Quantas vezes perguntar as lojas quando a lista vem vazia, e o intervalo.
 *
 * ⚠️ CURTO DE PROPÓSITO. Isto roda DENTRO do request de um vendedor esperando a
 * tela, então o teto (2 esperas de 1,5s) é o que custa a espera dele. Cobre a
 * hipótese de a autorização recém-concedida levar instantes para aparecer; não
 * cobre — e não deve cobrir — atraso de minutos, que é outro problema e pede
 * outro desenho.
 */
const TENTATIVAS_DE_LISTAGEM = 3;
const ESPERA_ENTRE_TENTATIVAS_MS = 1_500;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Retorno da autorização do TikTok Shop: chega com ?code=... (auth_code).
// Troca por access_token, lista as lojas autorizadas (pega o shop_cipher) e salva.
//
// Dois caminhos legítimos chegam aqui:
//  1. A própria pessoa conectando pelo painel  → sessão + cookie de state (CSRF).
//  2. Um vendedor autorizando pelo link privado de convite → sem sessão e sem
//     cookie; a origem é provada pela assinatura do `state` (ver tiktokInvite).
//
// ⚠️ O Service Market do TikTok NÃO é porta de entrada, por decisão de produto
// (11/09/2026): uma autorização iniciada lá chegaria aqui sem o nosso `state`,
// e sem ele não há como saber para QUAL workspace a loja vai. A entrada é só
// pelo nosso botão. Isto é decisão, não lacuna.
export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const state = searchParams.get("state");
  const convite = validarConviteTiktok(state);
  const baseUrl = process.env.APP_BASE_URL || origin;

  // ⚠️ A PORTA DE FORA: com o app PUBLICADO na App Store do TikTok, o vendedor
  // consegue iniciar a instalação lá — e aí a autorização chega aqui SEM o
  // nosso `state`. Antes de 12/09/2026 esse caminho caía direto em
  // `withAuthenticatedWorkspace`, que devolve **JSON cru** (`{"error":"Faça
  // login para continuar."}`) para quem não tem sessão. Um vendedor terminava o
  // consentimento e recebia um blob de JSON.
  //
  // 📌 Não dá para aproveitar esse código: sem o `state` não há como saber para
  // QUAL workspace a loja vai, e adivinhar seria pior do que recusar. Então o
  // certo é explicar e levar de volta ao botão — que é onde a conexão tem dono.
  // Trocar o código aqui também seria um vetor de CSRF, e por isso ele é
  // descartado sem uso.
  if (!convite && !state && (searchParams.get("code") || searchParams.get("auth_code"))) {
    registrarTentativaDeConexao({ desfecho: "sem_state" });
    return NextResponse.redirect(
      `${baseUrl}/integracoes?error=${encodeURIComponent(
        "Para conectar a TikTok Shop, comece pelo botão Integrar aqui no NEXO — assim a loja entra na conta certa."
      )}`
    );
  }

  // O convite já identifica o workspace de destino e dispensa login: quem
  // autoriza é o vendedor, que não tem conta aqui.
  if (convite) {
    // ⚠️ O APP VEM DO CONVITE, nao de palpite. E este e o caminho que o revisor
    // do TikTok usa: ele autoriza sem ter conta aqui, entao nao ha sessao nem
    // cookie — quem prova a origem e a assinatura do `state`.
    return runWithWorkspace(convite.workspaceId, () =>
      concluir(req, baseUrl, { exigirCookie: false, app: convite.app }));
  }
  // ⚠️ O CAMINHO DO PAINEL PASSOU A SER O PÚBLICO em 11/09/2026. Antes ele
  // mandava `APP_PADRAO` (= custom): mesmo com a URL de autorização corrigida, a
  // troca do `auth_code` iria com a chave do app-sonda e o token voltaria
  // negado. Os dois lados — montar a URL e trocar o código — mudam juntos, ou o
  // consentimento acontece num app e a troca no outro.
  const app = appDaAutorizacao();
  if (!app) {
    registrarTentativaDeConexao({ desfecho: "erro", motivo: "publico_nao_configurado" });
    return NextResponse.redirect(
      `${baseUrl}/integracoes?error=${encodeURIComponent("A conexão com a TikTok Shop está indisponível no momento.")}`
    );
  }
  return withAuthenticatedWorkspace(() => concluir(req, baseUrl, { exigirCookie: true, app }));
}

async function concluir(
  req: NextRequest,
  baseUrl: string,
  opcoes: { exigirCookie: boolean; app: AppDoTikTok }
): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code") || searchParams.get("auth_code");
  const state = searchParams.get("state");
  const expectedState = req.cookies.get(TIKTOK_OAUTH_STATE_COOKIE)?.value;

  const finish = (response: NextResponse) => {
    response.cookies.set(TIKTOK_OAUTH_STATE_COOKIE, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 0,
      path: "/api/tiktok/callback",
    });
    return response;
  };
  const fail = (msg: string) => finish(
    NextResponse.redirect(`${baseUrl}/integracoes?error=${encodeURIComponent(msg)}`)
  );

  if (searchParams.get("error")) {
    registrarTentativaDeConexao({ desfecho: "recusado_na_tiktok", app: opcoes.app });
    return fail("Autorização do TikTok Shop cancelada.");
  }

  if (opcoes.exigirCookie) {
    if (!state || !expectedState) {
      registrarTentativaDeConexao({ desfecho: "sem_state", app: opcoes.app });
      return fail("Autorização expirada. Inicie a conexão novamente.");
    }
    const received = Buffer.from(state);
    const expected = Buffer.from(expectedState);
    if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
      registrarTentativaDeConexao({ desfecho: "state_invalido", app: opcoes.app });
      return fail("Não foi possível validar a origem da autorização.");
    }
  }

  if (!code || code === "null") {
    registrarTentativaDeConexao({ desfecho: "codigo_ausente", app: opcoes.app });
    return fail("Autorização incompleta — código ausente.");
  }

  try {
    const tok = await exchangeAuthCode(code, opcoes.app);
    // ⚠️ PRIMEIRA CHAMADA ASSINADA do consentimento. Sem `opcoes.app` ela ia
    // com a chave do CUSTOM enquanto o token era do PUBLICO — o que fazia a
    // etapa 2 quebrar exatamente aqui. Ver migration 0033.
    // ⚠️ RETRY CURTO, E SÓ PARA LISTA VAZIA. A hipótese é que a autorização
    // recém-concedida leve alguns instantes para aparecer aqui. Erro NÃO é
    // retentado: erro tem causa própria e repetir só multiplicaria a chamada.
    //
    // 📌 Curto DE PROPÓSITO, e dentro do request: a alternativa — guardar o
    // token e resolver em segundo plano — criaria um token sem loja associada
    // no banco, que é credencial órfã e precisa de casa, cifra e prazo. Não se
    // paga esse custo por uma hipótese ainda não observada (decisão de
    // 12/09/2026); quando houver caso real que exija, aí sim.
    let shops = await getAuthorizedShops(tok.access_token, opcoes.app);
    let voltas = 1;
    while (shops.length === 0 && voltas < TENTATIVAS_DE_LISTAGEM) {
      await new Promise((ok) => setTimeout(ok, ESPERA_ENTRE_TENTATIVAS_MS));
      voltas += 1;
      shops = await getAuthorizedShops(tok.access_token, opcoes.app);
    }

    const accessExp = epochToIso(tok.access_token_expire_in);
    const refreshExp = epochToIso(tok.refresh_token_expire_in);

    if (shops.length === 0) {
      // ⚠️ A MENSAGEM ANTIGA DIZIA "Verifique a conta do vendedor" — ela jogava
      // no vendedor um problema que não é dele e não dizia o que fazer.
      registrarTentativaDeConexao({ desfecho: "sem_lojas", app: opcoes.app, lojas: 0, tentativas: voltas });
      return fail(
        "A TikTok confirmou a autorização, mas ainda não liberou a loja para o NEXO. " +
        "Aguarde alguns minutos e tente conectar de novo."
      );
    }

    await saveTiktokAuthorization(shops.map((s) => ({
        shopId: s.id,
        shopName: s.name,
        shopCipher: s.cipher,
        region: s.region,
        accessToken: tok.access_token,
        refreshToken: tok.refresh_token,
        accessExpiresAt: accessExp,
        refreshExpiresAt: refreshExp,
        // Grava DE QUAL APP este token e. Adivinhar depois erra em silencio:
        // token do publico renovado com o par do custom e recusado.
        app: opcoes.app,
      })));

    // Primeira sincronização disparada na hora (o seed do estado já saiu no
    // saveTiktokAuthorization): o `after()` roda fora do caminho do redirect e
    // o lease de 5 minutos impede colisão com o cron. Vale para os dois
    // caminhos — painel e convite do vendedor. Se o kick morrer, o agendador
    // assume no próximo ciclo.
    const workspaceId = currentWorkspaceId();
    const shopIds = shops.map((s) => s.id);
    depoisDaResposta("tiktok-callback:kick", () => runWithWorkspace(workspaceId, async () => {
      for (const shopId of shopIds) {
        try {
          await runTiktokSyncBatch(tiktokConnectionId(shopId), KICK_BUDGET_MS);
        } catch (error) {
          console.error("Falha no sync imediato pós-conexão do TikTok Shop", {
            shopId,
            reason: error instanceof Error ? error.message : "Erro desconhecido",
          });
        }
      }
    }));

    registrarTentativaDeConexao({
      desfecho: "conectada", app: opcoes.app, lojas: shops.length,
      tentativas: voltas, workspace: workspaceId,
    });
    return finish(NextResponse.redirect(`${baseUrl}/integracoes?connected=tiktok_shop`));
  } catch (err) {
    // ⚠️ POSSE ENTRE INQUILINOS TEM MENSAGEM PRÓPRIA, e isto é a correção de um
    // caso real: em 11/09/2026 o primeiro vendedor tentou conectar QUATRO vezes
    // e as quatro morreram aqui. O sistema agiu certo — a loja já pertencia a
    // outra conta e o isolamento recusou —, mas a tela dizia apenas "Não foi
    // possível operar esta loja TikTok.", que não diz nem a causa nem o passo
    // seguinte. Com 50–70 vendedores, isso é um atendimento por pessoa.
    //
    // 📌 E ELA NÃO REVELA QUAL CONTA. Dizer "está na conta X" entregaria um
    // inquilino a outro — a lição de 02/09/2026: ler entre inquilinos pode,
    // DEVOLVER identificador não.
    if (err instanceof TiktokOwnershipConflictError) {
      registrarTentativaDeConexao({
        desfecho: "loja_de_outra_conta", app: opcoes.app, lojas: 0, motivo: "posse",
      });
      return fail(
        "Loja já conectada ao NEXO. Desconecte-a na conta onde ela está antes de conectar aqui."
      );
    }
    registrarTentativaDeConexao({
      desfecho: "erro", app: opcoes.app,
      motivo: err instanceof Error ? err.name : "desconhecido",
    });
    return fail(err instanceof Error ? err.message : "Erro inesperado ao conectar o TikTok.");
  }
}
