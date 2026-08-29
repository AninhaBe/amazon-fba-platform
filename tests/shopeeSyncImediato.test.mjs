import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Frente K (27/08/2026): conectar a loja dispara o sync na hora, com a janela
// recente primeiro. Estes guardas prendem o desenho no código-fonte — se o kick
// sair do callback ou a prioridade sumir do scheduler, o teste conta o porquê.

test("callback da Shopee dispara o sync na hora, fora do caminho do redirect", async () => {
  const callback = await readFile(new URL("../src/app/api/integrations/shopee/callback/route.ts", import.meta.url), "utf8");
  const ensureIdx = callback.indexOf("ensureShopeeSyncState(saved.id)");
  const kickIdx = callback.indexOf("depoisDaResposta(");
  const redirectIdx = callback.indexOf("NextResponse.redirect(`${uiBaseUrl}/integracoes?connected=shopee`)");
  assert.ok(ensureIdx > -1, "o callback precisa criar o estado de sync");
  assert.ok(kickIdx > -1, "o callback precisa disparar o sync imediato");
  assert.ok(redirectIdx > -1, "o callback precisa redirecionar o usuário");
  assert.ok(ensureIdx < kickIdx && kickIdx < redirectIdx, "kick nasce depois do estado e não segura o redirect");
  assert.match(callback, /runShopeeSyncBatch\(saved, KICK_BUDGET_MS\)/);
});

test("scheduler prioriza loja que nunca fechou uma janela (primeira sincronização)", async () => {
  const scheduler = await readFile(new URL("../src/lib/integrations/shopeeScheduler.ts", import.meta.url), "utf8");
  assert.match(scheduler, /WHEN sync\.covered_from IS NULL THEN 0/);
});

test("primeiro sync ingere pedidos antes do sweep de catálogo, sem interromper sweep retomável", async () => {
  const sync = await readFile(new URL("../src/lib/integrations/shopeeSync.ts", import.meta.url), "utf8");
  assert.match(sync, /primeiraJanelaPendente = !row\.covered_from && !row\.cursor_token/);
  assert.match(sync, /if \(productsDue && !primeiraJanelaPendente\)/);
});

test("seed de conta nova é o mês vigente e conta antiga não é reaberta pela regra", async () => {
  const sync = await readFile(new URL("../src/lib/integrations/shopeeSync.ts", import.meta.url), "utf8");
  assert.match(sync, /inicioDoMesVigente\(now\)/);
  // Conexão existente segue com o alvo já gravado: o seed só insere quando a
  // linha não existe.
  assert.match(sync, /ON CONFLICT \(workspace_id, provider, connection_id\) DO NOTHING/);
  assert.doesNotMatch(sync, /SHOPEE_HISTORY_DAYS/, "o knob de fase 2 foi descartado (decisão da Ana, 27/08/2026)");
});
