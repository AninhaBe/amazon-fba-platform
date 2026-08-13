import { NextRequest, NextResponse } from "next/server";
import { getIntegrations } from "@/lib/integrations/integrationStore";
import { getShopeeOverviewFromCanonical } from "@/lib/integrations/shopeeOverviewCanonical";
import { ensureShopeeSyncState } from "@/lib/integrations/shopeeSync";
import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";
import { requireShopeeConnection } from "@/lib/integrations/shopeeModules";
import { shopeePageRequest, ShopeeModuleError } from "@/lib/integrations/shopeeModuleContract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY = 86_400_000;
const ALLOWED_DAYS = new Set([7, 15, 30]);

// Mesmo contrato de período das demais rotas de canal: dia-calendário em São Paulo.
function requestedPeriod(url: URL) {
  const daysParam = url.searchParams.get("days") || "30";
  const daysValue = Number(daysParam);
  const to = new Date();

  if (daysParam === "today") {
    const brazilDate = new Date(to.getTime() - 3 * 60 * 60 * 1_000).toISOString().slice(0, 10);
    return { from: new Date(`${brazilDate}T00:00:00-03:00`), to, label: "Hoje" };
  }
  if (!ALLOWED_DAYS.has(daysValue)) throw new RangeError("Selecione Hoje ou um período de 7, 15 ou 30 dias.");
  const startDate = new Date(to.getTime() - 3 * 60 * 60 * 1_000 - daysValue * DAY).toISOString().slice(0, 10);
  return { from: new Date(`${startDate}T00:00:00-03:00`), to, label: `Últimos ${daysValue} dias` };
}

export async function GET(req: NextRequest) {
  return withAuthenticatedWorkspace(async () => {
    try {
      const url = new URL(req.url);
      const period = requestedPeriod(url);

      const connections = (await getIntegrations("shopee")).filter(
        (connection) => connection.status === "connected"
      );
      const connection = await requireShopeeConnection(url.searchParams);
      const detailPage = shopeePageRequest(url.searchParams);
      const publicConnections = connections.map((item) => ({
        id: item.id,
        externalAccountId: item.externalAccountId,
        name: item.displayName ?? `Loja ${item.externalAccountId}`,
        region: item.region ?? "BR",
        status: item.status,
      }));

      const sync = await ensureShopeeSyncState(connection.id);
      const overview = await getShopeeOverviewFromCanonical(connection, period, { detailPage });
      if (!overview) {
        // Conectado, mas sem ingestão ainda: a UI mostra o estado de sincronização
        // em vez de um dashboard zerado, que passaria a ideia errada de "sem vendas".
        return NextResponse.json({ pending: true, sync, selectedConnectionId: connection.id, connections: publicConnections, account: {
          id: connection.externalAccountId,
          name: connection.displayName ?? `Loja ${connection.externalAccountId}`,
          region: connection.region ?? "BR",
        } });
      }

      return NextResponse.json({ overview, sync, selectedConnectionId: connection.id, connections: publicConnections });
    } catch (error) {
      const status = error instanceof ShopeeModuleError ? error.status : error instanceof RangeError ? 400 : 500;
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Erro ao carregar a Shopee.",
          ...(error instanceof ShopeeModuleError ? { code: error.code } : {}) },
        { status }
      );
    }
  });
}
