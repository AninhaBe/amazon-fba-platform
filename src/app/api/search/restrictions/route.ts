import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/apiError";
import { getRestrictionsBatch } from "@/lib/restrictions";
import { withAccountContext } from "@/lib/withAccount";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Elegibilidade de venda (gating) para uma lista de ASINs, na conta ativa.
// Chamado pela /pesquisa depois que os resultados carregam (camada "sob demanda"),
// para não deixar a busca principal lenta.
export async function GET(req: NextRequest) {
  return withAccountContext(req, async () => {
    try {
      const asins = (new URL(req.url).searchParams.get("asins") || "")
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean);
      if (asins.length === 0) return NextResponse.json({ restrictions: {} });
      const restrictions = await getRestrictionsBatch(asins);
      return NextResponse.json({ restrictions });
    } catch (err) {
      return errorResponse(err);
    }
  });
}
