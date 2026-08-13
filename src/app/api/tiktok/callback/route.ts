import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { exchangeAuthCode, getAuthorizedShops, epochToIso, TIKTOK_OAUTH_STATE_COOKIE } from "@/lib/tiktok";
import { saveTiktokAuthorization } from "@/lib/tiktokStore";
import { validarConviteTiktok } from "@/lib/tiktokInvite";
import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";
import { runWithWorkspace } from "@/lib/workspaceScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Retorno da autorização do TikTok Shop: chega com ?code=... (auth_code).
// Troca por access_token, lista as lojas autorizadas (pega o shop_cipher) e salva.
//
// Dois caminhos legítimos chegam aqui:
//  1. A própria pessoa conectando pelo painel  → sessão + cookie de state (CSRF).
//  2. Um vendedor autorizando pelo link privado do custom app → sem sessão e sem
//     cookie; a origem é provada pela assinatura do `state` (ver tiktokInvite).
export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const state = searchParams.get("state");
  const convite = validarConviteTiktok(state);
  const baseUrl = process.env.APP_BASE_URL || origin;

  // O convite já identifica o workspace de destino e dispensa login: quem
  // autoriza é o vendedor, que não tem conta aqui.
  if (convite) {
    return runWithWorkspace(convite.workspaceId, () => concluir(req, baseUrl, { exigirCookie: false }));
  }
  return withAuthenticatedWorkspace(() => concluir(req, baseUrl, { exigirCookie: true }));
}

async function concluir(
  req: NextRequest,
  baseUrl: string,
  opcoes: { exigirCookie: boolean }
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
    const tok = await exchangeAuthCode(code);
    const shops = await getAuthorizedShops(tok.access_token);

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
      })));

    return finish(NextResponse.redirect(`${baseUrl}/integracoes?connected=tiktok_shop`));
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Erro inesperado ao conectar o TikTok.");
  }
}
