import test from "node:test";
import assert from "node:assert/strict";
import { shopeeAbcClass, shopeePageRequest, shopeePeriodRequest, ShopeeModuleError } from "../src/lib/integrations/shopeeModuleContract.ts";

test("Shopee module contract validates bounded pagination", () => {
  assert.deepEqual(shopeePageRequest(new URLSearchParams("limit=100&offset=2")), { limit: 100, offset: 2 });
  assert.throws(() => shopeePageRequest(new URLSearchParams("limit=101")), (error) => error instanceof ShopeeModuleError && error.code === "INVALID_PAGE");
});

test("Shopee period uses Sao Paulo calendar boundary", () => {
  const period = shopeePeriodRequest(new URLSearchParams("days=today"), new Date("2026-08-11T02:00:00Z"));
  assert.equal(period.from.toISOString(), "2026-08-10T03:00:00.000Z");
  assert.throws(() => shopeePeriodRequest(new URLSearchParams("days=90")), /Selecione Hoje/);
});

test("Shopee ABC thresholds follow established 80/15/5 semantics", () => {
  assert.equal(shopeeAbcClass(0.8), "A"); assert.equal(shopeeAbcClass(0.81), "B"); assert.equal(shopeeAbcClass(0.96), "C");
});
