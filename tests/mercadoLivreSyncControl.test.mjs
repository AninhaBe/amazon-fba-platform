import assert from "node:assert/strict";
import test from "node:test";

import { nextMercadoLivreOrderWindow } from "../src/lib/integrations/mercadoLivreSyncControl.ts";

const DAY = 86_400_000;
const now = 1_700_000_000_000;

test("janela de pedidos avança para trás até o alvo imediato", () => {
  const move = nextMercadoLivreOrderWindow({
    windowFromMs: now - 7 * DAY,
    targetFromMs: now - 30 * DAY,
    coveredFromMs: null,
    historyFloorMs: now - 366 * DAY,
    windowMs: 7 * DAY,
    toleranceMs: DAY,
  });
  assert.deepEqual(move, { kind: "advance", nextToMs: now - 7 * DAY, nextFromMs: now - 14 * DAY });
});

test("alvo imediato coberto estende o alvo até o histórico completo (fase 2)", () => {
  const move = nextMercadoLivreOrderWindow({
    windowFromMs: now - 30 * DAY,
    targetFromMs: now - 30 * DAY,
    coveredFromMs: now - 23 * DAY,
    historyFloorMs: now - 366 * DAY,
    windowMs: 7 * DAY,
    toleranceMs: DAY,
  });
  assert.deepEqual(move, {
    kind: "extend",
    targetFromMs: now - 366 * DAY,
    coveredFromMs: now - 30 * DAY,
    nextToMs: now - 30 * DAY,
    nextFromMs: now - 37 * DAY,
  });
});

test("reabertura incremental com histórico já coberto fecha em complete — não redispara o backfill", () => {
  // O requestMercadoLivreSync estreita o alvo (target_from = covered_to), então
  // no fim de cada ciclo incremental o alvo é RECENTE. O que impede a extensão
  // de redisparar o backfill inteiro é o covered_from antigo.
  const move = nextMercadoLivreOrderWindow({
    windowFromMs: now - 2 * 60_000,
    targetFromMs: now - 2 * 60_000,
    coveredFromMs: now - 366 * DAY,
    historyFloorMs: now - 366 * DAY,
    windowMs: 7 * DAY,
    toleranceMs: DAY,
  });
  assert.deepEqual(move, { kind: "complete" });
});

test("subir o alvo configurado aprofunda a partir do ponto mais antigo coberto, não do recente", () => {
  const move = nextMercadoLivreOrderWindow({
    windowFromMs: now - 2 * 60_000,
    targetFromMs: now - 2 * 60_000,
    coveredFromMs: now - 366 * DAY,
    historyFloorMs: now - 730 * DAY,
    windowMs: 7 * DAY,
    toleranceMs: DAY,
  });
  assert.deepEqual(move, {
    kind: "extend",
    targetFromMs: now - 730 * DAY,
    coveredFromMs: now - 366 * DAY,
    nextToMs: now - 366 * DAY,
    nextFromMs: now - 373 * DAY,
  });
});
