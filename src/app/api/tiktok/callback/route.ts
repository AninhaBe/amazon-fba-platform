import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { exchangeAuthCode, getAuthorizedShops, epochToIso, TIKTOK_OAUTH_STATE_COOKIE } from "@/lib/tiktok";
import { saveTiktokAuthorization } from "@/lib/tiktokStore";
import { validarConviteTiktok } from "@/lib/tiktokInvite";
import { appDaAutorizacao, type AppDoTikTok } from "@/lib/integrations/tiktokApps";
import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";
import { currentWorkspaceId, runWithWorkspace } from "@/lib/workspaceScope";
import { runTiktokSyncBatch, tiktokConnectionId } from "@/lib/integrations/tiktokSync";
import { depoisDaResposta } from "@/lib/depoisDaResposta";

/** Orçamento do sync imediato pós-conexão: cobre a janela recente de pedidos. */
const KICK_BUDGET_MS = 60_000;

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

  if (searchParams.get("error")) return fail("Autorização do TikTok Shop cancelada.");

  if (opcoes.exigirCookie) {
    if (!state || !expectedState) return fail("Autorização expirada. Inicie a conexão novamente.");
    const received = Buffer.from(state);
    const expected = Buffer.from(expectedState);
    if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
      return fail("Não foi possível validar a origem da autorização.");
    }
  }

  if (!code || code === "null") return fail("Autorização incompleta — código ausente.");

  try {
    const tok = await exchangeAuthCode(code, opcoes.app);
    // ⚠️ PRIMEIRA CHAMADA ASSINADA do consentimento. Sem `opcoes.app` ela ia
    // com a chave do CUSTOM enquanto o token era do PUBLICO — o que fazia a
    // etapa 2 quebrar exatamente aqui. Ver migration 0033.
    const shops = await getAuthorizedShops(tok.access_token, opcoes.app);

    const accessExp = epochToIso(tok.access_token_expire_in);
    const refreshExp = epochToIso(tok.refresh_token_expire_in);

    if (shops.length === 0) {
      return fail("Autorizado, mas nenhuma loja retornada. Verifique a conta do vendedor.");
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

    return finish(NextResponse.redirect(`${baseUrl}/integracoes?connected=tiktok_shop`));
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Erro inesperado ao conectar o TikTok.");
  }
}
