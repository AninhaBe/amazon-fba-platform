import test from "node:test";
import assert from "node:assert/strict";
import { assertGlobalTiktokShopOwnership, TIKTOK_OWNERSHIP_ERROR } from "../src/lib/integrations/tiktokOwnership.ts";

test("ownership global falha fechado com erro generico em conflito cross-workspace", async () => {
  const calls = [];
  const query = async (sql, params) => { calls.push({ sql, params }); return sql.includes("HAVING") ? [{ shop_id: "segredo" }] : []; };
  await assert.rejects(() => assertGlobalTiktokShopOwnership(query, "ws-a", ["shop-1"], true),
    (error) => error.message === TIKTOK_OWNERSHIP_ERROR && !error.message.includes("ws-") && !error.message.includes("shop-1"));
  assert.match(calls[0].sql, /pg_advisory_xact_lock/);
});

test("ownership aceita loja exclusiva e deduplica ids antes do lock", async () => {
  const calls = [];
  await assertGlobalTiktokShopOwnership(async (sql, params) => { calls.push({ sql, params }); return []; }, "ws", ["b", "a", "b"], true);
  assert.equal(calls.filter((call) => call.sql.includes("pg_advisory")).length, 2);
});
