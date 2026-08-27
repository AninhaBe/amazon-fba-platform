import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { nextAmazonOrderWindow } from "../src/lib/integrations/amazonSyncControl.ts";

const DAY = 86_400_000;
const now = 1_700_000_000_000;

// Frente K (27/08/2026): conectar a conta dispara o sync na hora, com a janela
// recente primeiro. Mesmos guardas dos outros três canais (*SyncImediato).

test("janela de pedidos avança para trás até o alvo imediato", () => {
  const move = nextAmazonOrderWindow({
    windowFromMs: now - 7 * DAY,
    targetFromMs: now - 30 * DAY,
    coveredFromMs: null,
    historyFloorMs: now - 366 * DAY,
    windowMs: 7 * DAY,
    toleranceMs: DAY,
  });
  assert.deepEqual(move, { kind: "advance", nextToMs: now - 7 * DAY, nextFromMs: now - 14 * DAY });
});

test("alvo imediato coberto estende o alvo até o histórico completo (fase 2)", () => {
  const move = nextAmazonOrderWindow({
    windowFromMs: now - 30 * DAY,
    targetFromMs: now - 30 * DAY,
    coveredFromMs: now - 23 * DAY,
    historyFloorMs: now - 366 * DAY,
    windowMs: 7 * DAY,
    toleranceMs: DAY,
  });
  assert.deepEqual(move, {
    kind: "extend",
    targetFromMs: now - 366 * DAY,
    coveredFromMs: now - 30 * DAY,
    nextToMs: now - 30 * DAY,
    nextFromMs: now - 37 * DAY,
  });
});

test("reabertura com histórico já coberto fecha em complete — não redispara o backfill", () => {
  // O requestAmazonSync estreita o alvo ao reabrir (target_from = covered_to),
  // então o alvo recente é rotina; só o covered_from antigo impede a extensão
  // de redisparar o backfill inteiro a cada reabertura.
  const move = nextAmazonOrderWindow({
    windowFromMs: now - 2 * 60_000,
    targetFromMs: now - 2 * 60_000,
    coveredFromMs: now - 366 * DAY,
    historyFloorMs: now - 366 * DAY,
    windowMs: 7 * DAY,
    toleranceMs: DAY,
  });
  assert.deepEqual(move, { kind: "complete" });
});

test("callback da Amazon cria a linha de estado e dispara o sync fora do redirect", async () => {
  const callback = await readFile(new URL("../src/app/api/auth/callback/route.ts", import.meta.url), "utf8");
  const saveIdx = callback.indexOf("await saveAccount(");
  const ensureIdx = callback.indexOf("ensureAmazonSyncState(amazonConnectionId(sellerId))");
  const kickIdx = callback.indexOf("after(() => runWithWorkspace(");
  const redirectIdx = callback.indexOf("NextResponse.redirect(`${baseUrl}/?connected=1`)");
  assert.ok(saveIdx > -1 && ensureIdx > -1 && kickIdx > -1 && redirectIdx > -1);
  assert.ok(saveIdx < ensureIdx && ensureIdx < kickIdx && kickIdx < redirectIdx,
    "linha de estado nasce depois do save, kick depois dela, e nada segura o redirect");
  assert.match(callback, /runAmazonSyncBatch\(account, KICK_MAX_STEPS\)/);
});

test("scheduler prioriza conta que nunca fechou uma janela e mantém o LEFT JOIN do filtro demo", async () => {
  const scheduler = await readFile(new URL("../src/lib/integrations/amazonScheduler.ts", import.meta.url), "utf8");
  assert.match(scheduler, /WHEN sync\.covered_from IS NULL THEN 0/);
  // Conexão Amazon real não tem linha em workspace_integrations: um JOIN
  // interno pararia o sync das contas vivas em silêncio (medido em 27/08/2026).
  assert.match(scheduler, /LEFT JOIN workspace_integrations/);
});

test("seed nasce com o alvo imediato de 30 dias e o alvo total é configurável", async () => {
  const sync = await readFile(new URL("../src/lib/integrations/amazonSync.ts", import.meta.url), "utf8");
  assert.match(sync, /const RECENT_DAYS = 30/);
  assert.match(sync, /Math\.min\(RECENT_DAYS, HISTORY_DAYS\) \* DAY/);
  assert.match(sync, /AMAZON_HISTORY_DAYS/);
});
