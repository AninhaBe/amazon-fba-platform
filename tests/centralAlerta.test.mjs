import test from "node:test";
import assert from "node:assert/strict";

import { tendenciaSemanal, detectarAlerta } from "../src/lib/centralOverview.ts";

const pts = (arr) => arr.map(([date, revenue]) => ({ date, revenue, orders: 0, units: 0 }));

test("tendência semanal compara 7 dias com os 7 anteriores", () => {
  const serie = pts([
    ["2026-08-01", 10], ["2026-08-02", 10], ["2026-08-03", 10], ["2026-08-04", 10],
    ["2026-08-05", 10], ["2026-08-06", 10], ["2026-08-07", 10],   // anteriores = 70
    ["2026-08-08", 20], ["2026-08-09", 20], ["2026-08-10", 20], ["2026-08-11", 20],
    ["2026-08-12", 20], ["2026-08-13", 20], ["2026-08-14", 20],   // últimos = 140
  ]);
  const t = tendenciaSemanal(serie);
  assert.equal(t.ultimos7, 140);
  assert.equal(t.anteriores7, 70);
  assert.equal(t.deltaPct, 100);
});

test("deltaPct é null sem base anterior — não vira infinito", () => {
  assert.equal(tendenciaSemanal(pts([["2026-08-10", 50]])).deltaPct, null);
  assert.equal(tendenciaSemanal([]).deltaPct, null);
});

const canal = (o) => ({ id: "amazon", name: "Amazon", href: "/amazon", connected: true, revenue: 100, profit: 10, orders: 5, currency: "BRL", note: "", ...o });

test("alerta prioriza canal sem leitura acima de tudo", () => {
  const a = detectarAlerta([
    canal({ id: "amazon", name: "Amazon", unitsWithoutCost: 9 }),
    canal({ id: "shopee", name: "Shopee", error: "sem leitura" }),
  ]);
  assert.equal(a.tom, "atencao");
  assert.match(a.texto, /Shopee.*sem leitura/);
});

test("sem erro, alerta aponta custo faltando", () => {
  const a = detectarAlerta([canal({ name: "Amazon", unitsWithoutCost: 12 })]);
  assert.match(a.texto, /12 unidade/);
  assert.match(a.texto, /subestimado/);
});

test("queda de faturamento na semana vira alerta de atenção", () => {
  const serie = pts([
    ["2026-08-01", 100], ["2026-08-02", 100], ["2026-08-03", 100], ["2026-08-04", 100],
    ["2026-08-05", 100], ["2026-08-06", 100], ["2026-08-07", 100],
    ["2026-08-08", 40], ["2026-08-09", 40], ["2026-08-10", 40], ["2026-08-11", 40],
    ["2026-08-12", 40], ["2026-08-13", 40], ["2026-08-14", 40],
  ]);
  const a = detectarAlerta([canal({ series: serie, unitsWithoutCost: 0 })]);
  assert.equal(a.tom, "atencao");
  assert.match(a.texto, /caiu/);
});

test("sem sinal nenhum, não inventa alerta", () => {
  assert.equal(detectarAlerta([canal({ unitsWithoutCost: 0 })]), null);
});
