import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { amazonAdsAuthorizeUrl } from "@/lib/integrations/amazonAdsAuth";
import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Início do consentimento da Amazon Ads.
 *
 * O `state` é gerado aqui, guardado em cookie e conferido no callback: sem isso,
 * qualquer um poderia induzir a vendedora a completar um fluxo iniciado por
 * terceiro e vincular a conta de publicidade errada.
 */
export async function GET() {
  return withAuthenticatedWorkspace(async () => {
    const state = randomUUID();
    let url: string;
    try {
      url = amazonAdsAuthorizeUrl(state);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Integração de Ads não configurada." },
        { status: 503 },
      );
    }
    const res = NextResponse.redirect(url);
    res.cookies.set("ads_oauth_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 600, // o consentimento é de agora; 10 min basta e limita a janela
    });
    return res;
  });
}
