import { NextRequest, NextResponse } from "next/server";
import { portaoDoCron } from "@/lib/portaoDoCronHttp";
import { expurgarChamadasAntigas, expurgarEventosProcessados, RETENCAO_EVENTOS_DIAS } from "@/lib/retencao";
import { runComoFundo } from "@/lib/execucaoDeFundo";

// Expurgo de dados efêmeros — ver ADR-016.
// Roda no cron do GitHub Actions, junto dos syncs.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const recusa = portaoDoCron(req);
  if (recusa) return recusa;

  // `dias` permite ampliar a janela numa execução manual, nunca encurtá-la abaixo
  // do padrão: expurgo mais agressivo que a política do ADR-016 exige nova decisão.
  const pedido = Number(req.nextUrl.searchParams.get("dias"));
  const dias =
    Number.isFinite(pedido) && pedido >= RETENCAO_EVENTOS_DIAS
      ? pedido
      : RETENCAO_EVENTOS_DIAS;

  return runComoFundo(async () => {
  try {
    const resultado = await expurgarEventosProcessados(dias);
    // O contador de chamadas tem janela propria (90 dias): ele responde sobre
    // alerta de plataforma, nao sobre evento de webhook. Falha dele nao pode
    // derrubar o expurgo de eventos, que e o que segurava 172 MB.
    const chamadas = await expurgarChamadasAntigas().catch((erro) => {
      console.error("[retencao] expurgo do contador de chamadas falhou:", erro);
      return null;
    });
    if (chamadas) {
      console.log(
        `[retencao] ${chamadas.tabela}: ${chamadas.removidas} removidas, ${chamadas.restantes} restantes (janela de 90 dias)`
      );
    }
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
  });
}
