import { NextRequest, NextResponse } from "next/server";

import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";
import { currentWorkspaceId } from "@/lib/workspaceScope";
import { cached } from "@/lib/cache";
import { narrarBriefing, type SnapshotCentral } from "@/lib/centralBriefing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Narração diária da Visão geral. O cliente manda o snapshot que a central já
// calculou (não confiamos nele para dado de negócio — o texto é só cosmético e
// só é exibido para quem enviou), e o servidor narra com o Claude.
//
// Custo controlado por cache DIÁRIO por workspace: a primeira carga do dia gera,
// o resto do dia lê o texto pronto. Sem ANTHROPIC_API_KEY, `narrarBriefing`
// devolve null e a tela usa o alerta por regra — degradação limpa.

function diaEmBrasilia(): string {
  return new Date(Date.now() - 3 * 60 * 60_000).toISOString().slice(0, 10);
}

export async function POST(req: NextRequest) {
  return withAuthenticatedWorkspace(async () => {
    let snapshot: SnapshotCentral;
    try {
      snapshot = (await req.json()) as SnapshotCentral;
    } catch {
      return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
    }
    if (!snapshot || !Array.isArray(snapshot.canais)) {
      return NextResponse.json({ error: "Snapshot incompleto." }, { status: 400 });
    }
    // A data vem do servidor, não do cliente: o cache é por dia de Brasília.
    const dia = diaEmBrasilia();
    const chave = `central-briefing:${currentWorkspaceId()}:${dia}`;
    const texto = await cached(chave, 24 * 60 * 60_000, () =>
      narrarBriefing({ ...snapshot, data: dia })
    );
    return NextResponse.json({ texto: texto ?? null, gerado: texto != null });
  });
}
