import { NextRequest, NextResponse } from "next/server";
import { expurgarEventosProcessados, RETENCAO_EVENTOS_DIAS } from "@/lib/retencao";

// Expurgo de dados efêmeros — ver ADR-016.
// Roda no cron do GitHub Actions, junto dos syncs.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  // `dias` permite ampliar a janela numa execução manual, nunca encurtá-la abaixo
  // do padrão: expurgo mais agressivo que a política do ADR-016 exige nova decisão.
  const pedido = Number(req.nextUrl.searchParams.get("dias"));
  const dias =
    Number.isFinite(pedido) && pedido >= RETENCAO_EVENTOS_DIAS
      ? pedido
      : RETENCAO_EVENTOS_DIAS;

  try {
    const resultado = await expurgarEventosProcessados(dias);
    // ADR-016, regra 4: nada de expurgo silencioso.
    console.log(
      `[retencao] ${resultado.tabela}: ${resultado.removidas} removidas, ` +
        `${resultado.restantes} restantes, ${resultado.aindaElegiveis} ainda elegíveis ` +
        `(janela de ${dias} dias, ${resultado.duracaoMs}ms)`
    );
    return NextResponse.json({ ok: true, dias, ...resultado });
  } catch (erro) {
    // Mensagem genérica para fora, detalhe só no log do servidor.
    console.error("[retencao] falhou:", erro);
    return NextResponse.json(
      { error: "Falha ao aplicar retenção." },
      { status: 500 }
    );
  }
}
