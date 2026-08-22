import assert from "node:assert/strict";
import test from "node:test";

import { monotoneCurvePath } from "../src/lib/chartPath.ts";

test("monotoneCurvePath trata séries vazias e unitárias", () => {
  assert.equal(monotoneCurvePath([]), "");
  assert.equal(monotoneCurvePath([{ x: 12, y: 34 }]), "M 12 34");
});

test("monotoneCurvePath suaviza a série e preserva seus pontos", () => {
  const path = monotoneCurvePath([
    { x: 0, y: 20 },
    { x: 10, y: 5 },
    { x: 20, y: 12 },
  ]);

  assert.match(path, /^M 0 20 C /);
  assert.match(path, / 10 5 C /);
  assert.match(path, / 20 12$/);
  assert.doesNotMatch(path, /NaN|Infinity/);
});

test("monotoneCurvePath mantém trechos planos sem ondulação artificial", () => {
  const path = monotoneCurvePath([
    { x: 0, y: 8 },
    { x: 10, y: 8 },
    { x: 20, y: 4 },
  ]);

  assert.match(path, /^M 0 8 C [^ ]+ 8 [^ ]+ 8 10 8/);
});
