import { NextRequest, NextResponse } from "next/server";
import { authorizationUrl } from "@/lib/integrations/shopee";
import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A Shopee não devolve `state` no callback (o retorno traz code + shop_id), então a
// verificação anti-CSRF fica num cookie próprio conferido no callback.
export async function GET(req: NextRequest) {
  return withAuthenticatedWorkspace(async () => {
    try {
      const baseUrl = process.env.APP_BASE_URL || new URL(req.url).origin;
      const redirectUri = `${baseUrl}/api/integrations/shopee/callback`;
      const state = crypto.randomUUID();
      const response = NextResponse.redirect(authorizationUrl(redirectUri));
      response.cookies.set("shopee_oauth_state", state, {
        httpOnly: true,
        sameSite: "lax",
        secure: redirectUri.startsWith("https://"),
        maxAge: 600,
        path: "/",
      });
      return response;
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Shopee não configurada." },
        { status: 500 }
      );
    }
  });
}
