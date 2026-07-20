import { NextRequest, NextResponse } from "next/server";
import { getIntegration, getIntegrations } from "@/lib/integrations/integrationStore";
import { getMercadoLivreProducts } from "@/lib/integrations/mercadoLivre";
import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withAuthenticatedWorkspace(async () => {
  try {
    const requested = new URL(req.url).searchParams.get("connectionId");
    const connection = requested
      ? await getIntegration(requested)
      : (await getIntegrations("mercado_livre"))[0];
    if (!connection || connection.provider !== "mercado_livre") {
      return NextResponse.json({ error: "Nenhuma conta do Mercado Livre conectada." }, { status: 404 });
    }
    return NextResponse.json(await getMercadoLivreProducts(connection));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao carregar os produtos." },
      { status: 502 }
    );
  }
  });
}
