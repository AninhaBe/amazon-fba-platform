import test from "node:test";
import assert from "node:assert/strict";
import { getRevenueTrend } from "../src/lib/revenueTrend.ts";

const dias = (...valores) => valores.map(([revenue, orders]) => ({ revenue, orders }));

// O caso real de 23/08/2026: a conta começou a vender no meio do período.
//
// A 1ª metade dos 30 dias tinha UMA venda de R$ 19,90 (a primeira da conta) e a
// 2ª metade tinha R$ 473,84. A conta dava 2281,1%, e o card exibia isso ao lado
// do faturamento — aritmeticamente correto, e lido de relance parecia que algo
// tinha explodido. Base quase-zero não é base.
test("base com menos de 3 pedidos não vira percentual", () => {
  const t = getRevenueTrend(dias([0, 0], [19.9, 1], [200, 5], [273.84, 7]));
  assert.equal(t.percentage, null, "deveria ser 'novo ritmo', não um número");
  assert.equal(t.direction, "up");
});

test("base suficiente produz o percentual normalmente", () => {
  const t = getRevenueTrend(dias([100, 3], [100, 3], [150, 4], [150, 4]));
  assert.equal(t.direction, "up");
  assert.equal(Math.round(t.percentage), 50);
});

test("queda com base suficiente continua sendo medida", () => {
  const t = getRevenueTrend(dias([200, 5], [200, 5], [100, 3], [100, 2]));
  assert.equal(t.direction, "down");
  assert.equal(Math.round(t.percentage), -50);
});

test("período sem venda nenhuma é estável, não crescimento", () => {
  const t = getRevenueTrend(dias([0, 0], [0, 0], [0, 0], [0, 0]));
  assert.equal(t.direction, "flat");
  assert.equal(t.percentage, 0);
});

test("série curta demais não devolve tendência", () => {
  assert.equal(getRevenueTrend(dias([10, 1])), null);
});
