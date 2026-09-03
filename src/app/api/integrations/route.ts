import { NextRequest, NextResponse } from "next/server";
import { lerEstadoDasCredenciais } from "@/lib/adsMultiCanal";
import { dbTransaction } from "@/lib/db";
import { getAccounts } from "@/lib/accountStore";
import { getTiktokShops, removeTiktokShop } from "@/lib/tiktokStore";
import { tiktokConfigured } from "@/lib/tiktok";
import { getIntegrations, publicConnection, removeIntegration } from "@/lib/integrations/integrationStore";
import { mercadoLivreConfigured } from "@/lib/integrations/mercadoLivre";
import { shopeeConfigured } from "@/lib/integrations/shopee";
import { PROVIDERS } from "@/lib/integrations/registry";
import { isolateProviderRead, type ProviderReadIssue } from "@/lib/integrations/providerReadIsolation";
import { removeLocalShopeeConnection } from "@/lib/integrations/shopeeRemoval";
import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";
import { currentWorkspaceId } from "@/lib/workspaceScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return withAuthenticatedWorkspace(async () => {
  try {
    const [genericRead, amazonRead, tiktokRead] = await Promise.all([
      isolateProviderRead(() => getIntegrations(), []),
      isolateProviderRead(() => getAccounts(), []),
      isolateProviderRead(() => getTiktokShops(), [], "tiktok_shop"),
    ]);
    const generic = genericRead.value;
    const amazonAccounts = amazonRead.value;
    const tiktokShops = tiktokRead.value;
    const issues = new Map<string, ProviderReadIssue>();
    if (genericRead.issue) {
      issues.set("mercado_livre", genericRead.issue);
      issues.set("shopee", genericRead.issue);
    }
    if (amazonRead.issue) issues.set("amazon", amazonRead.issue);
    if (tiktokRead.issue) issues.set("tiktok_shop", tiktokRead.issue);
    const connections = [
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
    // ⚠️ O ESTADO DA CREDENCIAL DE ADS SAI DAQUI, e a mesma funcao que serve o
    // /api/ads — nao uma segunda leitura. Duas consultas respondendo a mesma
    // pergunta e como uma fica para tras: bastaria alguem mudar onde a Amazon
    // guarda o OAuth para a tela de Integracoes passar a mentir sozinha.
    //
    // 📌 E ele vem por AQUI, e nao pelo /api/ads, por causa da ADR-017: a pagina
    // de Integracoes ja le esta rota, e buscar a aba de anuncios inteira para
    // extrair dois booleanos seria uma segunda ida para nada.
    const credenciaisDeAds = await lerEstadoDasCredenciais(currentWorkspaceId());
    return NextResponse.json({
      credenciaisDeAds,
      providers: PROVIDERS.map((provider) => ({
        ...provider,
        connectHref: (provider.id === "mercado_livre" || provider.id === "shopee")
          && provider.connectHref && process.env.APP_BASE_URL
          ? `${process.env.APP_BASE_URL}${provider.connectHref}`
          : provider.connectHref,
        configured: provider.id === "amazon"
          ? !!(process.env.SPAPI_APP_ID && (process.env.OAUTH_CLIENT_ID || process.env.LWA_CLIENT_ID))
          : provider.id === "mercado_livre"
            ? mercadoLivreConfigured()
            : provider.id === "tiktok_shop"
              ? tiktokConfigured()
              : provider.id === "shopee"
                ? shopeeConfigured()
                : false,
        issue: issues.get(provider.id),
        connections: connections.filter((connection) => connection.provider === provider.id),
      })),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao carregar integrações." }, { status: 500 });
  }
  });
}

export async function DELETE(req: NextRequest) {
  return withAuthenticatedWorkspace(async () => {
  try {
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Informe a conexão." }, { status: 400 });
    if (id.startsWith("tiktok_shop:")) {
      await removeTiktokShop(id.slice("tiktok_shop:".length));
      return NextResponse.json({ ok: true });
    }
    if (id.startsWith("shopee:")) {
      const removed = await removeLocalShopeeConnection(dbTransaction, currentWorkspaceId(), id);
      if (!removed) {
        return NextResponse.json(
          { error: "Conexão Shopee não encontrada neste workspace.", code: "CONNECTION_NOT_FOUND" },
          { status: 404 },
        );
      }
      return NextResponse.json({ ok: true, localOnly: true, marketplaceAccessRevoked: false });
    }
    if (!id.startsWith("mercado_livre:")) {
      return NextResponse.json({ error: "Esta conexão deve ser removida pelo gerenciador específico do canal." }, { status: 400 });
    }
    await removeIntegration(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao remover integração." }, { status: 500 });
  }
  });
}
