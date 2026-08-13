import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/lib/integrations/tiktokSync.ts", import.meta.url), "utf8");

test("fila financeira roda em lotes praticos e limitados", () => {
  assert.match(source, /STATEMENT_BATCH_SIZE = 10/);
  assert.match(source, /STATEMENT_BATCHES_PER_STEP = 10/);
  assert.match(source, /hasSyncBudget\(deadline, Date\.now\(\)\)/);
});

test("fila inicial e oldest-first e placeholders giram pela ultima tentativa", () => {
  assert.match(source, /statementLastAttemptAt[^`]+ASC NULLS FIRST,[\s\S]+o\.occurred_at ASC, o\.external_order_id/);
  assert.match(source, /statementLastOutcome/);
  assert.match(source, /markStatementAttempt\(query, connectionId, linha\.external_order_id, "pending"\)/);
});

test("sync completo continua elegivel enquanto houver backlog financeiro", () => {
  assert.match(source, /status <> 'complete' OR EXISTS/);
  assert.match(source, /financialBacklog/);
  assert.match(source, /productsComplete/);
  assert.match(source, /ordersComplete/);
});

test("financeiro recebe orçamento antes de catálogo e paginação", () => {
  const reconcile = source.indexOf("await reconcileStatementBatches(lojaAtual, connectionId, assertOwnership, deadline);");
  const products = source.indexOf("await syncProducts(lojaAtual, connectionId, assertOwnership, deadline);");
  const orders = source.indexOf("() => getTiktokOrderList(shop");
  assert.ok(reconcile > 0);
  assert.ok(reconcile < products);
  assert.ok(reconcile < orders);
});
