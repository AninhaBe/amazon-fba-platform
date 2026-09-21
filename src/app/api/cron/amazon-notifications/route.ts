import { NextRequest, NextResponse } from "next/server";
import { portaoDoCron } from "@/lib/portaoDoCronHttp";
import { runComoFundo } from "@/lib/execucaoDeFundo";
import { consumirNotificacoesAmazon } from "@/lib/integrations/amazonNotificacoes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Uma invocação faz long poll CONTÍNUO por ~45s (ADR-023: latência de verdade
// exige poll contínuo, não uma leitura por ciclo). O agendador redispara logo em
// seguida, então a fila fica sob escuta quase o tempo todo.
export const maxDuration = 60;

const JANELA_MS = 45_000;

export async function GET(req: NextRequest) {
  const recusa = portaoDoCron(req);
  if (recusa) return recusa;

  return runComoFundo(async () => {
    const inicio = Date.now();
    let recebidas = 0, gravadas = 0, ignoradas = 0, ciclos = 0;
    // Cada `consumir` espera até 20s por mensagens (long poll). Repetimos até
    // fechar a janela — assim a mensagem que chega no segundo 5 é tratada no
    // segundo 5, não no próximo disparo do agendador.
    while (Date.now() - inicio < JANELA_MS) {
      const r = await consumirNotificacoesAmazon();
      ciclos += 1;
      if (!r.executou) {
        // Sem infra AWS (ou sem banco): não adianta girar quente por 45s.
        return NextResponse.json({ ok: true, executou: false, motivo: r.motivo, ciclos });
      }
      recebidas += r.recebidas;
      gravadas += r.gravadas;
      ignoradas += r.ignoradas;
    }
    return NextResponse.json({
      ok: true, executou: true, ciclos, recebidas, gravadas, ignoradas,
      durationMs: Date.now() - inicio,
    });
  });
}
