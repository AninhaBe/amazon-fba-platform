import test from "node:test";
import assert from "node:assert/strict";
import {
  parseTiktokConnectionId,
  resolveTiktokShop,
  runTiktokCandidates,
  tiktokConnectionId,
} from "../src/lib/integrations/tiktokContract.ts";
import { parseTiktokTaxRate, parseTiktokTaxRateSetting } from "../src/lib/integrations/tiktokContract.ts";
import { updateTiktokShopTaxRate } from "../src/lib/integrations/tiktokSettings.ts";
import { tiktokCostId } from "../src/lib/integrations/tiktokContract.ts";
import { tiktokRefreshGrantKey } from "../src/lib/integrations/tiktokRefreshControl.ts";
import { persistTiktokAuthorizationAtomically } from "../src/lib/integrations/tiktokRefreshControl.ts";

const shop = (shopId) => ({ shopId, accessToken: "a", refreshToken: "r", connectedAt: "2026-01-01T00:00:00Z" });

test("tax rate TikTok aceita somente numero finito entre 0 e 100", () => {
  assert.equal(parseTiktokTaxRate(0), 0);
  assert.equal(parseTiktokTaxRate(6.5), 6.5);
  assert.equal(parseTiktokTaxRate(100), 100);
  for (const invalid of [undefined, null, "6", -1, 101, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(parseTiktokTaxRate(invalid), null);
  }
});

test("settings TikTok diferencia zero, limpeza explicita e entrada invalida", () => {
  assert.deepEqual(parseTiktokTaxRateSetting({ taxRate: 6.5 }), { valid: true, value: 6.5 });
  assert.deepEqual(parseTiktokTaxRateSetting({ taxRate: 0 }), { valid: true, value: 0 });
  assert.deepEqual(parseTiktokTaxRateSetting({ taxRate: null }), { valid: true, value: null });
  for (const invalid of [{}, { taxRate: "" }, { taxRate: "6" }, { taxRate: -1 }, { taxRate: 101 }]) {
    assert.deepEqual(parseTiktokTaxRateSetting(invalid), { valid: false });
  }
});

test("persistencia da aliquota isola workspace e loja inclusive ao limpar", async () => {
  const rows = new Map([["tenant-a:shop-1", 8], ["tenant-b:shop-1", 12]]);
  const query = async (_sql, params) => {
    const [workspaceId, shopId, taxRate] = params;
    const key = `${workspaceId}:${shopId}`;
    if (!rows.has(key)) return [];
    rows.set(key, taxRate);
    return [{ ok: 1 }];
  };
  assert.equal(await updateTiktokShopTaxRate(query, "tenant-a", "shop-1", 0), true);
  assert.equal(rows.get("tenant-a:shop-1"), 0);
  assert.equal(rows.get("tenant-b:shop-1"), 12);
  assert.equal(await updateTiktokShopTaxRate(query, "tenant-a", "shop-1", null), true);
  assert.equal(rows.get("tenant-a:shop-1"), null);
  assert.equal(rows.get("tenant-b:shop-1"), 12);
  assert.equal(await updateTiktokShopTaxRate(query, "tenant-a", "shop-other", 5), false);
});

test("custo TikTok usa namespace da loja e prefere SKU", () => {
  assert.equal(tiktokCostId("tiktok_shop:loja-a", "produto-1", "SKU-1"),
    "tiktok:tiktok_shop:loja-a:sku:SKU-1");
  assert.equal(tiktokCostId("tiktok_shop:loja-b", "produto-1", null),
    "tiktok:tiktok_shop:loja-b:item:produto-1");
});

test("connection_id canônico e valida provider/formato", () => {
  assert.equal(tiktokConnectionId("42"), "tiktok_shop:42");
  assert.deepEqual(parseTiktokConnectionId("tiktok_shop:42"), { shopId: "42" });
  for (const invalid of ["42", "shopee:42", "tiktok_shop:", "tiktok_shop:a:b"]) {
    assert.equal(parseTiktokConnectionId(invalid), null);
  }
});

test("resolve 0/1/2 lojas, explícito e compatibilidade de uma loja", () => {
  assert.equal(resolveTiktokShop([]), undefined);
  assert.equal(resolveTiktokShop([shop("a")])?.shopId, "a");
  assert.equal(resolveTiktokShop([shop("a"), shop("b")]), undefined);
  assert.equal(resolveTiktokShop([shop("a"), shop("b")], "tiktok_shop:b")?.shopId, "b");
  assert.equal(resolveTiktokShop([shop("a")], "tiktok_shop:b"), undefined);
});

test("scheduler isola falha de A e continua B", async () => {
  const visited = [];
  const result = await runTiktokCandidates(["A", "B"], async (id) => {
    visited.push(id);
    if (id === "A") throw new Error("lease A");
    return `ok:${id}`;
  });
  assert.deepEqual(visited.sort(), ["A", "B"]);
  assert.deepEqual(result, [{ failed: true, reason: "lease A" }, "ok:B"]);
});

test("refresh agrupa mesmo grant e separa autorizações distintas", () => {
  assert.equal(tiktokRefreshGrantKey("ws", "grant-1"), tiktokRefreshGrantKey("ws", "grant-1"));
  assert.notEqual(tiktokRefreshGrantKey("ws", "grant-1"), tiktokRefreshGrantKey("ws", "grant-2"));
  assert.notEqual(tiktokRefreshGrantKey("ws", "grant-1"), tiktokRefreshGrantKey("outro", "grant-1"));
});

test("callback multiloja faz rollback all-or-nothing", async () => {
  const committed = [];
  const transaction = async (body) => {
    const staged = [];
    await body(staged);
    committed.push(...staged);
  };
  await assert.rejects(
    persistTiktokAuthorizationAtomically(["A", "B"], transaction, async (staged, id) => {
      staged.push(id);
      if (id === "B") throw new Error("checkpoint falhou");
    }),
    /checkpoint falhou/
  );
  assert.deepEqual(committed, []);
});
