import test from "node:test";
import assert from "node:assert/strict";
import { isolateProviderRead } from "../src/lib/integrations/providerReadIsolation.ts";
import { TiktokOwnershipConflictError } from "../src/lib/integrations/tiktokOwnership.ts";

test("conflito TikTok fica isolado e nao expoe identificadores", async () => {
  const result = await isolateProviderRead(
    async () => { throw new TiktokOwnershipConflictError(); },
    [],
    "tiktok_shop",
  );

  assert.deepEqual(result.value, []);
  assert.equal(result.issue?.code, "OWNERSHIP_CONFLICT");
  assert.equal(result.issue?.status, "attention");
  assert.doesNotMatch(result.issue?.message ?? "", /workspace-|shop-|token/i);
});

test("falha de um provider nao impede leituras independentes", async () => {
  const [failed, healthy] = await Promise.all([
    isolateProviderRead(async () => { throw new Error("detalhe interno"); }, []),
    isolateProviderRead(async () => ["ok"], []),
  ]);

  assert.equal(failed.issue?.code, "PROVIDER_READ_FAILED");
  assert.doesNotMatch(failed.issue?.message ?? "", /detalhe interno/);
  assert.deepEqual(healthy, { value: ["ok"] });
});
