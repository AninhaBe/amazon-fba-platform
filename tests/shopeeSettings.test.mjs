import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  getShopeeTaxRateSetting,
  parseShopeeTaxRateSetting,
  setShopeeTaxRateSetting,
  shopeeTaxRateSettingKey,
} from "../src/lib/integrations/shopeeSettings.ts";
import {
  parseShopeeTaxRateDraft,
  shopeeSettingsPath,
} from "../src/app/components/ShopeeSettingsModel.ts";

function memorySettingsQuery() {
  const rows = new Map();
  const calls = [];
  const query = async (sql, params = []) => {
    calls.push({ sql, params });
    const key = `${params[0]}\0${params[1]}`;
    if (sql.includes("SELECT value")) return rows.has(key) ? [{ value: rows.get(key) }] : [];
    if (sql.includes("INSERT INTO workspace_settings")) {
      rows.set(key, JSON.parse(params[2]));
      return [];
    }
    if (sql.includes("DELETE FROM workspace_settings")) {
      rows.delete(key);
      return [];
    }
    throw new Error("SQL inesperado no fake");
  };
  return { query, rows, calls };
}

test("contrato aceita zero e clear, mas rejeita coercao e faixas invalidas", () => {
  assert.deepEqual(parseShopeeTaxRateSetting({ taxRate: 0 }), { valid: true, value: 0 });
  assert.deepEqual(parseShopeeTaxRateSetting({ taxRate: 100 }), { valid: true, value: 100 });
  assert.deepEqual(parseShopeeTaxRateSetting({ taxRate: null }), { valid: true, value: null });
  for (const body of [{}, { taxRate: "0" }, { taxRate: "" }, { taxRate: -1 }, { taxRate: 101 }, { taxRate: Number.NaN }]) {
    assert.deepEqual(parseShopeeTaxRateSetting(body), { valid: false });
  }
});

test("persistencia isola workspace e connection e clear remove somente o alvo", async () => {
  const { query, rows } = memorySettingsQuery();
  await setShopeeTaxRateSetting(query, "workspace-a", "shopee:1", 0);
  await setShopeeTaxRateSetting(query, "workspace-a", "shopee:2", 8.5);
  await setShopeeTaxRateSetting(query, "workspace-b", "shopee:1", 12);

  assert.equal(await getShopeeTaxRateSetting(query, "workspace-a", "shopee:1"), 0);
  assert.equal(await getShopeeTaxRateSetting(query, "workspace-a", "shopee:2"), 8.5);
  assert.equal(await getShopeeTaxRateSetting(query, "workspace-b", "shopee:1"), 12);

  await setShopeeTaxRateSetting(query, "workspace-a", "shopee:1", null);
  assert.equal(await getShopeeTaxRateSetting(query, "workspace-a", "shopee:1"), null);
  assert.equal(await getShopeeTaxRateSetting(query, "workspace-b", "shopee:1"), 12);
  assert.equal(rows.size, 2);
});

test("valor persistido invalido falha fechado como desconhecido", async () => {
  const { query, rows } = memorySettingsQuery();
  rows.set(`workspace\0${shopeeTaxRateSettingKey("shopee:1")}`, { taxRate: "7" });
  assert.equal(await getShopeeTaxRateSetting(query, "workspace", "shopee:1"), null);
  rows.set(`workspace\0${shopeeTaxRateSettingKey("shopee:1")}`, { taxRate: 101 });
  assert.equal(await getShopeeTaxRateSetting(query, "workspace", "shopee:1"), null);
});

test("modelo da UI preserva decimal, zero, clear e connection_id exato", () => {
  assert.deepEqual(parseShopeeTaxRateDraft("0"), { valid: true, value: 0 });
  assert.deepEqual(parseShopeeTaxRateDraft(" 6,5 "), { valid: true, value: 6.5 });
  assert.deepEqual(parseShopeeTaxRateDraft(""), { valid: true, value: null });
  for (const value of ["-1", "101", "0x10", "1,2,3", "Infinity"]) {
    assert.deepEqual(parseShopeeTaxRateDraft(value), { valid: false });
  }
  const url = new URL(shopeeSettingsPath("shopee:loja"), "http://local");
  assert.equal(url.searchParams.get("connection_id"), "shopee:loja");
  assert.equal(url.searchParams.has("connectionId"), false);
});

test("rota, overview e UI usam auth, selecao exata e setting persistido", async () => {
  const [route, overview, component] = await Promise.all([
    readFile(new URL("../src/app/api/integrations/shopee/settings/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/integrations/shopeeOverviewCanonical.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/components/ShopeeModulePage.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(route, /withAuthenticatedWorkspace/);
  assert.match(route, /params\.get\("connection_id"\)/);
  assert.match(route, /requireShopeeConnection\(exactParams\(request\)\)/);
  assert.doesNotMatch(route, /params\.get\("connectionId"\)/);
  assert.match(overview, /getShopeeTaxRateSetting\(query, workspaceId, connection\.id\)/);
  assert.doesNotMatch(overview, /configuredTaxRate\s*=\s*shopeeTaxRate\(connection\)/);
  assert.match(component, /kind==="costs"&&<ShopeeTaxRateEditor key=\{connectionId\} connectionId=\{connectionId\}/);
  assert.match(component, /fetch\(shopeeSettingsPath\(connectionId\)/);
  assert.match(component, /method:"POST"/);
});
