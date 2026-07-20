import { NextRequest, NextResponse } from "next/server";
import { saveAccount } from "@/lib/accountStore";
import { ACTIVE_COOKIE } from "@/lib/withAccount";
import { oauthClientCreds } from "@/lib/spapi";
import { runWithAccount } from "@/lib/accountContext";
import { getMarketplaceName } from "@/lib/sellers";
import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Retorno do consentimento: a Amazon manda spapi_oauth_code + selling_partner_id + state.
export async function GET(req: NextRequest) {
  return withAuthenticatedWorkspace(async () => {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get("spapi_oauth_code");
  const sellerId = searchParams.get("selling_partner_id");
  const state = searchParams.get("state");
  const baseUrl = process.env.APP_BASE_URL || origin;

  const fail = (msg: string) =>
    NextResponse.redirect(`${baseUrl}/?connect_error=${encodeURIComponent(msg)}`);

  // Confere o state (anti-CSRF)
  const expected = req.cookies.get("oauth_state")?.value;
  if (!state || !expected || state !== expected) {
    return fail("Falha na verificação de segurança (state). Tente conectar novamente.");
  }
  if (!code || !sellerId) {
    return fail("Autorização incompleta — código ou conta ausente.");
  }

  try {
    // Troca o spapi_oauth_code por um refresh token (grant authorization_code),
    // usando as credenciais do app do OAuth (app-dash).
    const creds = oauthClientCreds();
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${baseUrl}/api/auth/callback`,
      client_id: creds.id,
      client_secret: creds.secret,
    });
    const res = await fetch("https://api.amazon.com/auth/o2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = await res.json();
    if (!res.ok || !data.refresh_token) {
      return fail(data.error_description || data.error || "Falha ao obter o token.");
    }

    // Descobre o nome do marketplace usando o token da conta recém-conectada
    // (falha silenciosa — não trava a conexão se a role não estiver concedida).
    const marketplace = await runWithAccount(
      { sellerId, refreshToken: data.refresh_token },
      () => getMarketplaceName()
    );

    await saveAccount({
      sellerId,
      refreshToken: data.refresh_token,
      marketplace: marketplace ?? undefined,
    });

    // Define a conta ativa e limpa o state.
    const redirect = NextResponse.redirect(`${baseUrl}/?connected=1`);
    redirect.cookies.set(ACTIVE_COOKIE, sellerId, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
    });
    redirect.cookies.set("oauth_state", "", { maxAge: 0, path: "/" });
    return redirect;
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Erro inesperado.");
  }
  });
}
