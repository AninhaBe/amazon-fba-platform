import { NextRequest, NextResponse } from "next/server";

import { errorResponse } from "@/lib/apiError";
import { resolvePeriod } from "@/lib/period";
import { withAuthenticatedWorkspace } from "@/lib/workspaceContext";
import { lerAdsMultiCanal } from "@/lib/adsMultiCanal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A aba de Anúncios inteira, numa chamada — ADR-017 (uma tela, uma requisição).
 *
 * ⚠️ O PAYLOAD NÃO TEM TOTAL DOS QUATRO CANAIS, e a ausência é a defesa.
 *
 * Hoje a Amazon tem 19 dias de histórico e o Mercado Livre 3 (medido em
 * 30/08/2026), com o ML gastando 6× mais. Um "total" somaria janelas diferentes
 * e produziria um número que parece errado — e está. Deixar o campo fora da
 * resposta é estrutural: quem for escrever a próxima tela daqui a três meses não
 * encontra o número para somar por engano. Cada canal carrega a própria
 * `janela`, e é ela que a tela cola no valor.
 *
 * O "sobrou" (margem de contribuição pós-ads) também NÃO vem daqui: a conta mora
 * em `src/lib/margemPosAds.ts`, num lugar só, alcançável por qualquer consumidor
 * — tela, briefing, detector ou e-mail. Ver o comentário de lá sobre por que ela
 * não é feita por venda atribuída.
 */
export async function GET(req: NextRequest) {
  return withAuthenticatedWorkspace(async () => {
    try {
      const period = resolvePeriod(req.nextUrl.searchParams);
      const dados = await lerAdsMultiCanal(period.startISO, period.endISO);
      return NextResponse.json(dados);
    } catch (error) {
      return errorResponse(error);
    }
  });
}
