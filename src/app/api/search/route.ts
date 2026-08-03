import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/apiError";
import { searchProducts } from "@/lib/search";
import { getRankDeltas, recordRanks } from "@/lib/rankHistory";
import { listMonitored } from "@/lib/watchlist";
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
      // Captura de histórico de ranking (ADR-009): o rank já veio na resposta, então
      // guardar custa zero. Fica registrado mesmo para quem não é monitorado — assim,
      // se a pessoa decidir monitorar depois, já existe um primeiro ponto.
      //
      // O que NÃO acontece aqui é entrar na watchlist: monitorar é opt-in, pelo botão
      // de cada linha. Sem isso, cada busca somaria 20 anúncios à foto diária.
      try {
        await recordRanks(results.items);
      } catch {
        /* histórico é best-effort */
      }
      // Variação vs. a foto anterior (setinha ↑/↓). Também best-effort.
      let items = results.items;
      try {
        const monitorados = await listMonitored(items.map((i) => i.asin));
        items = items.map((i) => ({ ...i, monitorado: monitorados.has(i.asin) }));
      } catch {
        /* sem o marcador o botão só aparece como "monitorar" */
      }
      try {
        const deltas = await getRankDeltas(items.map((i) => i.asin));
        items = items.map((i) => {
          const d = deltas[i.asin];
          // Delta zero também vai para a tela: "comparei e não mudou" é informação,
          // e é diferente de "ainda não tenho com o que comparar" (delta ausente).
          return d?.delta != null
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
