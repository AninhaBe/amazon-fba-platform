import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/apiError";
import { searchProducts } from "@/lib/search";
import { recordRanks } from "@/lib/rankHistory";
import { withAccountContext } from "@/lib/withAccount";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withAccountContext(req, async () => {
    try {
      const { searchParams } = new URL(req.url);
      const q = (searchParams.get("q") || "").trim();
      const pageToken = searchParams.get("pageToken") || undefined;
      if (!q && !pageToken) {
        return NextResponse.json({ error: "Digite o que quer pesquisar." }, { status: 400 });
      }
      const results = await searchProducts(q, pageToken);
      // Captura de histórico de ranking (ADR-009): grava o rank atual dos resultados.
      // Custo zero — o rank já veio na resposta. Uma falha aqui não quebra a busca.
      try {
        await recordRanks(results.items);
      } catch {
        /* histórico é best-effort */
      }
      return NextResponse.json(results);
    } catch (err) {
      return errorResponse(err);
    }
  });
}
