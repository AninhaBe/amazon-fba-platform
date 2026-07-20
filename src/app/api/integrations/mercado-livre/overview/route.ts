import { NextRequest, NextResponse } from "next/server";
import { getIntegration, getIntegrations } from "@/lib/integrations/integrationStore";
import { getMercadoLivreOverview } from "@/lib/integrations/mercadoLivre";

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

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const requested = url.searchParams.get("connectionId");
    const connection = requested
      ? await getIntegration(requested)
      : (await getIntegrations("mercado_livre"))[0];
    if (!connection || connection.provider !== "mercado_livre") {
      return NextResponse.json({ error: "Nenhuma conta do Mercado Livre conectada." }, { status: 404 });
    }
    return NextResponse.json({ connectionId: connection.id, overview: await getMercadoLivreOverview(connection, requestedPeriod(url)) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao consultar Mercado Livre." },
      { status: error instanceof RangeError ? 400 : 502 }
    );
  }
}
