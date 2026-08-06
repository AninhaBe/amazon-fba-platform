import { NextResponse } from "next/server";
import { getTrial } from "@/lib/trial";
import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Estado do período de avaliação da conta logada. Contas normais recebem
// `{ trial: null }` — a interface não mostra nada.
export async function GET() {
  return withAuthenticatedWorkspace(
    async () => {
      try {
        return NextResponse.json({ trial: await getTrial() });
      } catch {
        // O aviso é acessório: se falhar, a plataforma segue normal.
        return NextResponse.json({ trial: null });
      }
    },
    // Precisa responder justamente quando o período venceu — é o que permite
    // a tela explicar o motivo em vez de só quebrar.
    { allowExpiredTrial: true }
  );
}
