import test from "node:test";
import assert from "node:assert/strict";
import { collectAllNextTokenPages, splitDateRange } from "../src/lib/nextTokenPagination.ts";

test("percorre todas as páginas sem um teto artificial", async () => {
  const pages = await collectAllNextTokenPages(
    async (token) => {
      const index = token ? Number(token) : 0;
      return { values: [index], nextToken: index < 74 ? String(index + 1) : undefined };
    },
    (page) => page.nextToken
  );
  assert.equal(pages.length, 75);
  assert.equal(pages.at(-1).values[0], 74);
});

test("recusa token repetido em vez de retornar dados parciais", async () => {
  await assert.rejects(
    collectAllNextTokenPages(
      async () => ({ nextToken: "repetido" }),
      (page) => page.nextToken
    ),
    /repetiu uma página/
  );
});

test("divide filtros longos em janelas aceitas pelo financeiro", () => {
  const ranges = splitDateRange(
    new Date("2025-07-01T00:00:00Z"),
    new Date("2026-07-01T00:00:00Z")
  );
  assert.equal(ranges.length, 3);
  assert.equal(ranges[0].from.toISOString(), "2025-07-01T00:00:00.000Z");
  assert.equal(ranges.at(-1).to.toISOString(), "2026-07-01T00:00:00.000Z");
  assert.ok(ranges.every((range) => range.to.getTime() - range.from.getTime() <= 179 * 86_400_000));
});
