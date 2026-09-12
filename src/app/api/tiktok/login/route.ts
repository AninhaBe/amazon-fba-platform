import crypto from "crypto";
import { NextResponse } from "next/server";
import { TIKTOK_OAUTH_STATE_COOKIE, tiktokAuthorizationUrl } from "@/lib/tiktok";
import { appDaAutorizacao } from "@/lib/integrations/tiktokApps";
import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Redireciona para a autorização ROW (inclui Brasil) com proteção CSRF.
//
// ⚠️ ESTE É O CAMINHO DO BOTÃO "Integrar TikTok". Até 11/09/2026 ele montava a
// URL SEM dizer qual app, caindo no custom — o app-sonda. O vendedor autorizaria
// o app errado e o consentimento pareceria ter funcionado.
export async function GET() {
  return withAuthenticatedWorkspace(async () => {
    try {
      // `null` é RECUSA e não pode virar fallback: sem as credenciais do
      // público, oferecer a conexão quebraria o vendedor no meio do fluxo — ou,
      // pior, o conectaria ao app que estamos desligando.
      const app = appDaAutorizacao();
      if (!app) {
        return NextResponse.json(
          { error: "A conexão com a TikTok Shop está indisponível no momento." },
          { status: 503 }
        );
      }
      const state = crypto.randomBytes(32).toString("base64url");
      const response = NextResponse.redirect(tiktokAuthorizationUrl(state, app));
      response.cookies.set(TIKTOK_OAUTH_STATE_COOKIE, state, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 10 * 60,
        path: "/api/tiktok/callback",
      });
      return response;
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "TikTok Shop ainda não configurado." },
        { status: 500 }
      );
    }
  });
}
