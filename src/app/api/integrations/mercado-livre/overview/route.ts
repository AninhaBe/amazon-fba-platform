import { NextRequest, NextResponse } from "next/server";
import { getIntegration, getIntegrations } from "@/lib/integrations/integrationStore";
import { getMercadoLivreOverview } from "@/lib/integrations/mercadoLivre";
import { getMercadoLivreOverviewFromCanonical } from "@/lib/integrations/mercadoLivreOverviewCanonical";
import { requestMercadoLivreSync, runMercadoLivreSyncBatch } from "@/lib/integrations/mercadoLivreSync";
import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";
import { hasDb } from "@/lib/db";
import { currentWorkspaceId, runWithWorkspace } from "@/lib/workspaceScope";
import { anunciosPorProdutoNoPeriodo, cruzarComMargem } from "@/lib/integrations/amazonAdsPorProduto";
import { depoisDaResposta } from "@/lib/depoisDaResposta";

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
  // Dia-calendário em São Paulo (00:00 de N dias atrás), como o painel do ML — janela rolante de N*24h descarta o começo do dia-limite.
  const startDate = new Date(to.getTime() - 3 * 60 * 60 * 1_000 - daysValue * DAY).toISOString().slice(0, 10);
  return { from: new Date(`${startDate}T00:00:00-03:00`), to, label: `Últimos ${daysValue} dias` };
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
      // ═══ PRÉVIA vs COMPLETO (contrato com a Vitrine, 13/09/2026) ═══════════
      //
      // O dashboard renderiza 5 linhas e recebia 1000 — 567 KB de 595 KB do
      // payload eram lista morta (medição dela). Só o MONITOR precisa da lista
      // inteira; dashboard e estoque pedem a prévia, que também PULA a busca
      // detalhada dos 1000 no servidor (a LATERAL de tarifas roda 5×, não
      // 1000×). Faixa, Top 8 e ritmo já vêm de agregado SQL do período inteiro
      // — nenhum número da tela muda (diff ao centavo na sonda antes/depois).
      const [sync, overview] = await Promise.all([
        requestMercadoLivreSync(connection.id),
        getMercadoLivreOverviewFromCanonical(connection, period, {
          detalhe: view === "monitor" ? "completo" : "previa",
        }),
      ]);
      const syncNeedsWork = sync.status !== "complete" && sync.status !== "error" && sync.status !== "unavailable";
      if (syncNeedsWork) {
        depoisDaResposta("ml-overview:sync", () => runWithWorkspace(workspaceId, async () => {
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
        response.headers.set("X-Nexo-Cache", "EMPTY");
        return response;
      }
      // Dashboard e monitor mostram a rentabilidade por venda; só o estoque dispensa as linhas.
      if (view === "estoque") overview.profitabilityLines = [];
      // Anúncio por produto (Product Ads), cruzado com a margem real de cada
      // SKU. Mesma leitura da Amazon, parametrizada por canal — a tabela da
      // migration 0016 é agnóstica. Só no dashboard: o estoque não usa.
      const adsPorProduto = view === "estoque" ? [] : cruzarComMargem(
        await anunciosPorProdutoNoPeriodo(period.from.toISOString(), period.to.toISOString(), "mercado_livre").catch(() => []),
        overview.topProducts.map((produto) => ({ sku: produto.sku ?? produto.id, marginPct: produto.marginPct })),
      );
      const response = timedJson({
        connectionId: connection.id,
        overview,
        adsPorProduto,
        sync,
        updatedAt: sync.lastSuccessAt || new Date().toISOString(),
        cached: false,
      }, startedAt);
      response.headers.set("X-Nexo-Cache", "SQL");
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
