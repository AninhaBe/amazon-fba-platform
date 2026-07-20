import { NextRequest, NextResponse } from "next/server";
import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Inicia o fluxo OAuth da SP-API (website authorization workflow).
// Redireciona o vendedor para a tela de consentimento do Seller Central.
export async function GET(req: NextRequest) {
  return withAuthenticatedWorkspace(async () => {
  const appId = process.env.SPAPI_APP_ID;
  const baseUrl = process.env.APP_BASE_URL || new URL(req.url).origin;
  const consentBase =
    process.env.SPAPI_SELLERCENTRAL_URL || "https://sellercentral.amazon.com.br";

  if (!appId) {
    return NextResponse.json(
      { error: "A conexão de contas ainda não foi configurada. Entre em contato com o suporte." },
      { status: 500 }
    );
  }

  // state anti-CSRF, guardado num cookie curto para conferir no callback.
  const state = crypto.randomUUID();
  const redirectUri = `${baseUrl}/api/auth/callback`;

  const url = new URL(`${consentBase}/apps/authorize/consent`);
  url.searchParams.set("application_id", appId);
  url.searchParams.set("state", state);
  url.searchParams.set("redirect_uri", redirectUri);
  // App em rascunho precisa de version=beta para autorizar contas de teste.
  if (process.env.SPAPI_APP_DRAFT !== "false") {
    url.searchParams.set("version", "beta");
  }

  const res = NextResponse.redirect(url.toString());
  res.cookies.set("oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return res;
  });
}
