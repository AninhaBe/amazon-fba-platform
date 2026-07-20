import test from "node:test";
import assert from "node:assert/strict";
import { periodFromDays, periodFromRange, resolvePeriod } from "../src/lib/period.ts";

test("presets são limitados entre 1 e 365 dias", () => {
  assert.equal(periodFromDays(0).days, 30);
  assert.equal(periodFromDays(999).days, 365);
});

test("intervalo personalizado respeita o início do dia em São Paulo", () => {
  const period = periodFromRange("2026-07-01", "2026-07-05");
  assert.equal(period.startISO, "2026-07-01T03:00:00.000Z");
  assert.equal(period.custom, true);
  assert.equal(period.days, 5);
});

test("resolve intervalo customizado antes do preset", () => {
  const period = resolvePeriod(new URLSearchParams("days=90&from=2026-07-01&to=2026-07-03"));
  assert.equal(period.custom, true);
});

test("resolve o filtro Hoje como um dia", () => {
  const period = resolvePeriod(new URLSearchParams("days=today"));
  assert.equal(period.days, 1);
  assert.equal(period.custom, false);
});
