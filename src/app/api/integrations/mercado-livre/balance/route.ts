import { NextRequest, NextResponse } from "next/server";
import { getIntegration, getIntegrations } from "@/lib/integrations/integrationStore";
import { getMercadoLivreBalance } from "@/lib/integrations/mercadoLivre";
import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";
import { cached } from "@/lib/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sem `period`: saldo é o estado de AGORA. Filtrar por período esconderia uma
// liberação fora da janela e diria que não há nada a receber.
export async function GET(req: NextRequest) {
  return withAuthenticatedWorkspace(async () => {
    const requested = new URL(req.url).searchParams.get("connectionId");
    const connection = requested ? await getIntegration(requested) : (await getIntegrations("mercado_livre"))[0];
    if (!connection || connection.provider !== "mercado_livre") {
      return NextResponse.json({ error: "Nenhuma conta do Mercado Livre conectada." }, { status: 404 });
    }
    try {
      // 10 min: são até 6 chamadas ao Mercado Pago por leitura, e o saldo não
      // muda a cada refresh de tela.
      const saldo = await cached(`ml-balance:${connection.id}`, 10 * 60_000, () =>
        getMercadoLivreBalance(connection)
      );
      return NextResponse.json(saldo);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Não foi possível ler o saldo." },
        { status: 502 }
      );
    }
  });
}
