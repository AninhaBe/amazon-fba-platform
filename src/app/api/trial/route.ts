import { NextResponse } from "next/server";
import { acknowledgeTrial, getTrial } from "@/lib/trial";
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

// Marca "não mostrar novamente" — a faixa com a contagem permanece.
export async function POST() {
  return withAuthenticatedWorkspace(
    async () => {
      try {
        return NextResponse.json({ trial: await acknowledgeTrial() });
      } catch {
        return NextResponse.json({ error: "Não foi possível salvar a preferência." }, { status: 500 });
      }
    },
    { allowExpiredTrial: true }
  );
}
