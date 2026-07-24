import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/apiError";
import { getAmazonAbc } from "@/lib/integrations/amazonAbc";
import { withAccountContext } from "@/lib/withAccount";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DAY = 86_400_000;
const ALLOWED_DAYS = new Set([7, 15, 30]);

function requestedPeriod(url: URL): { from: Date; to: Date } {
  const daysParam = url.searchParams.get("days") || "30";
  const to = new Date();
  if (daysParam === "today") {
    const brazilDate = new Date(to.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
    return { from: new Date(`${brazilDate}T00:00:00-03:00`), to };
  }
  const days = Number(daysParam);
  if (!ALLOWED_DAYS.has(days)) throw new RangeError("Selecione Hoje ou um período de 7, 15 ou 30 dias.");
  const startDate = new Date(to.getTime() - 3 * 3600_000 - days * DAY).toISOString().slice(0, 10);
  return { from: new Date(`${startDate}T00:00:00-03:00`), to };
}

export async function GET(req: NextRequest) {
  return withAccountContext(req, async () => {
    try {
      const period = requestedPeriod(new URL(req.url));
      const abc = await getAmazonAbc(period);
      if (!abc) return NextResponse.json({ error: "Dados indisponíveis." }, { status: 503 });
      return NextResponse.json(abc);
    } catch (err) {
      return errorResponse(err);
    }
  });
}
