import { NextRequest, NextResponse } from "next/server";
import { saveIntegration } from "@/lib/integrations/integrationStore";
import {
  exchangeShopeeCode,
  getShopeeShopInfo,
  shopeeConnectionId,
  shopeeSandbox,
} from "@/lib/integrations/shopee";
import { ensureShopeeSyncState } from "@/lib/integrations/shopeeSync";
import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Retorno da autorização: a Shopee devolve `code` + `shop_id` (ou `main_account_id`
// para autorização de merchant, que ainda não suportamos).
export async function GET(req: NextRequest) {
  return withAuthenticatedWorkspace(async () => {
    const { searchParams, origin } = new URL(req.url);
    const uiBaseUrl = process.env.APP_UI_BASE_URL || process.env.APP_BASE_URL || origin;
    const fail = (message: string) =>
      NextResponse.redirect(`${uiBaseUrl}/integracoes?error=${encodeURIComponent(message)}`);

    if (!req.cookies.get("shopee_oauth_state")?.value) {
      return fail("Falha na verificação de segurança da Shopee. Refaça a conexão.");
    }

    const code = searchParams.get("code");
    const shopId = searchParams.get("shop_id");
    if (!code) return fail("Autorização da Shopee incompleta.");
    if (!shopId) {
      return fail("A Shopee não informou a loja. Autorização de merchant ainda não é suportada.");
    }

    try {
      const token = await exchangeShopeeCode(code, shopId);
      const connection = {
        id: shopeeConnectionId(shopId),
        provider: "shopee" as const,
        externalAccountId: shopId,
        mode: "local" as const,
        region: "BR",
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        accessExpiresAt: new Date(Date.now() + token.expire_in * 1000).toISOString(),
        scopes: [],
        // A autorização da loja expira em até 365 dias, além da rotação do refresh
        // token — guardamos a data para avisar antes de vencer.
        metadata: {
          sandbox: shopeeSandbox(),
          authorizedAt: new Date().toISOString(),
          merchantId: token.merchant_id ?? null,
        } as Record<string, unknown>,
        status: "connected" as const,
        connectedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        displayName: `Loja ${shopId}`,
      };

      // O nome bonito da loja é um plus: se falhar, a conexão continua válida.
      let displayName = connection.displayName;
      try {
        const info = await getShopeeShopInfo(connection);
        if (info.shop_name) displayName = info.shop_name;
        if (info.region) connection.region = info.region;
      } catch {
        // segue com o nome padrão
      }

      const saved = await saveIntegration({ ...connection, displayName });
      // Primeira sincronização já agendada: o cron assume a partir daqui.
      await ensureShopeeSyncState(saved.id);
      const response = NextResponse.redirect(`${uiBaseUrl}/integracoes?connected=shopee`);
      response.cookies.set("shopee_oauth_state", "", { maxAge: 0, path: "/" });
      return response;
    } catch (error) {
      return fail(error instanceof Error ? error.message : "Erro ao conectar a Shopee.");
    }
  });
}
