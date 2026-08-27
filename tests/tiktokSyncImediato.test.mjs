import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  nextTiktokOrderWindow,
  tiktokHistoryDays,
  tiktokSeedSyncWindow,
} from "../src/lib/integrations/tiktokSyncControl.ts";

const DAY = 86_400_000;
const now = 1_700_000_000_000;

// Frente K (27/08/2026): conectar a loja dispara o sync na hora, com a janela
// recente primeiro. Mesmos guardas da Shopee e do ML (shopeeSyncImediato,
// mercadoLivreSyncImediato).

test("semente única: alvo imediato de 30 dias e cursor na janela de 15 dias", () => {
  const seed = tiktokSeedSyncWindow(now);
  assert.equal(seed.targetFromMs, now - 30 * DAY);
  assert.equal(seed.cursorFromMs, now - 15 * DAY);
});

test("alvo total é configurável, com piso no alvo imediato e default de 60 dias", () => {
  assert.equal(tiktokHistoryDays(undefined), 60);
  assert.equal(tiktokHistoryDays("366"), 366);
  assert.equal(tiktokHistoryDays("15"), 60, "abaixo do alvo imediato cai no default");
  assert.equal(tiktokHistoryDays("abc"), 60);
});

test("janela de pedidos avança para trás até o alvo imediato", () => {
  const move = nextTiktokOrderWindow({
    windowFromMs: now - 15 * DAY,
    targetFromMs: now - 30 * DAY,
    coveredFromMs: null,
    historyFloorMs: now - 60 * DAY,
    windowMs: 15 * DAY,
    toleranceMs: DAY,
  });
  assert.deepEqual(move, { kind: "advance", nextToMs: now - 15 * DAY, nextFromMs: now - 30 * DAY });
});

test("alvo imediato coberto estende o alvo até o histórico completo (fase 2)", () => {
  const move = nextTiktokOrderWindow({
    windowFromMs: now - 30 * DAY,
    targetFromMs: now - 30 * DAY,
    coveredFromMs: now - 15 * DAY,
    historyFloorMs: now - 60 * DAY,
    windowMs: 15 * DAY,
    toleranceMs: DAY,
  });
  assert.deepEqual(move, {
    kind: "extend",
    targetFromMs: now - 60 * DAY,
    nextToMs: now - 30 * DAY,
    nextFromMs: now - 45 * DAY,
  });
});

test("loja com histórico completo fecha em complete — reabertura incremental não redispara o backfill", () => {
  const move = nextTiktokOrderWindow({
    windowFromMs: now - 61 * DAY,
    targetFromMs: now - 61 * DAY,
    coveredFromMs: now - 61 * DAY,
    historyFloorMs: now - 60 * DAY,
    windowMs: 15 * DAY,
    toleranceMs: DAY,
  });
  assert.deepEqual(move, { kind: "complete" });
});

test("subir o alvo configurado aprofunda a partir do ponto mais antigo coberto", () => {
  const move = nextTiktokOrderWindow({
    windowFromMs: now - 2 * 60_000,
    targetFromMs: now - 2 * 60_000,
    coveredFromMs: now - 60 * DAY,
    historyFloorMs: now - 366 * DAY,
    windowMs: 15 * DAY,
    toleranceMs: DAY,
  });
  assert.deepEqual(move, {
    kind: "extend",
    targetFromMs: now - 366 * DAY,
    nextToMs: now - 60 * DAY,
    nextFromMs: now - 75 * DAY,
  });
});

test("callback do TikTok dispara o sync na hora, fora do caminho do redirect", async () => {
  const callback = await readFile(new URL("../src/app/api/tiktok/callback/route.ts", import.meta.url), "utf8");
  const saveIdx = callback.indexOf("await saveTiktokAuthorization(");
  const kickIdx = callback.indexOf("after(() => runWithWorkspace(");
  const redirectIdx = callback.indexOf("integracoes?connected=tiktok_shop");
  assert.ok(saveIdx > -1 && kickIdx > -1 && redirectIdx > -1);
  assert.ok(saveIdx < kickIdx && kickIdx < redirectIdx, "kick nasce depois do save e não segura o redirect");
  assert.match(callback, /runTiktokSyncBatch\(tiktokConnectionId\(shopId\), KICK_BUDGET_MS\)/);
});

test("scheduler prioriza loja que nunca fechou uma janela (primeira sincronização)", async () => {
  const scheduler = await readFile(new URL("../src/lib/integrations/tiktokScheduler.ts", import.meta.url), "utf8");
  assert.match(scheduler, /sync\.connection_id IS NULL OR sync\.covered_from IS NULL THEN 0/);
});

test("a semente do sync vem de um lugar só — sem literais de 60d/15d duplicados", async () => {
  const [store, sync] = await Promise.all([
    readFile(new URL("../src/lib/tiktokStore.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/integrations/tiktokSync.ts", import.meta.url), "utf8"),
  ]);
  assert.match(store, /tiktokSeedSyncWindow\(/);
  assert.match(sync, /tiktokSeedSyncWindow\(/);
  assert.doesNotMatch(store, /60 \* 86_400_000/, "o alvo do seed não pode voltar a ser literal no store");
});
