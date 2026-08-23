import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/apiError";
import { getFinanceSummary } from "@/lib/finances";
import { faturamentoDoPeriodo } from "@/lib/integrations/amazonFaturamentoCanonico";
import { resolvePeriod } from "@/lib/period";
import { withAccountContext } from "@/lib/withAccount";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withAccountContext(req, async () => {
    try {
      const period = resolvePeriod(new URL(req.url).searchParams);
      const summary = await getFinanceSummary(period);
      // O MESMO faturamento que o dashboard mostra, lido do banco canônico.
      //
      // Sem isto o monitor abria em "Receita conciliada" e o dashboard em
      // "Faturamento", com valores diferentes e nenhuma ponte entre eles — ela
      // cobrou, com razão: "não bate ainda, tem que vir o mesmo dado"
      // (23/08/2026). Não eram duas verdades: a conciliada é a mesma receita
      // MENOS os pedidos que a Amazon ainda não valorizou. Agora a cascata
      // começa no número que ela já conhece e desconta essa parte à vista.
      // Falha aqui não derruba o financeiro: sem os campos, a tela usa a
      // cascata antiga.
      const bruto = await faturamentoDoPeriodo(period).catch(() => null);
      return NextResponse.json({ summary: { ...summary, ...(bruto ?? {}) } });
    } catch (err) {
      return errorResponse(err);
    }
  });
}
