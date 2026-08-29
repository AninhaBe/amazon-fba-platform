import { NextRequest, NextResponse } from "next/server";
import { connectionId } from "@/lib/integrations/types";
import { saveIntegration } from "@/lib/integrations/integrationStore";
import { exchangeMercadoLivreCode, mercadoLivreFetch, type MercadoLivreUser } from "@/lib/integrations/mercadoLivre";
import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";
import { ensureMercadoLivreSyncState, runMercadoLivreSyncBatch } from "@/lib/integrations/mercadoLivreSync";
import { currentWorkspaceId, runWithWorkspace } from "@/lib/workspaceScope";
import { depoisDaResposta } from "@/lib/depoisDaResposta";

/** Passos do sync imediato pós-conexão: cobre a janela recente de pedidos. */
const KICK_MAX_STEPS = 16;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withAuthenticatedWorkspace(async () => {
  const { searchParams, origin } = new URL(req.url);
  const baseUrl = process.env.APP_BASE_URL || origin;
  const uiBaseUrl = process.env.APP_UI_BASE_URL || baseUrl;
  const fail = (message: string) => NextResponse.redirect(`${uiBaseUrl}/integracoes?error=${encodeURIComponent(message)}`);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const expectedState = req.cookies.get("meli_oauth_state")?.value;
  const verifier = req.cookies.get("meli_pkce_verifier")?.value;

  if (!state || !expectedState || state !== expectedState) return fail("Falha na verificação de segurança do Mercado Livre.");
  if (!code || !verifier) return fail("Autorização do Mercado Livre incompleta.");

  try {
    const redirectUri = `${baseUrl}/api/integrations/mercado-livre/callback`;
    const token = await exchangeMercadoLivreCode({ code, redirectUri, verifier });
    const temporary = {
      id: connectionId("mercado_livre", String(token.user_id)),
      provider: "mercado_livre" as const,
      externalAccountId: String(token.user_id),
      mode: "local" as const,
      region: "MLB",
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      accessExpiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(),
      scopes: token.scope?.split(/\s+/).filter(Boolean) ?? [],
      metadata: {},
      status: "connected" as const,
      connectedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const user = await mercadoLivreFetch<MercadoLivreUser>(temporary, "/users/me");
    const connection = await saveIntegration({
      ...temporary,
      displayName: user.nickname,
      region: user.site_id ?? "MLB",
      metadata: { nickname: user.nickname, countryId: user.country_id ?? "BR", siteId: user.site_id ?? "MLB" },
    });
    // Primeira sincronização agendada E disparada na hora: o `after()` roda
    // fora do caminho do redirect, e o lease de 5 minutos impede colisão com
    // o cron. Se o kick morrer, o agendador assume no próximo ciclo.
    await ensureMercadoLivreSyncState(connection.id);
    const workspaceId = currentWorkspaceId();
    depoisDaResposta("ml-callback:kick", () => runWithWorkspace(workspaceId, async () => {
      try {
        await runMercadoLivreSyncBatch(connection, KICK_MAX_STEPS);
      } catch (error) {
        console.error("Falha no sync imediato pós-conexão do Mercado Livre", {
          connectionId: connection.id,
          reason: error instanceof Error ? error.message : "Erro desconhecido",
        });
      }
    }));
    const response = NextResponse.redirect(`${uiBaseUrl}/integracoes?connected=mercado_livre`);
    response.cookies.set("meli_oauth_state", "", { maxAge: 0, path: "/" });
    response.cookies.set("meli_pkce_verifier", "", { maxAge: 0, path: "/" });
    return response;
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Erro ao conectar o Mercado Livre.");
  }
  });
}
