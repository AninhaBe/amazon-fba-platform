import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  nextTiktokOrderWindow,
  tiktokSeedSyncWindow,
} from "../src/lib/integrations/tiktokSyncControl.ts";
import { inicioDoMesVigente } from "../src/lib/integrations/inicioDoMes.ts";

const DAY = 86_400_000;

// Frente K (27/08/2026): conectar a loja dispara o sync na hora. O alvo de
// conta nova é o MÊS VIGENTE (decisão da Ana, 27/08/2026) — sem aprofundamento
// retroativo em background.

test("semente única: alvo no início do mês vigente e cursor na janela de 15 dias", () => {
  const meio = new Date("2026-09-17T12:00:00-03:00").getTime();
  const seed = tiktokSeedSyncWindow(meio);
  assert.equal(seed.targetFromMs, new Date("2026-09-01T00:00:00-03:00").getTime());
  assert.equal(seed.cursorFromMs, meio - 15 * DAY);
});

test("conta conectada no dia 1º do mês nasce com janela mínima válida", () => {
  const inicio = new Date("2026-09-01T00:01:00-03:00").getTime();
  const seed = tiktokSeedSyncWindow(inicio);
  assert.equal(seed.targetFromMs, new Date("2026-09-01T00:00:00-03:00").getTime());
  // O cursor não pode nascer antes do alvo nem depois do agora.
  assert.equal(seed.cursorFromMs, seed.targetFromMs);
  assert.ok(seed.cursorFromMs <= inicio);
  // E o fechamento imediato dessa janela mínima conclui, sem quebrar.
  assert.deepEqual(
    nextTiktokOrderWindow({ windowFromMs: seed.targetFromMs, targetFromMs: seed.targetFromMs, windowMs: 15 * DAY }),
    { kind: "complete" }
  );
});

test("janela de pedidos avança para trás até o alvo e conclui ao alcançá-lo", () => {
  const now = 1_700_000_000_000;
  const move = nextTiktokOrderWindow({
    windowFromMs: now - 15 * DAY,
    targetFromMs: now - 27 * DAY,
    windowMs: 15 * DAY,
  });
  assert.deepEqual(move, { kind: "advance", nextToMs: now - 15 * DAY, nextFromMs: now - 27 * DAY });
  assert.deepEqual(
    nextTiktokOrderWindow({ windowFromMs: now - 27 * DAY, targetFromMs: now - 27 * DAY, windowMs: 15 * DAY }),
    { kind: "complete" }
  );
});

test("início do mês vigente respeita o fuso de Brasília, inclusive na virada", () => {
  // 01/09 01:00 UTC ainda é 31/08 22:00 em Brasília — o mês vigente é agosto.
  assert.equal(
    inicioDoMesVigente(new Date("2026-09-01T01:00:00Z")).toISOString(),
    new Date("2026-08-01T00:00:00-03:00").toISOString()
  );
  assert.equal(
    inicioDoMesVigente(new Date("2026-09-01T03:00:00Z")).toISOString(),
    new Date("2026-09-01T00:00:00-03:00").toISOString()
  );
});

test("callback do TikTok dispara o sync na hora, fora do caminho do redirect", async () => {
  const callback = await readFile(new URL("../src/app/api/tiktok/callback/route.ts", import.meta.url), "utf8");
  const saveIdx = callback.indexOf("await saveTiktokAuthorization(");
  const kickIdx = callback.indexOf("depoisDaResposta(");
  const redirectIdx = callback.indexOf("integracoes?connected=tiktok_shop");
  assert.ok(saveIdx > -1 && kickIdx > -1 && redirectIdx > -1);
  assert.ok(saveIdx < kickIdx && kickIdx < redirectIdx, "kick nasce depois do save e não segura o redirect");
  assert.match(callback, /runTiktokSyncBatch\(tiktokConnectionId\(shopId\), KICK_BUDGET_MS\)/);
});

test("scheduler prioriza loja que nunca fechou uma janela (primeira sincronização)", async () => {
  const scheduler = await readFile(new URL("../src/lib/integrations/tiktokScheduler.ts", import.meta.url), "utf8");
  assert.match(scheduler, /sync\.connection_id IS NULL OR sync\.covered_from IS NULL THEN 0/);
});

test("a semente do sync vem de um lugar só — sem literais duplicados nem knob de fase 2", async () => {
  const [store, sync] = await Promise.all([
    readFile(new URL("../src/lib/tiktokStore.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/integrations/tiktokSync.ts", import.meta.url), "utf8"),
  ]);
  assert.match(store, /tiktokSeedSyncWindow\(/);
  assert.match(sync, /tiktokSeedSyncWindow\(/);
  assert.doesNotMatch(store, /60 \* 86_400_000/, "o alvo do seed não pode voltar a ser literal no store");
  assert.doesNotMatch(sync, /TIKTOK_HISTORY_DAYS/, "o knob de fase 2 foi descartado (decisão da Ana, 27/08/2026)");
});
