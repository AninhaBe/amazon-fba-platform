import { NextRequest, NextResponse } from "next/server";
import { getIntegration, getIntegrations } from "@/lib/integrations/integrationStore";
import { runMercadoLivreSyncStep } from "@/lib/integrations/mercadoLivreSync";
import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  return withAuthenticatedWorkspace(async () => {
    try {
      const requested = new URL(req.url).searchParams.get("connectionId");
      const connection = requested
        ? await getIntegration(requested)
        : (await getIntegrations("mercado_livre"))[0];
      if (!connection || connection.provider !== "mercado_livre") {
        return NextResponse.json({ error: "Nenhuma conta do Mercado Livre conectada." }, { status: 404 });
      }
      return NextResponse.json({ connectionId: connection.id, sync: await runMercadoLivreSyncStep(connection) });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Não foi possível sincronizar o Mercado Livre." },
        { status: 502 }
      );
    }
  });
}
