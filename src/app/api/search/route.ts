import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/apiError";
import { searchProducts } from "@/lib/search";
import { getRankDeltas, recordRanks } from "@/lib/rankHistory";
import { recordSeen } from "@/lib/watchlist";
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
      // Captura de histórico de ranking (ADR-009) + identidade na watchlist (ADR-011).
      // Custo zero — rank, título e foto já vieram na resposta. Falha aqui não quebra
      // a busca. `q` fica vazio na paginação sem termo; nesse caso não sobrescreve.
      try {
        await recordRanks(results.items);
        await recordSeen(results.items, q || undefined);
      } catch {
        /* histórico é best-effort */
      }
      // Variação vs. a foto anterior (setinha ↑/↓). Também best-effort.
      let items = results.items;
      try {
        const deltas = await getRankDeltas(items.map((i) => i.asin));
        items = items.map((i) => {
          const d = deltas[i.asin];
          return d?.delta != null && d.delta !== 0
            ? { ...i, rankDelta: d.delta, rankPrevDate: d.previousDate }
            : i;
        });
      } catch {
        /* sem histórico ainda — segue sem setinha */
      }
      return NextResponse.json({ ...results, items });
    } catch (err) {
      return errorResponse(err);
    }
  });
}
