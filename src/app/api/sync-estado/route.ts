import { NextRequest, NextResponse } from "next/server";

import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";
import { currentWorkspaceId } from "@/lib/workspaceScope";
import { dbQuery, hasDb } from "@/lib/db";
import { CICLO_ESPERADO_MIN } from "@/lib/saturacaoDoSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Estado do sync por canal (Monitor Unificado, E0): uma rota só para os quatro
// monitores lerem covered_from/last_success_at e a régua de saturação decidir
// no cliente. Devolve SÓ metadado de sincronização — nenhum número de negócio.

type SyncRow = {
  connection_id: string;
  status: string | null;
  covered_from: Date | string | null;
  last_success_at: Date | string | null;
};

function iso(value: Date | string | null): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export async function GET(req: NextRequest) {
  return withAuthenticatedWorkspace(async () => {
    const provider = req.nextUrl.searchParams.get("provider") ?? "";
    if (!(provider in CICLO_ESPERADO_MIN)) {
      return NextResponse.json({ error: "Canal desconhecido." }, { status: 400 });
    }
    // Sem banco não há metadado de sync — lista vazia mantém a tela em silêncio
    // (mesma regra da primeira sincronização), nunca um estado inventado.
    if (!hasDb()) return NextResponse.json({ conexoes: [] });

    const connectionId = req.nextUrl.searchParams.get("connection_id");
    const params: unknown[] = [currentWorkspaceId(), provider];
    let filtro = "";
    if (connectionId) {
      params.push(connectionId);
      filtro = " AND connection_id = $3";
    }
    const rows = await dbQuery<SyncRow>(
      `SELECT connection_id, status, covered_from, last_success_at
         FROM workspace_marketplace_syncs
        WHERE workspace_id = $1 AND provider = $2${filtro}`,
      params
    );
    return NextResponse.json({
      conexoes: rows.map((row) => ({
        connectionId: row.connection_id,
        status: row.status,
        coveredFrom: iso(row.covered_from),
        lastSuccessAt: iso(row.last_success_at),
      })),
    });
  });
}
