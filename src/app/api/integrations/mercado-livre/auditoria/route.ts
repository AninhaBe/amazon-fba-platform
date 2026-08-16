import { NextRequest, NextResponse } from "next/server";
import { getIntegration, getIntegrations } from "@/lib/integrations/integrationStore";
import { getMercadoLivreAuditoria } from "@/lib/integrations/mercadoLivre";
import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";
import { cached } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DIAS_PADRAO = 30;
const DIAS_MAX = 180;

export async function GET(req: NextRequest) {
  return withAuthenticatedWorkspace(async () => {
    const params = new URL(req.url).searchParams;
    const requested = params.get("connectionId");
    const connection = requested ? await getIntegration(requested) : (await getIntegrations("mercado_livre"))[0];
    if (!connection || connection.provider !== "mercado_livre") {
      return NextResponse.json({ error: "Nenhuma conta do Mercado Livre conectada." }, { status: 404 });
    }
    // Janela limitada: cada leitura são até 5 chamadas ao Mercado Pago mais uma
    // consulta ao banco. Período aberto convidaria a varrer 36 mil pedidos numa
    // requisição de tela — o erro que o ADR-014 registra.
    const pedidoDias = Number(params.get("dias"));
    const dias = Number.isFinite(pedidoDias) && pedidoDias > 0 ? Math.min(pedidoDias, DIAS_MAX) : DIAS_PADRAO;
    const to = new Date();
    const from = new Date(to.getTime() - dias * 86_400_000);
    try {
      const resultado = await cached(`ml-auditoria:${connection.id}:${dias}`, 15 * 60_000, () =>
        getMercadoLivreAuditoria(connection, { from, to })
      );
      return NextResponse.json({ ...resultado, dias });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Não foi possível auditar os fretes." },
        { status: 502 }
      );
    }
  });
}
