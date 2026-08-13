import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pageMetadata, pageRequest, periodRequest, TIKTOK_CATALOG_STATUSES } from "../src/lib/integrations/tiktokModuleContract.ts";

test("TikTok modules enforce defensive deterministic pagination", () => {
  assert.deepEqual(pageRequest(new URLSearchParams()), { limit: 50, offset: 0 });
  assert.throws(() => pageRequest(new URLSearchParams("limit=101")), /limit entre 1 e 100/);
  assert.throws(() => pageRequest(new URLSearchParams("offset=-1")), /Paginação inválida/);
});

test("monitor mantém hasMore com total maior que limit e respeita offset", () => {
  assert.deepEqual(pageMetadata({ limit: 50, offset: 0 }, 120, 50), { limit: 50, offset: 0, total: 120, hasMore: true });
  assert.deepEqual(pageMetadata({ limit: 50, offset: 50 }, 120, 50), { limit: 50, offset: 50, total: 120, hasMore: true });
  assert.deepEqual(pageMetadata({ limit: 50, offset: 100 }, 120, 20), { limit: 50, offset: 100, total: 120, hasMore: false });
});

test("catálogo aceita somente os três status canônicos persistidos", () => {
  assert.deepEqual([...TIKTOK_CATALOG_STATUSES], ["active", "paused", "closed"]);
  for (const providerOnly of ["inactive", "draft", "suspended"]) {
    assert.equal(TIKTOK_CATALOG_STATUSES.includes(providerOnly), false);
  }
});

test("TikTok modules validate bounded periods", () => {
  const period = periodRequest(new URLSearchParams("from=2026-08-01&to=2026-08-10"));
  assert.ok(period.from < period.to);
  assert.throws(() => periodRequest(new URLSearchParams("from=2026-08-10&to=2026-08-01")), /período/);
});

test("TikTok module SQL is tenant/provider/connection scoped and response projection has no PII", async () => {
  const source = await readFile(new URL("../src/lib/integrations/tiktokModules.ts", import.meta.url), "utf8");
  for (const scope of ["workspace_id=$1", "provider=$2", "connection_id=$3"]) assert.match(source, new RegExp(scope.replace("$", "\\$")));
  for (const pii of ["buyer_email", "buyer_name", "phone", "address_line", "postal_code"]) assert.doesNotMatch(source, new RegExp(pii, "i"));
  assert.match(source, /ORDER BY occurred_at DESC, external_order_id DESC/);
  const monitor = source.slice(source.indexOf("export async function readMonitor"), source.indexOf("export async function readCatalog"));
  assert.match(monitor, /counted AS \(SELECT filtered\.\*,COUNT\(\*\) OVER\(\)::int total FROM filtered\), selected AS \(SELECT \* FROM counted[\s\S]*LIMIT \$8 OFFSET \$9\)/);
  assert.doesNotMatch(monitor, /FROM selected s[\s\S]*COUNT\(\*\) OVER/);
  assert.match(source, /new Set\(TIKTOK_CATALOG_STATUSES\)/);
  const inventory = source.slice(source.indexOf("export async function readInventory"), source.indexOf("export async function readAbc"));
  assert.match(inventory, /filtered AS[\s\S]*WHERE \$8=''[\s\S]*SELECT \*,COUNT\(\*\) OVER\(\)::int total FROM filtered[\s\S]*LIMIT \$10 OFFSET \$11/);
  assert.doesNotMatch(inventory, /await readCatalog/);
  const finance = source.slice(source.indexOf("export async function readFinance"), source.indexOf("export async function readInventory"));
  assert.match(finance, /NOT is_estimated/);
  for (const safeField of ["transactionId", "statementId", "orderId", "adjustmentOrderId", "type", "occurredAt", "currency", "revenue", "adjustment"]) assert.match(finance, new RegExp(safeField));
  for (const rawField of ["raw", "buyer", "address", "email", "phone"]) assert.doesNotMatch(finance, new RegExp(`(?:^|[^A-Za-z])${rawField}(?:[^A-Za-z]|$)`, "i"));
});
