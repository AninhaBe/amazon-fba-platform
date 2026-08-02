import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/apiError";
import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";
import { isValidAsin, listSearchTerms, listWatchlist, setPinned, setRemoved } from "@/lib/watchlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A watchlist é lida só do banco (ADR-011) — não precisa de conta Amazon selecionada,
// só do workspace autenticado. Por isso não usa withAccountContext.

export async function GET() {
  return withAuthenticatedWorkspace(async () => {
    try {
      const [items, terms] = await Promise.all([listWatchlist(), listSearchTerms()]);
      return NextResponse.json({ items, terms });
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
