import assert from "node:assert/strict";
import test from "node:test";

import {
  requestShopeeJson,
  ShopeeApiError,
} from "../src/lib/integrations/shopeeHttp.ts";

const noWait = async () => {};

test("429 final falha tipado após retries e não expõe mensagem remota", async (t) => {
  let attempts = 0;
  t.mock.method(globalThis, "fetch", async () => {
    attempts++;
    return new Response(JSON.stringify({ error: "rate_limit", message: "segredo remoto", request_id: "req-1" }), {
      status: 429,
      headers: { "content-type": "application/json" },
    });
  });

  await assert.rejects(
    requestShopeeJson("https://shopee.invalid/test", undefined, noWait),
    (error) => {
      assert.ok(error instanceof ShopeeApiError);
      assert.equal(error.code, "rate_limit");
      assert.equal(error.status, 429);
      assert.equal(error.retryable, true);
      assert.equal(error.requestId, "req-1");
      assert.doesNotMatch(error.message, /segredo remoto/);
      return true;
    }
  );
  assert.equal(attempts, 3);
});

test("5xx final com JSON falha tipado e sanitizado", async (t) => {
  let attempts = 0;
  t.mock.method(globalThis, "fetch", async () => {
    attempts++;
    return new Response(JSON.stringify({ message: "stack interno" }), { status: 503 });
  });

  await assert.rejects(
    requestShopeeJson("https://shopee.invalid/test", undefined, noWait),
    (error) => {
      assert.ok(error instanceof ShopeeApiError);
      assert.equal(error.code, "http_503");
      assert.equal(error.status, 503);
      assert.equal(error.retryable, true);
      assert.doesNotMatch(error.message, /stack interno/);
      return true;
    }
  );
  assert.equal(attempts, 3);
});

test("resposta 2xx não JSON nunca vira objeto vazio", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("gateway html", {
    status: 200,
    headers: { "content-type": "text/html" },
  }));

  await assert.rejects(
    requestShopeeJson("https://shopee.invalid/test", undefined, noWait),
    (error) => error instanceof ShopeeApiError && error.code === "invalid_response" && error.retryable
  );
});
