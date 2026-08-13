import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  isShopeeDemoConnection,
  publicShopeeDemoConnection,
} from "../src/lib/integrations/shopeeConnection.ts";

const connection = (metadata = {}, overrides = {}) => ({
  id: "shopee:123",
  provider: "shopee",
  externalAccountId: "123",
  displayName: "PII shop name",
  mode: "local",
  region: "BR",
  accessToken: "access-secret",
  refreshToken: "refresh-secret",
  accessExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  scopes: ["orders"],
  metadata,
  status: "connected",
  connectedAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  ...overrides,
});

test("classifica demo somente pelo booleano explícito metadata.demo=true", () => {
  assert.equal(isShopeeDemoConnection(connection({ demo: true })), true);
  for (const demo of ["true", 1, false, null, undefined]) {
    assert.equal(isShopeeDemoConnection(connection({ demo })), false);
  }
  assert.equal(isShopeeDemoConnection({ provider: "mercado_livre", metadata: { demo: true } }), false);
});

test("estado público demo é sintético e não expõe identidade, datas, escopos ou metadata privada", () => {
  const safe = publicShopeeDemoConnection(connection({ demo: true, email: "buyer@example.com", seedKey: "secret" }));
  assert.deepEqual(safe, {
    id: "shopee:demo", provider: "shopee", externalAccountId: "demo",
    displayName: "Demonstração", mode: "local", region: "BR", scopes: [],
    metadata: { demo: true }, status: "connected",
    connectedAt: "1970-01-01T00:00:00.000Z", updatedAt: "1970-01-01T00:00:00.000Z",
  });
  assert.doesNotMatch(JSON.stringify(safe), /PII|buyer|secret|123|orders/);
});

test("demo é barrado antes de DB, refresh e fetch; scheduler também exclui no SQL", async () => {
  const [sync, adapter, scheduler] = await Promise.all([
    readFile(new URL("../src/lib/integrations/shopeeSync.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/integrations/shopee.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/integrations/shopeeScheduler.ts", import.meta.url), "utf8"),
  ]);
  const syncBody = sync.slice(sync.indexOf("export async function runShopeeSyncStep"));
  assert.ok(syncBody.indexOf("isShopeeDemoConnection(connection)") < syncBody.indexOf("hasDb()"));
  const fetchBody = adapter.slice(adapter.indexOf("export async function shopeeFetch"));
  assert.ok(fetchBody.indexOf("isShopeeDemoConnection(connection)") < fetchBody.indexOf("validConnection(connection)"));
  const refreshBody = adapter.slice(adapter.indexOf("export async function refreshShopeeConnection"));
  assert.ok(refreshBody.indexOf("isShopeeDemoConnection(connection)") < refreshBody.indexOf("refreshes.get(connection.id)"));
  assert.match(scheduler, /metadata->'demo' IS DISTINCT FROM 'true'::jsonb/);
  assert.ok(scheduler.indexOf("isShopeeDemoConnection(connection)") < scheduler.indexOf("runShopeeSyncBatch(connection"));
});

test("conexão real sem refresh token preserva erro explícito de reautorização antes do request", async () => {
  const adapter = await readFile(new URL("../src/lib/integrations/shopee.ts", import.meta.url), "utf8");
  const refreshBody = adapter.slice(adapter.indexOf("export async function refreshShopeeConnection"));
  assert.match(refreshBody, /if \(!connection\.refreshToken\)[\s\S]*ChannelAuthExpiredError/);
  assert.ok(refreshBody.indexOf("if (!connection.refreshToken)") < refreshBody.indexOf("refreshes.get(connection.id)"));
});
