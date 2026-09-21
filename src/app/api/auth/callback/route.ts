import { NextRequest, NextResponse } from "next/server";
import { saveAccount } from "@/lib/accountStore";
import { garantirAssinaturaAmazon } from "@/lib/integrations/amazonNotificacaoSetup";
import { ACTIVE_COOKIE } from "@/lib/withAccount";
import { oauthClientCreds } from "@/lib/spapi";
import { runWithAccount } from "@/lib/accountContext";
import { getMarketplaceName } from "@/lib/sellers";
import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";
import { currentWorkspaceId, runWithWorkspace } from "@/lib/workspaceScope";
import {
  amazonConnectionId,
  ensureAmazonSyncState,
  runAmazonSyncBatch,
} from "@/lib/integrations/amazonSync";
import { depoisDaResposta } from "@/lib/depoisDaResposta";

/** Passos do sync imediato pós-conexão: cobre a janela recente de pedidos. */
const KICK_MAX_STEPS = 8;

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

    // Primeira sincronização agendada E disparada na hora. A linha de estado
    // nasce aqui (antes só nascia na primeira visita ao dashboard — o agendador
    // seleciona a partir de workspace_marketplace_syncs e nunca via a conta
    // nova); o `after()` roda fora do caminho do redirect, e o lease de 5
    // minutos impede colisão com o cron. Se o kick morrer, o cron assume.
    await ensureAmazonSyncState(amazonConnectionId(sellerId));
    const workspaceId = currentWorkspaceId();
    const account = { sellerId, refreshToken: data.refresh_token };
    depoisDaResposta("auth-callback:amazon-kick", () => runWithWorkspace(workspaceId, async () => {
      // Assina o webhook desta conta (ADR-023). Idempotente e best-effort: se a
      // role de notificações não foi concedida ou a AWS não está configurada,
      // falha em silêncio e o polling de 2 min cobre. É o que faz o webhook
      // escalar — cada vendedor assina sozinho ao conectar, nunca à mão.
      await garantirAssinaturaAmazon(sellerId, data.refresh_token);
      try {
        await runAmazonSyncBatch(account, KICK_MAX_STEPS);
      } catch (error) {
        console.error("Falha no sync imediato pós-conexão da Amazon", {
          sellerId,
          reason: error instanceof Error ? error.message : "Erro desconhecido",
        });
      }
    }));

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
