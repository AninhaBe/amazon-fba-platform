import { NextRequest, NextResponse } from "next/server";
import { exchangeAuthCode, getAuthorizedShops, epochToIso } from "@/lib/tiktok";
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
  const baseUrl = process.env.APP_BASE_URL || origin;

  const fail = (msg: string) =>
    NextResponse.redirect(`${baseUrl}/?tiktok_error=${encodeURIComponent(msg)}`);

  if (!code) return fail("Autorização incompleta — código ausente.");

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

    return NextResponse.redirect(`${baseUrl}/?tiktok_connected=${shops.length}`);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Erro inesperado ao conectar o TikTok.");
  }
  });
}
