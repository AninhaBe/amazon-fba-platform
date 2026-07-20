import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { authorizationUrl, createPkce } from "@/lib/integrations/mercadoLivre";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const baseUrl = process.env.APP_BASE_URL || new URL(req.url).origin;
    const redirectUri = `${baseUrl}/api/integrations/mercado-livre/callback`;
    const state = crypto.randomUUID();
    const { verifier, challenge } = createPkce();
    const response = NextResponse.redirect(authorizationUrl({ redirectUri, state, challenge }));
    const secure = redirectUri.startsWith("https://");
    response.cookies.set("meli_oauth_state", state, { httpOnly: true, sameSite: "lax", secure, maxAge: 600, path: "/" });
    response.cookies.set("meli_pkce_verifier", verifier, { httpOnly: true, sameSite: "lax", secure, maxAge: 600, path: "/" });
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Mercado Livre não configurado." }, { status: 500 });
  }
}
