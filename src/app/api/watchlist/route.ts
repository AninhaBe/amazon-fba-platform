import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/apiError";
import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";
import { runWithAccount } from "@/lib/accountContext";
import { getAccounts } from "@/lib/accountStore";
import { getCatalogIdentities } from "@/lib/search";
import {
  isValidAsin,
  listSearchTerms,
  listWatchlist,
  monitorar,
  recordSeen,
  setPinned,
  setRemoved,
  setRemovedMany,
  type WatchlistEntry,
} from "@/lib/watchlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A watchlist é lida só do banco (ADR-011) — não precisa de conta Amazon selecionada,
// só do workspace autenticado. Por isso não usa withAccountContext.

// Quantos ASINs sem identidade resolver por requisição (20 por chamada à Catalog API).
const LOTE_IDENTIDADE = 60;

/**
 * Preenche título/marca/foto de quem ainda está sem. Os ASINs herdados do histórico
 * anterior à ADR-011 entraram só com o código; sem isso a lista fica ilegível até a
 * próxima passada do cron. Melhor esforço: se falhar, a lista aparece como está.
 *
 * Retorna true quando gravou algo (aí vale reler antes de responder).
 */
async function preencherIdentidades(items: WatchlistEntry[]): Promise<boolean> {
  const faltando = items.filter((i) => !i.title).map((i) => i.asin).slice(0, LOTE_IDENTIDADE);
  if (!faltando.length) return false;
  // getAccounts é escopado no workspace autenticado. Identidade de catálogo é pública
  // e igual para qualquer vendedor, então qualquer conta deste workspace serve.
  const accounts = await getAccounts();
  const account = accounts.find((a) => a.refreshToken);
  if (!account) return false;

  const ids = await runWithAccount(
    { sellerId: account.sellerId, refreshToken: account.refreshToken },
    () => getCatalogIdentities(faltando)
  );
  if (!ids.size) return false;
  // Sem termo de busca: só completa a identidade, não mexe em last_seen_at.
  await recordSeen([...ids].map(([asin, id]) => ({ asin, ...id })));
  return true;
}

export async function GET() {
  return withAuthenticatedWorkspace(async () => {
    try {
      const [items, terms] = await Promise.all([listWatchlist(), listSearchTerms()]);
      const preencheu = await preencherIdentidades(items).catch(() => false);
      return NextResponse.json({ items: preencheu ? await listWatchlist() : items, terms });
    } catch (err) {
      return errorResponse(err);
    }
  });
}

// PATCH { asin, action, ...identidade }
//   monitorar — passa a acompanhar (aceita title/brand/imageUrl/searchTerm da busca)
//   remover   — para de acompanhar (soft delete; o histórico já coletado permanece)
//   fixar / desafixar / restaurar
export async function PATCH(req: NextRequest) {
  return withAuthenticatedWorkspace(async () => {
    try {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const action = String(body.action || "");

      // Em massa: { asins: [...], action: "remover" | "restaurar" } — a seleção da tela.
      if (Array.isArray(body.asins)) {
        if (action !== "remover" && action !== "restaurar") {
          return NextResponse.json({ error: "Ação inválida para vários itens." }, { status: 400 });
        }
        const asins = body.asins.map((a) => String(a).toUpperCase()).filter(isValidAsin).slice(0, 500);
        if (!asins.length) return NextResponse.json({ error: "Nenhum ASIN válido." }, { status: 400 });
        await setRemovedMany(asins, action === "remover");
        const [items, terms] = await Promise.all([listWatchlist(), listSearchTerms()]);
        return NextResponse.json({ items, terms });
      }

      const asin = String(body.asin || "").toUpperCase();
      if (!isValidAsin(asin)) {
        return NextResponse.json({ error: "ASIN inválido." }, { status: 400 });
      }
      switch (action) {
        case "monitorar":
          // A identidade vem do resultado da busca que o cliente já tem em mãos, o que
          // evita uma ida extra à Catalog API só para preencher título e foto.
          // `monitorar` valida o ASIN e corta os textos antes de gravar.
          await monitorar(asin, body);
          break;
        case "fixar":
          await setPinned(asin, true);
          break;
        case "desafixar":
          await setPinned(asin, false);
          break;
        case "remover":
          await setRemoved(asin, true);
          break;
        case "restaurar":
          await setRemoved(asin, false);
          break;
        default:
          return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
      }
      const [items, terms] = await Promise.all([listWatchlist(), listSearchTerms()]);
      return NextResponse.json({ items, terms });
    } catch (err) {
      return errorResponse(err);
    }
  });
}
