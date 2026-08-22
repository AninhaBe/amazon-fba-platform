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

// Regressão do bug de 22/08/2026: "Hoje" era uma janela móvel de 24h, então a
// venda de 21/08 21:12 aparecia como hoje às 12:39 do dia 22. Agora "Hoje"
// começa à meia-noite de Brasília — o mesmo corte que o Seller Central usa.
test("Hoje começa à meia-noite de Brasília, não 24h atrás", () => {
  const hoje = periodFromDays(1);
  // O início tem que ser um 00:00:00 BRT = 03:00:00Z de algum dia.
  assert.match(hoje.startISO, /T03:00:00\.000Z$/, "início deve ser meia-noite BRT (03:00Z)");
  assert.equal(hoje.days, 1);
});

test("N dias alinham ao dia-calendário: o início é sempre meia-noite BRT", () => {
  for (const n of [1, 7, 15, 30]) {
    const p = periodFromDays(n);
    assert.match(p.startISO, /T03:00:00\.000Z$/, `${n} dias: início deve ser meia-noite BRT`);
  }
});

test("7 dias começa 6 dias-calendário antes de hoje", () => {
  const hoje = periodFromDays(1);
  const sete = periodFromDays(7);
  const diff = (new Date(hoje.startISO).getTime() - new Date(sete.startISO).getTime()) / 86_400_000;
  assert.equal(diff, 6, "de hoje 00:00 a 7-dias 00:00 vão exatamente 6 dias");
});
