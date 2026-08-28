import assert from "node:assert/strict";
import test from "node:test";

import { nextMercadoLivreOrderWindow } from "../src/lib/integrations/mercadoLivreSyncControl.ts";

const DAY = 86_400_000;
const now = 1_700_000_000_000;

test("janela de pedidos avança para trás até o alvo", () => {
  const move = nextMercadoLivreOrderWindow({
    windowFromMs: now - 7 * DAY,
    targetFromMs: now - 27 * DAY,
    windowMs: 7 * DAY,
  });
  assert.deepEqual(move, { kind: "advance", nextToMs: now - 7 * DAY, nextFromMs: now - 14 * DAY });
});

test("última janela não ultrapassa o alvo e o alvo alcançado fecha em complete", () => {
  const ultima = nextMercadoLivreOrderWindow({
    windowFromMs: now - 24 * DAY,
    targetFromMs: now - 27 * DAY,
    windowMs: 7 * DAY,
  });
  assert.deepEqual(ultima, { kind: "advance", nextToMs: now - 24 * DAY, nextFromMs: now - 27 * DAY });
  assert.deepEqual(
    nextMercadoLivreOrderWindow({ windowFromMs: now - 27 * DAY, targetFromMs: now - 27 * DAY, windowMs: 7 * DAY }),
    { kind: "complete" }
  );
});

test("reabertura incremental (alvo estreitado pelo covered_to) fecha em complete sem redisparar backfill", () => {
  // O requestMercadoLivreSync estreita o alvo (target_from = covered_to) a cada
  // reabertura; ao fechar a janela recente, o movimento é complete — nada de
  // aprofundamento retroativo (decisão da Ana, 27/08/2026).
  const move = nextMercadoLivreOrderWindow({
    windowFromMs: now - 2 * 60_000,
    targetFromMs: now - 2 * 60_000,
    windowMs: 7 * DAY,
  });
  assert.deepEqual(move, { kind: "complete" });
});
