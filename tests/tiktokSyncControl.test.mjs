import test from "node:test";
import assert from "node:assert/strict";
import {
  acceptPageToken,
  fencedTiktokExternalRead,
  fencedTiktokMutation,
  hasSyncBudget,
  ownsLease,
  TiktokLeaseLostError,
  requireTiktokLeaseRow,
  validateTiktokOrderBatch,
} from "../src/lib/integrations/tiktokSyncControl.ts";

class FakeSync {
  cursor = null;
  covered = false;
  orders = new Map();
  items = new Map();
  fees = new Map();
  lease = null;

  acquire(token, now, ttl = 100) {
    if (this.lease && this.lease.expiresAt > now) return false;
    this.lease = { token, expiresAt: now + ttl };
    return true;
  }

  page(token, page, now) {
    if (!ownsLease(this.lease, token, now)) return false;
    for (const order of page.orders) {
      this.orders.set(order.id, order);
      this.items.set(order.id, order.items);
      this.fees.set(order.id, order.fees);
    }
    this.cursor = page.next;
    if (page.next === null) this.covered = true;
    return true;
  }
}

test("falha na pagina N retoma do cursor checkpointado e retry e idempotente", () => {
  const sync = new FakeSync();
  assert.equal(sync.acquire("a", 0), true);
  const order = { id: "o1", items: ["i1"], fees: ["f1"] };
  assert.equal(sync.page("a", { orders: [order], next: "pagina-2" }, 1), true);
  assert.equal(sync.cursor, "pagina-2");
  assert.equal(sync.covered, false);
  // A pagina pode ser repetida apos erro entre o upsert e o checkpoint.
  assert.equal(sync.page("a", { orders: [order], next: "pagina-2" }, 2), true);
  assert.equal(sync.orders.size, 1);
  assert.equal(sync.items.size, 1);
  assert.equal(sync.fees.size, 1);
});

test("token repetido e recusado e cursor final e o unico que fecha cobertura", () => {
  const seen = new Set(["pagina-2"]);
  assert.equal(acceptPageToken(seen, "pagina-2"), false);
  assert.equal(acceptPageToken(seen, "pagina-3"), true);
  const sync = new FakeSync();
  sync.acquire("a", 0);
  sync.page("a", { orders: [], next: "pagina-2" }, 1);
  assert.equal(sync.covered, false);
  sync.page("a", { orders: [], next: null }, 2);
  assert.equal(sync.cursor, null);
  assert.equal(sync.covered, true);
});

test("lease concorrente, expirado e executor antigo sao cercados pelo token", () => {
  const sync = new FakeSync();
  assert.equal(sync.acquire("antigo", 0, 10), true);
  assert.equal(sync.acquire("concorrente", 5), false);
  assert.equal(ownsLease(sync.lease, "antigo", 10), false, "expiracao e exclusiva");
  assert.equal(sync.acquire("novo", 10), true);
  assert.equal(sync.page("antigo", { orders: [], next: null }, 11), false);
  assert.equal(sync.covered, false, "executor antigo nao conclui cobertura");
  assert.equal(sync.page("novo", { orders: [], next: null }, 11), true);
});

test("timeout parcial preserva cursor e nunca fabrica cobertura", () => {
  const sync = new FakeSync();
  sync.acquire("a", 0);
  sync.page("a", { orders: [{ id: "o1", items: [], fees: [] }], next: "pagina-2" }, 1);
  assert.equal(hasSyncBudget(2, 2), false);
  assert.equal(sync.cursor, "pagina-2");
  assert.equal(sync.orders.size, 1, "dados ja confirmados sao preservados");
  assert.equal(sync.covered, false);
});

test("detalhe TikTok parcial ou ambíguo não é aceito", () => {
  assert.doesNotThrow(() => validateTiktokOrderBatch(["A", "B"], [{ id: "B" }, { id: "A" }]));
  assert.throws(() => validateTiktokOrderBatch(["A", "B"], [{ id: "A" }]), /parcial/);
  assert.throws(() => validateTiktokOrderBatch(["A"], [{ id: "X" }]), /inesperada/);
  assert.throws(() => validateTiktokOrderBatch(["A"], [{ id: "A" }, { id: "A" }]), /duplicada/);
});

test("lease TikTok perdido durante rede impede escrita e checkpoint", async () => {
  let owns = true;
  let writes = 0;
  let checkpoints = 0;
  const assertOwnership = async () => {
    if (!owns) throw new TiktokLeaseLostError();
  };
  await assert.rejects(async () => {
    await fencedTiktokExternalRead(assertOwnership, async () => {
      owns = false;
      return [{ id: "A" }];
    });
    writes++;
    checkpoints++;
  }, TiktokLeaseLostError);
  assert.equal(writes, 0);
  assert.equal(checkpoints, 0);
});

for (const kind of ["orders", "products", "settlements"]) {
  test(`executor perde lease imediatamente antes de ${kind} e não escreve`, async () => {
    let writes = 0;
    const transaction = async (body) => body({ kind });
    await assert.rejects(
      fencedTiktokMutation(transaction, async () => false, async () => { writes++; }),
      TiktokLeaseLostError
    );
    assert.equal(writes, 0);
  });
}

test("finalização sem linha afetada lança lease lost", () => {
  assert.throws(() => requireTiktokLeaseRow([]), TiktokLeaseLostError);
  assert.doesNotThrow(() => requireTiktokLeaseRow([{ ok: true }]));
});

test("lease expirado no checkpoint reverte snapshot de produtos integralmente", async () => {
  const persisted = { products: [], reconciled: false, checkpoint: false };
  let leaseValid = true;
  const transaction = async (body) => {
    const pending = { products: [], reconciled: false, checkpoint: false };
    const query = async (operation) => {
      if (operation === "initial-fence") return leaseValid ? [{ ok: true }] : [];
      if (operation === "save-products") {
        pending.products.push("produto-novo");
        return [];
      }
      if (operation === "reconcile-products") {
        pending.reconciled = true;
        leaseValid = false;
        return [];
      }
      if (operation === "checkpoint") return leaseValid ? [{ ok: true }] : [];
      throw new Error(`operacao inesperada: ${operation}`);
    };
    const result = await body(query);
    Object.assign(persisted, pending);
    return result;
  };

  await assert.rejects(
    fencedTiktokMutation(
      transaction,
      async (query) => (await query("initial-fence")).length > 0,
      async (query) => {
        await query("save-products");
        await query("reconcile-products");
        requireTiktokLeaseRow(await query("checkpoint"));
      }
    ),
    TiktokLeaseLostError
  );

  assert.deepEqual(persisted, { products: [], reconciled: false, checkpoint: false });
});
