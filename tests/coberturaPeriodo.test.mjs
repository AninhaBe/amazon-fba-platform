import assert from "node:assert/strict";
import test from "node:test";

import { coberturaDoPeriodo, periodoDaQuery } from "../src/lib/coberturaPeriodo.ts";

const DAY = 86_400_000;
const now = 1_700_000_000_000;

test("período dentro do histórico coberto é coberto", () => {
  const c = coberturaDoPeriodo({
    periodoDeMs: now - 15 * DAY,
    periodoAteMs: now,
    coveredFrom: new Date(now - 30 * DAY).toISOString(),
    status: "complete",
  });
  assert.equal(c.periodoCoberto, true);
  assert.equal(c.periodoInteiroDescoberto, false);
});

test("período que começa antes do covered_from fica descoberto no início, com data", () => {
  const c = coberturaDoPeriodo({
    periodoDeMs: now - 90 * DAY,
    periodoAteMs: now,
    coveredFrom: new Date(now - 30 * DAY).toISOString(),
    status: "pending",
  });
  assert.equal(c.periodoCoberto, false);
  assert.equal(c.periodoInteiroDescoberto, false);
  assert.equal(c.emImportacao, true);
  assert.equal(c.cobreDesde, new Date(now - 30 * DAY).toISOString());
});

test("período inteiro antes do covered_from nunca vira zeros — é descoberto por inteiro", () => {
  const c = coberturaDoPeriodo({
    periodoDeMs: now - 90 * DAY,
    periodoAteMs: now - 60 * DAY,
    coveredFrom: new Date(now - 30 * DAY).toISOString(),
    status: "syncing",
  });
  assert.equal(c.periodoInteiroDescoberto, true);
  assert.equal(c.emImportacao, true);
});

test("sem covered_from nada está coberto; backfill parado não promete importação", () => {
  const importando = coberturaDoPeriodo({ periodoDeMs: now - DAY, periodoAteMs: now, coveredFrom: null, status: "pending" });
  assert.equal(importando.periodoInteiroDescoberto, true);
  assert.equal(importando.emImportacao, true);
  assert.equal(importando.cobreDesde, null);
  const parado = coberturaDoPeriodo({ periodoDeMs: now - DAY, periodoAteMs: now, coveredFrom: null, status: "error" });
  assert.equal(parado.emImportacao, false);
});

test("status complete com período descoberto diz de onde o histórico começa, sem prometer importação", () => {
  const c = coberturaDoPeriodo({
    periodoDeMs: now - 400 * DAY,
    periodoAteMs: now,
    coveredFrom: new Date(now - 366 * DAY).toISOString(),
    status: "complete",
  });
  assert.equal(c.periodoCoberto, false);
  assert.equal(c.emImportacao, false);
  assert.equal(c.cobreDesde, new Date(now - 366 * DAY).toISOString());
});

test("tolerância absorve a folga de minutos do covered_from", () => {
  const c = coberturaDoPeriodo({
    periodoDeMs: now - 30 * DAY,
    periodoAteMs: now,
    coveredFrom: new Date(now - 30 * DAY + 5 * 60_000).toISOString(),
    status: "complete",
  });
  assert.equal(c.periodoCoberto, true);
});

test("periodoDaQuery entende days=N e período personalizado no fuso de Brasília", () => {
  const porDias = periodoDaQuery("days=30", now);
  assert.deepEqual(porDias, { deMs: now - 30 * DAY, ateMs: now });
  const custom = periodoDaQuery("from=2026-01-01&to=2026-01-31", now);
  assert.equal(custom?.deMs, new Date("2026-01-01T00:00:00-03:00").getTime());
  assert.equal(custom?.ateMs, new Date("2026-01-31T23:59:59.999-03:00").getTime());
  assert.equal(periodoDaQuery("days=abc", now), null);
  assert.equal(periodoDaQuery("from=2026-02-02&to=2026-01-01", now), null);
});
