import { detectors } from "./registry";
import { reconcile } from "./store";
import type { InsightCandidate } from "./types";

// Roda todos os detectores registrados e reconcilia o resultado com o que já está
// gravado. No protótipo é chamado pelo GET /api/briefing; no estágio 3 migra pro cron.
export async function runDetection(): Promise<void> {
  const ranTypes = detectors.map((d) => d.type);
  const candidates: InsightCandidate[] = [];
  for (const detector of detectors) {
    try {
      candidates.push(...(await detector.run()));
    } catch {
      // Um detector falhar não derruba os outros nem a reconciliação.
    }
  }
  await reconcile(candidates, ranTypes);
}
