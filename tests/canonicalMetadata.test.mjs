import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeCanonicalRaw,
  stripReservedCanonicalMetadata,
} from "../src/lib/integrations/canonicalMetadata.ts";

// Desde a ADR-026 R2, a conclusão do produto (liquidação/evidência) vive em
// COLUNAS de workspace_channel_orders; os MARK_SQLs que escreviam
// `raw._sellercore` morreram. O strip e o merge continuam de pé durante a
// transição: eles impedem payload EXTERNO de injetar/sobrescrever o namespace
// legado enquanto o fallback de leitura ao raw ainda existir. Ao fim da R2
// (backfill + remoção do fallback), o strip passa a rejeitar sempre.

test("payload externo não injeta namespace reservado", () => {
  assert.deepEqual(
    stripReservedCanonicalMetadata({ order: "A", _sellercore: { shopeeEscrowSettled: false, injected: true } }),
    { order: "A" }
  );
});

test("upsert preserva metadado interno legado e rejeita overwrite externo", () => {
  assert.deepEqual(
    mergeCanonicalRaw(
      { order: "novo", _sellercore: { statementSettled: false } },
      { order: "antigo", _sellercore: { statementSettled: true, shopeeEscrowSettled: true } }
    ),
    { order: "novo", _sellercore: { statementSettled: true, shopeeEscrowSettled: true } }
  );
});

test("re-upsert preserva settlement legado e payload externo não o sobrescreve", () => {
  assert.deepEqual(
    mergeCanonicalRaw(
      { id: "novo", _sellercore: { statementSettled: false, injected: true } },
      { id: "antigo", _sellercore: { statementSettled: true } }
    ),
    { id: "novo", _sellercore: { statementSettled: true } }
  );
});

test("nenhum sync volta a escrever _sellercore — estado do produto é coluna (ADR-026 R2)", async () => {
  const { readFile } = await import("node:fs/promises");
  for (const arquivo of [
    "../src/lib/integrations/shopeeSync.ts",
    "../src/lib/integrations/tiktokSync.ts",
    "../src/lib/integrations/shopeeSyncControl.ts",
    "../src/lib/integrations/tiktokSyncControl.ts",
  ]) {
    const fonte = await readFile(new URL(arquivo, import.meta.url), "utf8");
    assert.doesNotMatch(
      fonte,
      /SET raw\s*=|jsonb_build_object\('_sellercore'/,
      `${arquivo} voltou a gravar estado do produto dentro do raw`
    );
  }
});
