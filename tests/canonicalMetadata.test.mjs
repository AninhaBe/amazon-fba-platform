import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeCanonicalRaw,
  stripReservedCanonicalMetadata,
} from "../src/lib/integrations/canonicalMetadata.ts";
import { SHOPEE_ESCROW_MARK_SQL } from "../src/lib/integrations/shopeeSyncControl.ts";
import { TIKTOK_STATEMENT_MARK_SQL } from "../src/lib/integrations/tiktokSyncControl.ts";

test("payload externo não injeta namespace reservado", () => {
  assert.deepEqual(
    stripReservedCanonicalMetadata({ order: "A", _sellercore: { shopeeEscrowSettled: false, injected: true } }),
    { order: "A" }
  );
});

test("upsert preserva metadado interno genérico e rejeita overwrite externo", () => {
  assert.deepEqual(
    mergeCanonicalRaw(
      { order: "novo", _sellercore: { statementSettled: false } },
      { order: "antigo", _sellercore: { statementSettled: true, shopeeEscrowSettled: true } }
    ),
    { order: "novo", _sellercore: { statementSettled: true, shopeeEscrowSettled: true } }
  );
});

test("expressão SQL do marcador cria pai ausente por merge, sem jsonb_set aninhado", () => {
  assert.match(SHOPEE_ESCROW_MARK_SQL, /jsonb_build_object\(\s*'_sellercore'/);
  assert.match(SHOPEE_ESCROW_MARK_SQL, /COALESCE\(raw -> '_sellercore', '\{\}'::jsonb\)/);
  assert.match(SHOPEE_ESCROW_MARK_SQL, /jsonb_build_object\('shopeeEscrowSettled', true\)/);
  assert.doesNotMatch(SHOPEE_ESCROW_MARK_SQL, /jsonb_set/);
});

test("re-upsert TikTok preserva settlement e payload externo não o sobrescreve", () => {
  assert.deepEqual(
    mergeCanonicalRaw(
      { id: "novo", _sellercore: { statementSettled: false, injected: true } },
      { id: "antigo", _sellercore: { statementSettled: true } }
    ),
    { id: "novo", _sellercore: { statementSettled: true } }
  );
  assert.match(TIKTOK_STATEMENT_MARK_SQL, /jsonb_build_object\(\s*'_sellercore'/);
  assert.match(TIKTOK_STATEMENT_MARK_SQL, /COALESCE\(raw -> '_sellercore', '\{\}'::jsonb\)/);
  assert.match(TIKTOK_STATEMENT_MARK_SQL, /jsonb_build_object\('statementSettled', true\)/);
  assert.doesNotMatch(TIKTOK_STATEMENT_MARK_SQL, /jsonb_set/);
});
