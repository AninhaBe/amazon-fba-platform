import { NextRequest, NextResponse } from "next/server";
import { getIntegration, getIntegrations } from "@/lib/integrations/integrationStore";
import { getMercadoLivreAbc } from "@/lib/integrations/mercadoLivreAbc";
import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DAY = 86_400_000;
const ALLOWED_DAYS = new Set([7, 15, 30]);

function requestedPeriod(url: URL) {
  const daysParam = url.searchParams.get("days") || "30";
  const to = new Date();
  if (daysParam === "today") {
    const brazilDate = new Date(to.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
    return { from: new Date(`${brazilDate}T00:00:00-03:00`), to, label: "Hoje" };
  }
  const days = Number(daysParam);
  if (!ALLOWED_DAYS.has(days)) throw new RangeError("Selecione Hoje ou um período de 7, 15 ou 30 dias.");
  const startDate = new Date(to.getTime() - 3 * 3600_000 - days * DAY).toISOString().slice(0, 10);
  return { from: new Date(`${startDate}T00:00:00-03:00`), to, label: `Últimos ${days} dias` };
}

export async function GET(req: NextRequest) {
  return withAuthenticatedWorkspace(async () => {
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
      const abc = await getMercadoLivreAbc(connection, period);
      if (!abc) return NextResponse.json({ error: "Dados indisponíveis." }, { status: 503 });
      return NextResponse.json(abc);
    } catch (error) {
      const status = error instanceof RangeError ? 400 : 502;
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Não foi possível montar a curva ABC." },
        { status }
      );
    }
  });
}
