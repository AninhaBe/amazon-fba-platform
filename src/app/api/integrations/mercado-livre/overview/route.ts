import { after } from "next/server";
import { NextRequest, NextResponse } from "next/server";
import { getIntegration, getIntegrations } from "@/lib/integrations/integrationStore";
import { getMercadoLivreOverview } from "@/lib/integrations/mercadoLivre";
import { loadMercadoLivreSource, requestMercadoLivreSync, runMercadoLivreSyncBatch } from "@/lib/integrations/mercadoLivreSync";
import {
  loadMercadoLivreOverviewSnapshot,
  saveMercadoLivreOverviewSnapshot,
} from "@/lib/integrations/mercadoLivreOverviewCache";
import { materializeMercadoLivrePresetOverviews } from "@/lib/integrations/mercadoLivreOverviewMaterializer";
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
      cacheKey: `custom:${fromValue}:${toValue}`,
    };
  }

  const to = new Date();
  if (daysParam === "today") {
    const brazilDate = new Date(to.getTime() - 3 * 60 * 60 * 1_000).toISOString().slice(0, 10);
    return { from: new Date(`${brazilDate}T00:00:00-03:00`), to, label: "Hoje", cacheKey: `today:${brazilDate}` };
  }
  if (!ALLOWED_DAYS.has(daysValue)) throw new RangeError("Selecione Hoje ou um período de 7, 15 ou 30 dias.");
  return { from: new Date(to.getTime() - daysValue * DAY), to, label: `Últimos ${daysValue} dias`, cacheKey: `days:${daysValue}` };
}

type Overview = Awaited<ReturnType<typeof getMercadoLivreOverview>>;

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
    const snapshotKey = `${period.cacheKey}:view:${view}`;
    if (hasDb()) {
      const workspaceId = currentWorkspaceId();
      const sync = await requestMercadoLivreSync(connection.id);
      const syncNeedsWork = sync.status !== "complete" && sync.status !== "error" && sync.status !== "unavailable";
      if (syncNeedsWork) {
        after(() => runWithWorkspace(workspaceId, async () => {
          try {
            // A leitura solicitada tem prioridade sobre a importação histórica.
            await materializeMercadoLivrePresetOverviews(connection, {
              periodKey: period.cacheKey,
              view,
            });
          } catch (error) {
            console.error("Falha ao preparar leitura do Mercado Livre", {
              connectionId: connection.id,
              reason: error instanceof Error ? error.message : "Erro desconhecido",
            });
          }
          try {
            // Lotes menores evitam que o trabalho histórico monopolize o Render.
            await runMercadoLivreSyncBatch(connection, process.env.VERCEL ? 4 : 8);
          } catch (error) {
            console.error("Falha ao avançar sincronização do Mercado Livre", {
              connectionId: connection.id,
              reason: error instanceof Error ? error.message : "Erro desconhecido",
            });
          }
        }));
      }
      const snapshot = await loadMercadoLivreOverviewSnapshot<Overview>(connection.id, snapshotKey);
      if (snapshot) {
        if (snapshot.stale) {
          after(() => runWithWorkspace(workspaceId, async () => {
            try {
              if (!period.cacheKey.startsWith("custom:")) {
                await materializeMercadoLivrePresetOverviews(connection, {
                  periodKey: period.cacheKey,
                  view,
                });
                return;
              }
              const latest = await loadMercadoLivreSource(connection, period);
              if (!latest.source) return;
              const refreshed = await getMercadoLivreOverview(connection, period, latest.source);
              if (view !== "monitor") refreshed.profitabilityLines = [];
              await saveMercadoLivreOverviewSnapshot(connection.id, snapshotKey, refreshed);
            } catch (error) {
              console.error("Falha ao revalidar snapshot do Mercado Livre", {
                connectionId: connection.id,
                period: snapshotKey,
                reason: error instanceof Error ? error.message : "Erro desconhecido",
              });
            }
          }));
        }
        const response = timedJson({
          connectionId: connection.id,
          overview: snapshot.payload,
          sync,
          updatedAt: snapshot.generatedAt,
          cached: true,
        }, startedAt);
        response.headers.set("X-SellerCore-Cache", snapshot.stale ? "STALE" : "HIT");
        return response;
      }
      if (!period.cacheKey.startsWith("custom:")) {
        if (!syncNeedsWork) {
          after(() => runWithWorkspace(workspaceId, async () => {
            try {
              await materializeMercadoLivrePresetOverviews(connection, {
                periodKey: period.cacheKey,
                view,
              });
            } catch (error) {
              console.error("Falha ao preparar dashboards do Mercado Livre", {
                connectionId: connection.id,
                reason: error instanceof Error ? error.message : "Erro desconhecido",
              });
            }
          }));
        }
        const response = timedJson(
          { connectionId: connection.id, overview: null, sync, preparing: true },
          startedAt,
          { status: 202 }
        );
        response.headers.set("X-SellerCore-Cache", "MISS-PREPARING");
        return response;
      }
      const cached = await loadMercadoLivreSource(connection, period);
      if (!cached.source) {
        return timedJson(
          { connectionId: connection.id, overview: null, sync: cached.sync },
          startedAt,
          { status: 202 }
        );
      }
      const overview = await getMercadoLivreOverview(connection, period, cached.source);
      if (view !== "monitor") overview.profitabilityLines = [];
      const generatedAt = await saveMercadoLivreOverviewSnapshot(connection.id, snapshotKey, overview);
      if (!syncNeedsWork && !period.cacheKey.startsWith("custom:")) {
        after(() => runWithWorkspace(workspaceId, () =>
          materializeMercadoLivrePresetOverviews(connection, {
            periodKey: period.cacheKey,
            view,
          }).then(() => undefined)
        ));
      }
      const response = timedJson({
        connectionId: connection.id,
        overview,
        sync: cached.sync,
        updatedAt: cached.sync.lastSuccessAt || generatedAt,
        cached: false,
      }, startedAt);
      response.headers.set("X-SellerCore-Cache", "MISS");
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
