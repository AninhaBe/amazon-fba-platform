import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/apiError";
import { getAmazonBalance } from "@/lib/transactions";
import { withAccountContext } from "@/lib/withAccount";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sem `period`: saldo é o estado de AGORA. Filtrar por período esconderia uma
// venda retida fora da janela e diria que não há nada a receber.
export async function GET(req: NextRequest) {
  return withAccountContext(req, async () => {
    try {
      return NextResponse.json(await getAmazonBalance());
    } catch (err) {
      return errorResponse(err);
    }
  }, {
    // Sem conta SP-API não há saldo a mostrar — a tela some, não zera.
    onMissingAccount: async () => null,
  });
}
