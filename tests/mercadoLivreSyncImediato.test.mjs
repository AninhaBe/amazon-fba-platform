import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Frente K (27/08/2026): conectar a conta dispara o sync na hora, com a janela
// recente primeiro. Mesmos guardas de fonte da Shopee (shopeeSyncImediato).

test("callback do Mercado Livre dispara o sync na hora, fora do caminho do redirect", async () => {
  const callback = await readFile(new URL("../src/app/api/integrations/mercado-livre/callback/route.ts", import.meta.url), "utf8");
  const ensureIdx = callback.indexOf("ensureMercadoLivreSyncState(connection.id)");
  const kickIdx = callback.indexOf("after(() => runWithWorkspace(");
  const redirectIdx = callback.indexOf("NextResponse.redirect(`${uiBaseUrl}/integracoes?connected=mercado_livre`)");
  assert.ok(ensureIdx > -1, "o callback precisa criar o estado de sync");
  assert.ok(kickIdx > -1, "o callback precisa disparar o sync imediato");
  assert.ok(redirectIdx > -1, "o callback precisa redirecionar o usuário");
  assert.ok(ensureIdx < kickIdx && kickIdx < redirectIdx, "kick nasce depois do estado e não segura o redirect");
  assert.match(callback, /runMercadoLivreSyncBatch\(connection, KICK_MAX_STEPS\)/);
});

test("scheduler prioriza conta que nunca fechou uma janela (primeira sincronização)", async () => {
  const scheduler = await readFile(new URL("../src/lib/integrations/mercadoLivreScheduler.ts", import.meta.url), "utf8");
  assert.match(scheduler, /WHEN sync\.covered_from IS NULL THEN 0/);
});

test("seed nasce com o alvo imediato de 30 dias e o alvo total é configurável", async () => {
  const sync = await readFile(new URL("../src/lib/integrations/mercadoLivreSync.ts", import.meta.url), "utf8");
  assert.match(sync, /const RECENT_DAYS = 30/);
  assert.match(sync, /Math\.min\(RECENT_DAYS, HISTORY_DAYS\) \* DAY/);
  assert.match(sync, /MERCADO_LIVRE_HISTORY_DAYS/);
});

test("checkpoints do sync são cercados pelo token do lease (fencing)", async () => {
  const sync = await readFile(new URL("../src/lib/integrations/mercadoLivreSync.ts", import.meta.url), "utf8");
  assert.match(sync, /lease_until::text AS ownership_token/);
  assert.match(sync, /MercadoLivreLeaseLostError/);
  // Todo UPDATE de checkpoint dentro do passo carrega a cláusula do token.
  const stepBody = sync.slice(sync.indexOf("export async function runMercadoLivreSyncStep"));
  const guardas = stepBody.match(/AND lease_until::text = \$\d+/g) ?? [];
  assert.ok(guardas.length >= 5, `esperava >=5 cláusulas de fencing no passo, achei ${guardas.length}`);
});
