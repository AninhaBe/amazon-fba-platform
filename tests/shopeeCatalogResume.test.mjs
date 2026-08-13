import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  createShopeeCatalogCheckpoint,
  decodeShopeeCatalogCheckpoint,
  encodeShopeeCatalogCheckpoint,
  runShopeeCatalogPageBudget,
  SHOPEE_PRODUCT_STATUSES,
} from "../src/lib/integrations/shopeePagination.ts";

const start = "2026-08-11T12:00:00.000Z";

test("catálogo com mais de 5.000 itens avança em execuções bounded e termina os quatro status", async () => {
  let checkpoint = createShopeeCatalogCheckpoint(start);
  const seen = new Set();
  const visitedStatuses = new Set();
  let executions = 0;

  while (checkpoint) {
    executions++;
    const result = await runShopeeCatalogPageBudget({
      checkpoint,
      maxPages: 7,
      budgetMs: 60_000,
      fetchPage: async (status, offset) => {
        visitedStatuses.add(status);
        if (status !== "NORMAL") return { item: [], has_next_page: false };
        return {
          item: Array.from({ length: 50 }, (_, index) => ({ item_id: offset + index + 1 })),
          has_next_page: offset < 5_000,
          ...(offset < 5_000 ? { next_offset: offset + 50 } : {}),
        };
      },
      processPage: async ({ ids }) => { for (const id of ids) seen.add(id); },
    });
    assert.ok(result.pages <= 7);
    checkpoint = result.checkpoint;
  }

  assert.equal(seen.size, 5_050);
  assert.ok(executions > 1);
  assert.deepEqual([...visitedStatuses], SHOPEE_PRODUCT_STATUSES);
});

test("retomada começa no status e offset persistidos sem reler a primeira página", async () => {
  const offsets = [];
  const first = await runShopeeCatalogPageBudget({
    checkpoint: createShopeeCatalogCheckpoint(start),
    maxPages: 1,
    budgetMs: 1_000,
    fetchPage: async (_status, offset) => {
      offsets.push(offset);
      return { item: [{ item_id: offset + 1 }], has_next_page: true, next_offset: offset + 50 };
    },
    processPage: async () => {},
  });
  assert.equal(first.checkpoint.offset, 50);

  await runShopeeCatalogPageBudget({
    checkpoint: decodeShopeeCatalogCheckpoint(encodeShopeeCatalogCheckpoint(first.checkpoint)),
    maxPages: 1,
    budgetMs: 1_000,
    fetchPage: async (_status, offset) => {
      offsets.push(offset);
      return { item: [], has_next_page: false };
    },
    processPage: async () => {},
  });
  assert.deepEqual(offsets, [0, 50]);
});

test("orçamento de tempo interrompe entre páginas e preserva o próximo offset", async () => {
  const clock = [0, 101];
  const result = await runShopeeCatalogPageBudget({
    checkpoint: createShopeeCatalogCheckpoint(start),
    maxPages: 20,
    budgetMs: 100,
    now: () => clock.shift() ?? 101,
    fetchPage: async (_status, offset) => ({
      item: [{ item_id: offset + 1 }], has_next_page: true, next_offset: offset + 50,
    }),
    processPage: async () => {},
  });
  assert.equal(result.pages, 1);
  assert.equal(result.complete, false);
  assert.equal(result.checkpoint.offset, 50);
});

test("falha de persistência não avança o checkpoint autoritativo", async () => {
  let persisted = createShopeeCatalogCheckpoint(start);
  let pages = 0;
  await assert.rejects(runShopeeCatalogPageBudget({
    checkpoint: persisted,
    maxPages: 3,
    budgetMs: 1_000,
    fetchPage: async (_status, offset) => ({
      item: [{ item_id: offset + 1 }],
      has_next_page: true,
      next_offset: offset + 1,
    }),
    processPage: async ({ nextCheckpoint }) => {
      pages++;
      if (pages === 2) throw new Error("transação revertida");
      persisted = nextCheckpoint;
    },
  }), /transação revertida/);
  assert.equal(persisted.offset, 1);
});

test("perda do lease impede persistência e avanço", async () => {
  let ownsLease = false;
  let writes = 0;
  await assert.rejects(runShopeeCatalogPageBudget({
    checkpoint: createShopeeCatalogCheckpoint(start),
    maxPages: 1,
    budgetMs: 1_000,
    fetchPage: async () => ({ item: [{ item_id: 1 }], has_next_page: false }),
    processPage: async () => {
      if (!ownsLease) throw new Error("lease perdido");
      writes++;
    },
  }), /lease perdido/);
  assert.equal(writes, 0);
});

test("reprocessar a mesma página é idempotente no conjunto canônico", async () => {
  const checkpoint = createShopeeCatalogCheckpoint(start);
  const stored = new Set();
  const execute = () => runShopeeCatalogPageBudget({
    checkpoint,
    maxPages: 1,
    budgetMs: 1_000,
    fetchPage: async () => ({ item: [{ item_id: 1 }, { item_id: 2 }], has_next_page: false }),
    processPage: async ({ ids }) => { for (const id of ids) stored.add(id); },
  });
  await execute();
  await execute();
  assert.deepEqual([...stored], [1, 2]);
});

test("checkpoint inválido falha fechado sem reiniciar o sweep", () => {
  assert.throws(() => decodeShopeeCatalogCheckpoint("{}"), /snapshot anterior preservado/);
  assert.throws(() => decodeShopeeCatalogCheckpoint(JSON.stringify({
    kind: "shopee_catalog_v1", sweepStartedAt: start, statusIndex: 4, offset: 0,
  })), /snapshot anterior preservado/);
});

test("implementação cerca lote e checkpoint na mesma transação e só reconcilia no terminal", () => {
  const source = fs.readFileSync(new URL("../src/lib/integrations/shopeeSync.ts", import.meta.url), "utf8");
  assert.match(source, /await dbTransaction\(async \(query\) =>/);
  assert.match(source, /cursor_token=\$5[\s\S]+FOR UPDATE/);
  assert.match(source, /synced_at < \$4::timestamptz/);
  assert.match(source, /products_complete=true, cursor_token=NULL/);
  assert.match(source, /if \(input\.nextCheckpoint\)[\s\S]+return;[\s\S]+NOT_PRESENT_IN_COMPLETE_SNAPSHOT/);
});
