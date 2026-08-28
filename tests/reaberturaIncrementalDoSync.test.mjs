import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Correção da regressão da UTILEIRA (28/08/2026): a reabertura por frescor
// re-caminhava a história INTEIRA (target_from ficava no seed histórico), o que
// mantinha a loja em 'pending' por horas, inflava processed_orders a cada
// passada e fazia a tela de primeira sincronização engolir um dashboard cheio.

const NARROW = /const targetFrom = new Date\(Math\.max\(new Date\(row\.target_from\)\.getTime\(\), coveredTo\.getTime\(\) - DAY\)\)/;

test("a reabertura da Shopee estreita o alvo ao incremento — nunca re-caminha a história", async () => {
  const fonte = await readFile(new URL("../src/lib/integrations/shopeeSync.ts", import.meta.url), "utf8");
  assert.match(fonte, NARROW, "target_from da reabertura = coberto até - 1 dia (sobreposição), nunca o seed");
  assert.match(fonte, /SET status = 'pending', target_from = \$6, target_to = \$4/, "o UPDATE da reabertura grava o alvo estreitado");
  // O cursor nunca nasce antes do alvo estreitado.
  assert.match(fonte, /const cursorFrom = new Date\(Math\.max\(targetFrom\.getTime\(\), now\.getTime\(\) - WINDOW_DAYS \* DAY\)\)/);
});

test("a reabertura do TikTok estreita o alvo igual — e o reprocesso deliberado continua largo", async () => {
  const fonte = await readFile(new URL("../src/lib/integrations/tiktokSync.ts", import.meta.url), "utf8");
  assert.match(fonte, NARROW);
  assert.match(fonte, /SET status = 'pending', target_from = \$6, target_to = \$4/);
  // requestTiktokFullReprocess re-caminha tudo DE PROPÓSITO (reaplicar
  // normalizador): segue zerando a cobertura, sem estreitamento.
  assert.match(fonte, /requestTiktokFullReprocess/);
  assert.match(fonte, /covered_from=NULL, covered_to=NULL/);
});

test("o ML segue sendo o espelho: reabertura já incremental", async () => {
  const fonte = await readFile(new URL("../src/lib/integrations/mercadoLivreSync.ts", import.meta.url), "utf8");
  assert.match(fonte, /SET status = 'pending', target_from = \$5, target_to = \$4/);
});

test("tela cheia de sincronização SÓ sem dado nenhum — com overview, o dashboard sempre renderiza", async () => {
  const fonte = await readFile(new URL("../src/app/components/ShopeeWorkspace.tsx", import.meta.url), "utf8");
  assert.match(fonte, /if \(sync && sync\.phase !== "ready" && \(pending \|\| !overview\)\) \{/,
    "o takeover exige (pending || !overview)");
  // A condição antiga deixava a fase 'idle' (pending entre passos do cron)
  // engolir o dashboard de uma loja cheia. Não pode voltar.
  assert.doesNotMatch(fonte, /pending \|\| !overview \|\| sync\.phase !== "syncing"/);
});
