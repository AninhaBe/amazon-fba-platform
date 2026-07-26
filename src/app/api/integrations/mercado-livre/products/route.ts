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
    // Não lista anúncios ENCERRADOS (closed) — são listings mortos (análogo aos SKUs
    // fantasma da Amazon) e não fazem sentido na tela de cadastro de custo. Filtro só
    // aqui (não na função compartilhada, que o overview também usa).
    const data = await getMercadoLivreProducts(connection);
    return NextResponse.json({ ...data, products: data.products.filter((p) => p.status !== "closed") });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao carregar os produtos." },
      { status: 502 }
    );
  }
  });
}
