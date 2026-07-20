import crypto from "crypto";
import { NextResponse } from "next/server";
import { TIKTOK_OAUTH_STATE_COOKIE, tiktokAuthorizationUrl } from "@/lib/tiktok";
import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Redireciona para a autorização ROW (inclui Brasil) com proteção CSRF.
export async function GET() {
  return withAuthenticatedWorkspace(async () => {
    try {
      const state = crypto.randomBytes(32).toString("base64url");
      const response = NextResponse.redirect(tiktokAuthorizationUrl(state));
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
