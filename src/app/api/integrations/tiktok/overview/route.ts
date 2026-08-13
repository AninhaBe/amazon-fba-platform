import { NextRequest, NextResponse } from "next/server";
import { getTiktokShops } from "@/lib/tiktokStore";
import { tiktokConnectionId } from "@/lib/integrations/tiktokSync";
import { ensureTiktokSyncState } from "@/lib/integrations/tiktokSync";
import { parseTiktokConnectionId, resolveTiktokShop } from "@/lib/integrations/tiktokContract";
import { getTiktokOverviewFromCanonical } from "@/lib/integrations/tiktokOverviewCanonical";
import type { IntegrationConnection } from "@/lib/integrations/types";
import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY = 86_400_000;
const ALLOWED_DAYS = new Set([7, 15, 30]);

function requestedPeriod(url: URL) {
  const daysParam = url.searchParams.get("days") || "30";
  const daysValue = Number(daysParam);
  const fromValue = url.searchParams.get("from");
  const toValue = url.searchParams.get("to");

  if (fromValue || toValue) {
    if (!fromValue || !toValue || !/^\d{4}-\d{2}-\d{2}$/.test(fromValue) || !/^\d{4}-\d{2}-\d{2}$/.test(toValue)) {
      throw new RangeError("Informe as datas inicial e final no formato correto.");
    }
    const from = new Date(`${fromValue}T00:00:00-03:00`);
    const to = new Date(`${toValue}T23:59:59.999-03:00`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
      throw new RangeError("O período personalizado é inválido.");
    }
    if (to.getTime() - from.getTime() > 365 * DAY) {
      throw new RangeError("O período personalizado pode ter no máximo 365 dias.");
    }
    return {
      from,
      to,
      label: `${from.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })} a ${to.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`,
    };
  }
  const to = new Date();

  if (daysParam === "today") {
    const brazilDate = new Date(to.getTime() - 3 * 60 * 60 * 1_000).toISOString().slice(0, 10);
    return { from: new Date(`${brazilDate}T00:00:00-03:00`), to, label: "Hoje" };
  }
  if (!ALLOWED_DAYS.has(daysValue)) {
    throw new RangeError("Selecione Hoje ou um período de 7, 15 ou 30 dias.");
  }
  const startDate = new Date(to.getTime() - 3 * 60 * 60 * 1_000 - daysValue * DAY)
    .toISOString().slice(0, 10);
  return { from: new Date(`${startDate}T00:00:00-03:00`), to, label: `Últimos ${daysValue} dias` };
}

export async function GET(req: NextRequest) {
  return withAuthenticatedWorkspace(async () => {
    try {
      const period = requestedPeriod(new URL(req.url));
      const requestedId = new URL(req.url).searchParams.get("connection_id");
      if (requestedId && !parseTiktokConnectionId(requestedId)) {
        return NextResponse.json({ error: "connection_id TikTok inválido.", code: "INVALID_CONNECTION_ID" }, { status: 400 });
      }
      const shops = await getTiktokShops();
      if (!requestedId && shops.length > 1) {
        return NextResponse.json({ error: "Informe a conexão TikTok Shop.", code: "CONNECTION_ID_REQUIRED" }, { status: 400 });
      }
      const shop = resolveTiktokShop(shops, requestedId);
      if (!shop) {
        return NextResponse.json({ error: "Conexão TikTok Shop não encontrada.", code: "CONNECTION_NOT_FOUND" }, { status: 404 });
      }

      const connection: IntegrationConnection = {
        id: tiktokConnectionId(shop.shopId),
        provider: "tiktok_shop",
        externalAccountId: shop.shopId,
        displayName: shop.shopName,
        mode: "local",
        region: shop.region,
        scopes: [],
        metadata: {},
        status: "connected",
        connectedAt: shop.connectedAt,
        updatedAt: shop.connectedAt,
      };
      connection.metadata.taxRate = shop.taxRate ?? null;
      const overview = await getTiktokOverviewFromCanonical(connection, period);
      const sync = await ensureTiktokSyncState(connection.id);
      if (!overview) {
        return NextResponse.json({
          connection: {
            id: connection.id,
            name: shop.shopName ?? `Loja ${shop.shopId}`,
            region: shop.region ?? "BR",
          },
          sync,
          coverage: null,
          overview: null,
        });
      }

      return NextResponse.json({
        connection: overview.period ? {
          id: connection.id,
          name: shop.shopName ?? `Loja ${shop.shopId}`,
          region: shop.region ?? "BR",
        } : null,
        sync,
        coverage: overview.coverage,
        financialCoverage: overview.financialCoverage,
        financialAvailability: overview.financialCoverage.status === "blocked" ? "BLOCKED" : "AVAILABLE",
        overview: overview.overview,
        orders: overview.orders,
        units: overview.units,
        ticket: overview.ticket,
        dailySeries: overview.dailySeries,
        statusBreakdown: overview.statusBreakdown,
        topProducts: overview.topProducts,
        catalog: overview.catalog,
        orderProfitability: overview.orderProfitability,
      });
    } catch (error) {
      const status = error instanceof RangeError ? 400 : 500;
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Erro ao carregar a TikTok Shop." },
        { status }
      );
    }
  });
}
