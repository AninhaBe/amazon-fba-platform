import test from "node:test";
import assert from "node:assert/strict";
import { allocateTiktokFinancialQuota, runTiktokFinancialScheduler, tiktokStatementNextEligibleAt } from "../src/lib/integrations/tiktokFinancialScheduler.ts";
import { validatePersistentFinancialPagination } from "../src/lib/integrations/tiktokFinancialLedger.ts";

const now = Date.parse("2026-08-11T12:00:00Z");
const candidate = (orderId, days, changes = {}) => ({ orderId, occurredAt: new Date(now - days * 86400000).toISOString(), lastAttemptAt: null, lastOutcome: null, ...changes });

test("quota financeira reserva 80% recente e 20% historico sem starvation", () => {
  const selected = allocateTiktokFinancialQuota([
    ...Array.from({ length: 12 }, (_, i) => candidate(`r${i}`, i)),
    ...Array.from({ length: 6 }, (_, i) => candidate(`h${i}`, 31 + i)),
  ], 10, now);
  assert.equal(selected.filter((item) => item.orderId.startsWith("r")).length, 8);
  assert.equal(selected.filter((item) => item.orderId.startsWith("h")).length, 2);
});

test("classe vazia cede quota e backoff define proxima elegibilidade", () => {
  assert.equal(allocateTiktokFinancialQuota(Array.from({ length: 10 }, (_, i) => candidate(`h${i}`, 40)), 10, now).length, 10);
  const pending = candidate("p", 1, { lastAttemptAt: new Date(now).toISOString(), lastOutcome: "pending" });
  const retry = candidate("e", 1, { lastAttemptAt: new Date(now).toISOString(), lastOutcome: "retryable_error" });
  assert.equal(tiktokStatementNextEligibleAt(pending), now + 6 * 3600000);
  assert.equal(tiktokStatementNextEligibleAt(retry), now + 15 * 60000);
  assert.deepEqual(allocateTiktokFinancialQuota([pending, retry], 10, now), []);
});

test("scheduler real preserva A -> B -> A entre execucoes nos quatro recursos sem escrita parcial", async () => {
  for (const resource of ["statements", "statement_transactions:statement-1", "payments", "unsettled"]) {
    const durable = { current: null, history: [], writes: 0, calls: 0 };
    const processor = async () => {
      const next = ["A", "B", "A"][durable.calls++];
      const history = validatePersistentFinancialPagination(resource, durable.current, next, durable.history);
      durable.writes++;
      durable.current = next;
      durable.history = history.map((hash) => hash.toString("hex"));
      return { acquired: true, terminal: false, seen: 1, written: 1 };
    };
    const invocation = () => runTiktokFinancialScheduler({
      db: { query: async () => [], transaction: async (work) => work(async () => []) },
      adapters: {}, scope: { workspaceId: "workspace", connectionId: "tiktok_shop:shop" },
      window: { from: new Date("2026-08-10T00:00:00Z"), to: new Date("2026-08-11T00:00:00Z") },
      deadline: Date.now() + 10_000, pageBudget: 1, processors: [processor], ownerToken: () => "owner",
    });
    await invocation();
    await invocation();
    await assert.rejects(invocation, /REPEATED_PAGE_TOKEN_RETRYABLE/);
    assert.equal(durable.writes, 2, `${resource} nao escreve a pagina repetida`);
    assert.equal(durable.history.length, 2);
    assert.ok(durable.history.every((hash) => /^[0-9a-f]{64}$/.test(hash)));
    assert.doesNotMatch(JSON.stringify(durable.history), /"A"|"B"/);
  }
});

test("scheduler nao repete recurso terminal e upsert idempotente nao conta nova escrita", async () => {
  let calls = 0;
  const processor = async () => ({ acquired: true, terminal: true, seen: 1, written: calls++ === 0 ? 1 : 0 });
  const base = { db: { query: async () => [], transaction: async (work) => work(async () => []) }, adapters: {}, scope: { workspaceId: "w", connectionId: "tiktok_shop:s" }, window: { from: new Date(0), to: new Date(1) }, deadline: Date.now() + 10_000, processors: [processor], ownerToken: () => "owner" };
  await runTiktokFinancialScheduler(base);
  assert.equal(calls, 1, "terminal encerra o drain imediatamente");
});
