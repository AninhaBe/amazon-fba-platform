import assert from "node:assert/strict";
import test from "node:test";

import {
  nextShopeeEscrowOffset,
  nextShopeeOrderWindow,
  ownsShopeeLease,
  shopeeEscrowSettled,
  decodeShopeeSyncFailure,
  encodeShopeeSyncFailure,
  fencedShopeeExternalRead,
  validateShopeeCatalogSnapshot,
  validateShopeeOrderBatch,
} from "../src/lib/integrations/shopeeSyncControl.ts";

test("fencing exige token atual e lease não expirado", () => {
  const lease = { token: "worker-b", expiresAt: 200 };
  assert.equal(ownsShopeeLease(lease, "worker-a", 100), false);
  assert.equal(ownsShopeeLease(lease, "worker-b", 200), false);
  assert.equal(ownsShopeeLease(lease, "worker-b", 199), true);
});

test("detalhe de pedidos Shopee exige bijeção do lote", () => {
  assert.doesNotThrow(() => validateShopeeOrderBatch(["A", "B"], [{ order_sn: "B" }, { order_sn: "A" }]));
  assert.throws(() => validateShopeeOrderBatch(["A", "B"], [{ order_sn: "A" }]), /parcial/);
  assert.throws(() => validateShopeeOrderBatch(["A"], [{ order_sn: "A" }, { order_sn: "X" }]), /inesperada/);
  assert.throws(() => validateShopeeOrderBatch(["A"], [{ order_sn: "A" }, { order_sn: "A" }]), /duplicada/);
  assert.throws(() => validateShopeeOrderBatch(["A"], [{ order_sn: null }]), /parcial/);
});

test("snapshot de catálogo exige correspondência exata antes de reconciliar", () => {
  assert.deepEqual(validateShopeeCatalogSnapshot([1, 2], [{ item_id: 2 }, { item_id: 1 }]), ["2", "1"]);
  assert.throws(
    () => validateShopeeCatalogSnapshot([1, 2], [{ item_id: 1 }]),
    /parciais ou inesperados/
  );
  assert.throws(
    () => validateShopeeCatalogSnapshot([1], [{ item_id: 1 }, { item_id: 99 }]),
    /parciais ou inesperados/
  );
  assert.throws(() => validateShopeeCatalogSnapshot([1, 1], [{ item_id: 1 }]), /duplicados/);
  assert.throws(() => validateShopeeCatalogSnapshot([1], [{ item_id: null }]), /sem item_id/);
});

test("lease perdido durante leitura externa impede qualquer escrita subsequente", async () => {
  let ownsLease = true;
  let writes = 0;
  const assertOwnership = async () => {
    if (!ownsLease) throw new Error("lease perdido");
  };
  await assert.rejects(async () => {
    await fencedShopeeExternalRead(assertOwnership, async () => {
      ownsLease = false;
      return { item_list: [{ item_id: 1 }] };
    });
    writes++;
  }, /lease perdido/);
  assert.equal(writes, 0);
});

test("falhas persistidas distinguem retry, reauth e erro terminal sem expor detalhes extras", () => {
  assert.deepEqual(decodeShopeeSyncFailure(encodeShopeeSyncFailure("retryable_error", "timeout")), {
    phase: "retryable_error", message: "timeout",
  });
  assert.deepEqual(decodeShopeeSyncFailure(encodeShopeeSyncFailure("reauth_required", "reconecte")), {
    phase: "reauth_required", message: "reconecte",
  });
  assert.deepEqual(decodeShopeeSyncFailure(encodeShopeeSyncFailure("terminal_error", "permissão")), {
    phase: "terminal_error", message: "permissão",
  });
});

test("cursor de escrow avança deterministicamente e dá a volta", () => {
  assert.equal(nextShopeeEscrowOffset(0, 20, 53), 20);
  assert.equal(nextShopeeEscrowOffset(40, 20, 53), 7);
  assert.equal(nextShopeeEscrowOffset(10, 0, 0), 0);
});

test("janela de pedidos avança para trás até o alvo imediato", () => {
  const DAY = 86_400_000;
  const now = 1_700_000_000_000;
  const move = nextShopeeOrderWindow({
    windowFromMs: now - 15 * DAY,
    targetFromMs: now - 30 * DAY,
    historyFloorMs: now - 60 * DAY,
    windowMs: 15 * DAY,
    toleranceMs: DAY,
  });
  assert.deepEqual(move, { kind: "advance", nextToMs: now - 15 * DAY, nextFromMs: now - 30 * DAY });
});

test("alvo imediato coberto estende o alvo até o histórico completo (fase 2)", () => {
  const DAY = 86_400_000;
  const now = 1_700_000_000_000;
  const move = nextShopeeOrderWindow({
    windowFromMs: now - 30 * DAY,
    targetFromMs: now - 30 * DAY,
    historyFloorMs: now - 60 * DAY,
    windowMs: 15 * DAY,
    toleranceMs: DAY,
  });
  assert.deepEqual(move, {
    kind: "extend",
    targetFromMs: now - 60 * DAY,
    nextToMs: now - 30 * DAY,
    nextFromMs: now - 45 * DAY,
  });
});

test("histórico completo coberto fecha em complete, sem reabrir alvo já alcançado", () => {
  const DAY = 86_400_000;
  const now = 1_700_000_000_000;
  const alvoAntigo = nextShopeeOrderWindow({
    windowFromMs: now - 60 * DAY,
    targetFromMs: now - 60 * DAY,
    historyFloorMs: now - 60 * DAY,
    windowMs: 15 * DAY,
    toleranceMs: DAY,
  });
  assert.deepEqual(alvoAntigo, { kind: "complete" });
  // Conexão antiga: target_from ficou no passado em relação ao piso móvel —
  // dentro da tolerância não há nada a estender.
  const conexaoAntiga = nextShopeeOrderWindow({
    windowFromMs: now - 61 * DAY,
    targetFromMs: now - 61 * DAY,
    historyFloorMs: now - 60 * DAY,
    windowMs: 15 * DAY,
    toleranceMs: DAY,
  });
  assert.deepEqual(conexaoAntiga, { kind: "complete" });
});

test("settlement depende de marcador explícito, não da presença de fees", () => {
  assert.equal(shopeeEscrowSettled({ fees: [{ amount: 10 }] }), false);
  assert.equal(shopeeEscrowSettled({ _sellercore: { shopeeEscrowSettled: false } }), false);
  assert.equal(shopeeEscrowSettled({ _sellercore: { shopeeEscrowSettled: true } }), true);
});
