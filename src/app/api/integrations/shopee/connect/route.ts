import { NextRequest, NextResponse } from "next/server";
import { authorizationUrl } from "@/lib/integrations/shopee";
import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ⚠️ EXCEÇÃO JUSTIFICADA, NÃO DÍVIDA — e a diferença importa desde a regra da
 * casa de 07/09/2026: dívida exige prazo de morte, exceção justificada exige
 * motivo permanente. Esta tem motivo permanente e por isso NÃO tem data.
 *
 * **A Shopee não devolve `state` no callback.** O retorno traz `code` e
 * `shop_id`, e nada mais. Não é escolha nossa e não há como contornar: o
 * parâmetro simplesmente não volta.
 *
 * O que dá para fazer, e o que fazemos: um cookie próprio, `httpOnly`, criado no
 * início do fluxo e conferido no callback.
 *
 * ⚠️ O QUE ISSO PROVA E O QUE NÃO PROVA, escrito para ninguém superestimar:
 *
 * - **prova** que este navegador iniciou UM fluxo de conexão com a Shopee, e que
 *   o callback não veio de uma aba que nunca passou pelo nosso "conectar";
 * - **NÃO prova** que iniciou ESTE fluxo. Um `state` de verdade amarra a ida à
 *   volta; o cookie só amarra a sessão do navegador.
 *
 * O que fecha o resto do buraco é a rota exigir **sessão** (`withAuthenticatedWorkspace`):
 * a conexão nasce dentro do workspace autenticado, nunca a partir do que o
 * callback disser. Se a Shopee um dia passar a devolver `state`, esta observação
 * deixa de valer e o `state` assinado entra — como já é no TikTok.
 *
 * Auditoria de superfície de 07/09/2026: dos quatro canais, TikTok usa `state`
 * assinado (o mais forte), ML e Amazon Ads comparam o `state` devolvido, e a
 * Shopee é a única onde a plataforma não permite.
 */
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
