import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { exchangeAuthCode, getAuthorizedShops, epochToIso, TIKTOK_OAUTH_STATE_COOKIE } from "@/lib/tiktok";
import { saveTiktokShop } from "@/lib/tiktokStore";
import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Retorno da autorização do TikTok Shop: chega com ?code=... (auth_code).
// Troca por access_token, lista as lojas autorizadas (pega o shop_cipher) e salva.
export async function GET(req: NextRequest) {
  return withAuthenticatedWorkspace(async () => {
    const { searchParams, origin } = new URL(req.url);
    const code = searchParams.get("code") || searchParams.get("auth_code");
    const state = searchParams.get("state");
    const expectedState = req.cookies.get(TIKTOK_OAUTH_STATE_COOKIE)?.value;
    const baseUrl = process.env.APP_BASE_URL || origin;

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
    if (!state || !expectedState) return fail("Autorização expirada. Inicie a conexão novamente.");
    const received = Buffer.from(state);
    const expected = Buffer.from(expectedState);
    if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
      return fail("Não foi possível validar a origem da autorização.");
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

      for (const s of shops) {
        await saveTiktokShop({
          shopId: s.id,
          shopName: s.name,
          shopCipher: s.cipher,
          region: s.region,
          accessToken: tok.access_token,
          refreshToken: tok.refresh_token,
          accessExpiresAt: accessExp,
          refreshExpiresAt: refreshExp,
        });
      }

      return finish(NextResponse.redirect(`${baseUrl}/integracoes?connected=tiktok_shop`));
    } catch (err) {
      return fail(err instanceof Error ? err.message : "Erro inesperado ao conectar o TikTok.");
    }
  });
}
