import test from "node:test";
import assert from "node:assert/strict";
import "../scripts/ts-resolver.mjs";
const { selectShopeeConnection } = await import("../src/lib/integrations/shopeeModules.ts");

const connection = (id, provider = "shopee", status = "connected") => ({
  id, provider, status, externalAccountId: id, mode: "local", scopes: [], metadata: {},
  connectedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
});

test("seleciona cada conexão Shopee autorizada pelo id exato", () => {
  const connections = [connection("shopee:1"), connection("shopee:2")];
  assert.equal(selectShopeeConnection(connections, "shopee:2").id, "shopee:2");
});

test("rejeita conexão ausente, de outro provider ou desconectada", () => {
  const connections = [connection("shopee:1"), connection("amazon:1", "amazon"), connection("shopee:off", "shopee", "disconnected")];
  for (const requested of ["shopee:missing", "amazon:1", "shopee:off"]) {
    assert.throws(() => selectShopeeConnection(connections, requested), (error) => error.code === "CONNECTION_NOT_FOUND" && error.status === 404);
  }
});
