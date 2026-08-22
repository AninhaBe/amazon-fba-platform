import { NextRequest, NextResponse } from "next/server";

import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";
import { currentWorkspaceId } from "@/lib/workspaceScope";
import { cached } from "@/lib/cache";
import { narrarBriefing, type SnapshotCentral, type ModoNarracao } from "@/lib/centralBriefing";

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

// A saudação é computada no servidor porque o modelo erra a hora (mandou "bom
// dia" às 14h). Brasília não tem horário de verão desde 2019: offset fixo -3h.
function saudacaoDeBrasilia(): string {
  const hora = new Date(Date.now() - 3 * 60 * 60_000).getUTCHours();
  if (hora < 12) return "Bom dia";
  if (hora < 18) return "Boa tarde";
  return "Boa noite";
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
    // "briefing" = a matéria cheia (aba de briefing); "resumo" = a manchete curta
    // (Visão geral). Modos diferentes têm cache diário separado.
    const modo: ModoNarracao = (snapshot as { modo?: ModoNarracao }).modo === "briefing" ? "briefing" : "resumo";
    // Escopo separa o cache: "geral" (Visão geral, cross-channel) não pode
    // servir o mesmo texto que "amazon" (dashboard do canal). Só letras/dígitos.
    const escopoBruto = (snapshot as { escopo?: string }).escopo ?? "geral";
    const escopo = /^[a-z0-9_]{1,24}$/.test(escopoBruto) ? escopoBruto : "geral";
    // A data e a saudação vêm do servidor. A saudação entra na chave: como muda
    // de manhã/tarde/noite, o cache diário regenera no máximo 3 vezes ao dia — se
    // não, às 15h a pessoa veria o "Bom dia" cacheado de manhã.
    const dia = diaEmBrasilia();
    const saudacao = saudacaoDeBrasilia();
    const chave = `central-briefing:${modo}:${escopo}:${saudacao}:${currentWorkspaceId()}:${dia}`;
    // Só o texto real é cacheado. Resultado vazio (sem chave, erro transitório)
    // vira throw DENTRO do cache — o helper descacheia em erro, então a próxima
    // carga tenta de novo em vez de servir vazio o dia todo.
    let texto: string | null = null;
    try {
      texto = await cached(chave, 24 * 60 * 60_000, async () => {
        const t = await narrarBriefing({ ...snapshot, data: dia, saudacao }, modo);
        if (t == null) throw new Error("narração indisponível");
        return t;
      });
    } catch {
      texto = null;
    }
    return NextResponse.json({ texto, gerado: texto != null });
  });
}
