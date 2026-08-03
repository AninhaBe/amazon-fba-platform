import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/apiError";
import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";
import { runWithAccount } from "@/lib/accountContext";
import { getAccounts } from "@/lib/accountStore";
import { defaultMarketplaceId } from "@/lib/spapi";
import { recordRanks } from "@/lib/rankHistory";
import { fetchSnapshots } from "@/lib/integrations/amazonRankSnapshot";
import {
  asinsDesatualizados,
  isValidAsin,
  listSearchTerms,
  listWatchlist,
  recordSeen,
  type SeenItem,
} from "@/lib/watchlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Atualização ao vivo da posição, chamada pela tela de histórico ao exibir uma página.
//
// Regras que mantêm isso barato e coerente com "uma foto por dia":
// - Só os ASINs pedidos (a página envia os visíveis), com teto de uma página da tabela.
// - Foto de hoje com menos de IDADE_MIN minutos não é rebuscada.
// - O valor novo SOBRESCREVE a linha de hoje (upsert do recordRanks). Dias anteriores
//   são imutáveis — é deles que a variação vem.
const MAX_ASINS = 30;
const IDADE_MIN = 30;
const POR_CHAMADA = 20;

export async function POST(req: NextRequest) {
  return withAuthenticatedWorkspace(async () => {
    try {
      const body = (await req.json().catch(() => ({}))) as { asins?: unknown };
      const pedidos = (Array.isArray(body.asins) ? body.asins : [])
        .map((a) => String(a).toUpperCase())
        .filter(isValidAsin)
        .slice(0, MAX_ASINS);

      let atualizados = 0;
      const alvo = await asinsDesatualizados(pedidos, IDADE_MIN);
      if (alvo.length) {
        // Identidade de catálogo é pública e igual para qualquer vendedor: qualquer
        // conta Amazon deste workspace serve para a consulta.
        const account = (await getAccounts()).find((a) => a.refreshToken);
        if (account) {
          atualizados = await runWithAccount(
            { sellerId: account.sellerId, refreshToken: account.refreshToken },
            async () => {
              const mp = defaultMarketplaceId();
              const ranks: { asin: string; salesRank?: number; salesRankCategory?: string }[] = [];
              const identidades: SeenItem[] = [];
              for (let i = 0; i < alvo.length; i += POR_CHAMADA) {
                const mapa = await fetchSnapshots(alvo.slice(i, i + POR_CHAMADA), mp);
                for (const [asin, s] of mapa) {
                  if (s.rank != null) ranks.push({ asin, salesRank: s.rank, salesRankCategory: s.category });
                  identidades.push({ asin, title: s.title, brand: s.brand, imageUrl: s.imageUrl });
                }
              }
              if (ranks.length) await recordRanks(ranks);
              // Sem termo: só atualiza título/foto, sem mexer em last_seen_at.
              if (identidades.length) await recordSeen(identidades).catch(() => {});
              return ranks.length;
            }
          );
        }
      }

      const [items, terms] = await Promise.all([listWatchlist(), listSearchTerms()]);
      return NextResponse.json({ items, terms, atualizados });
    } catch (err) {
      return errorResponse(err);
    }
  });
}
