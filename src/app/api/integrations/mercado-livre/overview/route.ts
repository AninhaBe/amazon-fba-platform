import { after } from "next/server";
import { NextRequest, NextResponse } from "next/server";
import { getIntegration, getIntegrations } from "@/lib/integrations/integrationStore";
import { getMercadoLivreOverview } from "@/lib/integrations/mercadoLivre";
import { getMercadoLivreOverviewFromCanonical } from "@/lib/integrations/mercadoLivreOverviewCanonical";
import { requestMercadoLivreSync, runMercadoLivreSyncBatch } from "@/lib/integrations/mercadoLivreSync";
import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";
import { hasDb } from "@/lib/db";
import { currentWorkspaceId, runWithWorkspace } from "@/lib/workspaceScope";

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
  if (!ALLOWED_DAYS.has(daysValue)) throw new RangeError("Selecione Hoje ou um período de 7, 15 ou 30 dias.");
  return { from: new Date(to.getTime() - daysValue * DAY), to, label: `Últimos ${daysValue} dias` };
}

function timedJson(body: unknown, startedAt: number, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Server-Timing", `total;dur=${(performance.now() - startedAt).toFixed(1)}`);
  return response;
}

export async function GET(req: NextRequest) {
  return withAuthenticatedWorkspace(async () => {
  const startedAt = performance.now();
  try {
    const url = new URL(req.url);
    const requested = url.searchParams.get("connectionId");
    const connection = requested
      ? await getIntegration(requested)
      : (await getIntegrations("mercado_livre"))[0];
    if (!connection || connection.provider !== "mercado_livre") {
      return NextResponse.json({ error: "Nenhuma conta do Mercado Livre conectada." }, { status: 404 });
    }
    const period = requestedPeriod(url);
    const requestedView = url.searchParams.get("view");
    const view = requestedView === "monitor" || requestedView === "estoque" ? requestedView : "dashboard";
    if (hasDb()) {
      const workspaceId = currentWorkspaceId();
      // A leitura vem direto do modelo canônico (SQL indexado) — rápido o
      // bastante para dispensar snapshots e materializer, inclusive em
      // períodos personalizados. O sync avança o histórico em segundo plano,
      // fora do caminho da resposta.
      const [sync, overview] = await Promise.all([
        requestMercadoLivreSync(connection.id),
        getMercadoLivreOverviewFromCanonical(connection, period),
      ]);
      const syncNeedsWork = sync.status !== "complete" && sync.status !== "error" && sync.status !== "unavailable";
      if (syncNeedsWork) {
        after(() => runWithWorkspace(workspaceId, async () => {
          try {
            await runMercadoLivreSyncBatch(connection, process.env.VERCEL ? 4 : 8);
          } catch (error) {
            console.error("Falha ao avançar sincronização do Mercado Livre", {
              connectionId: connection.id,
              reason: error instanceof Error ? error.message : "Erro desconhecido",
            });
          }
        }));
      }
      if (!overview) {
        const response = timedJson(
          { connectionId: connection.id, overview: null, sync, preparing: syncNeedsWork || undefined },
          startedAt,
          { status: 202 }
        );
        response.headers.set("X-SellerCore-Cache", "EMPTY");
        return response;
      }
      if (view !== "monitor") overview.profitabilityLines = [];
      const response = timedJson({
        connectionId: connection.id,
        overview,
        sync,
        updatedAt: sync.lastSuccessAt || new Date().toISOString(),
        cached: false,
      }, startedAt);
      response.headers.set("X-SellerCore-Cache", "SQL");
      return response;
    }
    return timedJson({ connectionId: connection.id, overview: await getMercadoLivreOverview(connection, period) }, startedAt);
  } catch (error) {
    return timedJson(
      { error: error instanceof Error ? error.message : "Erro ao consultar Mercado Livre." },
      startedAt,
      { status: error instanceof RangeError ? 400 : 502 }
    );
  }
  });
}
