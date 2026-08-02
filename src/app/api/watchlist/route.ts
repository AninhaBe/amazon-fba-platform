import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/apiError";
import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";
import { runWithAccount } from "@/lib/accountContext";
import { getAccounts } from "@/lib/accountStore";
import { getCatalogIdentities } from "@/lib/search";
import { isValidAsin, listSearchTerms, listWatchlist, recordSeen, setPinned, setRemoved, type WatchlistEntry } from "@/lib/watchlist";

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

// PATCH { asin, action: "fixar" | "desafixar" | "remover" | "restaurar" }
export async function PATCH(req: NextRequest) {
  return withAuthenticatedWorkspace(async () => {
    try {
      const body = (await req.json().catch(() => ({}))) as { asin?: string; action?: string };
      const asin = String(body.asin || "").toUpperCase();
      const action = String(body.action || "");
      if (!isValidAsin(asin)) {
        return NextResponse.json({ error: "ASIN inválido." }, { status: 400 });
      }
      switch (action) {
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
