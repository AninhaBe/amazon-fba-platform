import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("manifesto declara toda a configuraÃ§Ã£o Shopee do runtime", async () => {
  const [render, example] = await Promise.all([
    readFile(new URL("../render.yaml", import.meta.url), "utf8"),
    readFile(new URL("../.env.local.example", import.meta.url), "utf8"),
  ]);
  for (const name of ["SHOPEE_PARTNER_ID", "SHOPEE_PARTNER_KEY", "SHOPEE_ENV"]) {
    assert.match(render, new RegExp(`key:\\s*${name}\\b`));
    assert.match(example, new RegExp(`^${name}=`, "m"));
  }
});

test("callback consome o cookie OAuth tambÃ©m nos retornos de falha", async () => {
  const callback = await readFile(
    new URL("../src/app/api/integrations/shopee/callback/route.ts", import.meta.url),
    "utf8",
  );
  const failBody = callback.slice(callback.indexOf("const fail"), callback.indexOf("if (!req.cookies"));
  assert.match(failBody, /shopee_oauth_state/);
  assert.match(failBody, /maxAge:\s*0/);
});
