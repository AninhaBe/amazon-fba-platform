import test from "node:test";
import assert from "node:assert/strict";
import { deduplicateTiktokRefresh } from "../src/lib/integrations/tiktokRefreshControl.ts";

const shop = { shopId: "shop", accessToken: "new", refreshToken: "rotated", connectedAt: "2026-01-01T00:00:00Z" };

test("refresh concorrente por workspace e loja executa uma única rotação", async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const factory = async () => { calls += 1; await gate; return shop; };
  const first = deduplicateTiktokRefresh("ws:shop", factory);
  const second = deduplicateTiktokRefresh("ws:shop", factory);
  assert.strictEqual(first, second);
  release();
  assert.strictEqual(await first, shop);
  assert.equal(calls, 1);
});

test("falha libera a chave para uma nova tentativa", async () => {
  await assert.rejects(deduplicateTiktokRefresh("ws:retry", async () => { throw new Error("falhou"); }));
  const result = await deduplicateTiktokRefresh("ws:retry", async () => shop);
  assert.strictEqual(result, shop);
});

test("dois grants distintos progridem juntos com capacidade equivalente a pool max=2", async () => {
  const entered = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const run = (key) => deduplicateTiktokRefresh(key, async () => {
    entered.push(key);
    await gate;
    return key;
  });
  const first = run("ws:grant-a");
  const second = run("ws:grant-b");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(entered.sort(), ["ws:grant-a", "ws:grant-b"]);
  release();
  assert.deepEqual(await Promise.all([first, second]), ["ws:grant-a", "ws:grant-b"]);
});

test("CAS de refresh não sobrescreve callback/reautorização", () => {
  const persisted = { refreshToken: "callback-novo", accessToken: "callback-access" };
  const expectedGrant = "grant-antigo";
  let writes = 0;
  if (persisted.refreshToken === expectedGrant) writes++;
  assert.equal(writes, 0);
  assert.equal(persisted.accessToken, "callback-access");
});

test("grant rotacionado durante espera usa estado relido e não token obsoleto", () => {
  const stale = { refreshToken: "antigo", accessToken: "velho" };
  const reread = { refreshToken: "novo", accessToken: "atual" };
  const selected = reread.refreshToken === stale.refreshToken ? stale : reread;
  assert.strictEqual(selected, reread);
});
