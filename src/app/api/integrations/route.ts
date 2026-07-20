import { NextRequest, NextResponse } from "next/server";
import { getAccounts } from "@/lib/accountStore";
import { getTiktokShops } from "@/lib/tiktokStore";
import { getIntegrations, publicConnection, removeIntegration } from "@/lib/integrations/integrationStore";
import { mercadoLivreConfigured } from "@/lib/integrations/mercadoLivre";
import { PROVIDERS } from "@/lib/integrations/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [generic, amazonAccounts, tiktokShops] = await Promise.all([
      getIntegrations(),
      getAccounts(),
      getTiktokShops(),
    ]);
    const connections = [
      ...(process.env.LWA_REFRESH_TOKEN ? [{
        id: "amazon:default",
        provider: "amazon",
        externalAccountId: "default",
        displayName: "Conta principal",
        mode: "local",
        region: process.env.DEFAULT_MARKETPLACE_ID === "A2Q3Y263D00KWC" ? "Amazon.com.br" : process.env.SPAPI_REGION || "NA",
        scopes: [],
        metadata: {},
        status: "connected",
        connectedAt: "environment",
        updatedAt: "environment",
      }] : []),
      ...amazonAccounts.map((account) => ({
        id: `amazon:${account.sellerId}`,
        provider: "amazon",
        externalAccountId: account.sellerId,
        displayName: account.name || account.marketplace || account.sellerId,
        mode: "local",
        region: account.marketplace,
        scopes: [],
        metadata: {},
        status: "connected",
        connectedAt: account.connectedAt,
        updatedAt: account.connectedAt,
      })),
      ...generic.map(publicConnection),
      ...tiktokShops.map((shop) => ({
        id: `tiktok_shop:${shop.shopId}`,
        provider: "tiktok_shop",
        externalAccountId: shop.shopId,
        displayName: shop.shopName || shop.shopId,
        mode: "local",
        region: shop.region,
        scopes: [],
        metadata: {},
        status: "connected",
        connectedAt: shop.connectedAt,
        updatedAt: shop.connectedAt,
      })),
    ];
    return NextResponse.json({
      providers: PROVIDERS.map((provider) => ({
        ...provider,
        connectHref: provider.id === "mercado_livre" && provider.connectHref && process.env.APP_BASE_URL
          ? `${process.env.APP_BASE_URL}${provider.connectHref}`
          : provider.connectHref,
        configured: provider.id === "amazon"
          ? !!(process.env.SPAPI_APP_ID && (process.env.OAUTH_CLIENT_ID || process.env.LWA_CLIENT_ID))
          : provider.id === "mercado_livre"
            ? mercadoLivreConfigured()
            : provider.id === "tiktok_shop"
              ? !!(process.env.TIKTOK_APP_KEY && process.env.TIKTOK_APP_SECRET && process.env.TIKTOK_AUTH_URL)
              : false,
        connections: connections.filter((connection) => connection.provider === provider.id),
      })),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao carregar integrações." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Informe a conexão." }, { status: 400 });
    if (!id.startsWith("mercado_livre:")) {
      return NextResponse.json({ error: "Esta conexão deve ser removida pelo gerenciador específico do canal." }, { status: 400 });
    }
    await removeIntegration(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao remover integração." }, { status: 500 });
  }
}
