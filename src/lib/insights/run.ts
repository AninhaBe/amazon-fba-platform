import { detectors } from "./registry";
import { reconcile } from "./store";
import type { InsightCandidate } from "./types";

// Roda todos os detectores registrados e reconcilia o resultado com o que já está
// gravado. No protótipo é chamado pelo GET /api/briefing; no estágio 3 migra pro cron.
export async function runDetection(): Promise<void> {
  const candidates: InsightCandidate[] = [];
  // Auto-resolve só para quem RODOU ATÉ O FIM, e por (tipo, canal) — não por
  // tipo solto. Dois defeitos que a chave antiga (só o tipo, computado antes de
  // rodar) permitia: detector que LANÇAVA ainda auto-resolvia os insights do
  // próprio tipo como se tivessem sarado; e, com canais compartilhando tipos
  // (ruptura da Amazon E do ML), a falha do detector de um canal resolveria os
  // insights abertos do outro.
  const ranKeys = new Set<string>();
  for (const detector of detectors) {
    try {
      candidates.push(...(await detector.run()));
      ranKeys.add(`${detector.type}:${detector.provider}`);
    } catch {
      // Um detector falhar não derruba os outros nem a reconciliação.
    }
  }
  await reconcile(candidates, ranKeys);
}
