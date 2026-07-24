import { NextRequest, NextResponse } from "next/server";
import { getIntegration, getIntegrations } from "@/lib/integrations/integrationStore";
import { getMercadoLivreRanking } from "@/lib/integrations/mercadoLivreRanking";
import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  return withAuthenticatedWorkspace(async () => {
    try {
      const url = new URL(req.url);
      const term = (url.searchParams.get("q") ?? "").trim();
      if (!term) {
        return NextResponse.json({ error: "Informe um termo de busca." }, { status: 400 });
      }
      const requested = url.searchParams.get("connectionId");
      const connection = requested
        ? await getIntegration(requested)
        : (await getIntegrations("mercado_livre"))[0];
      if (!connection || connection.provider !== "mercado_livre") {
        return NextResponse.json({ error: "Nenhuma conta do Mercado Livre conectada." }, { status: 404 });
      }
      const ranking = await getMercadoLivreRanking(connection, term);
      return NextResponse.json(ranking);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Não foi possível consultar o ranqueamento." },
        { status: 502 }
      );
    }
  });
}
