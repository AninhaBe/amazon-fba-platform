import test from "node:test";
import assert from "node:assert/strict";
import { marginMetricTone, marginStateClass, marginTone } from "../src/lib/marginTone.ts";

test("margem abaixo de 12% e risco em todo o NEXO", () => {
  for (const margin of [-10, 0, 11, 11.9]) {
    assert.equal(marginTone(margin), "danger");
    assert.equal(marginMetricTone(margin), "danger");
    assert.equal(marginStateClass(margin), "is-negative");
  }
});

test("margem de 12% a 15% e atencao em todo o NEXO", () => {
  for (const margin of [12, 13.5, 15]) {
    assert.equal(marginTone(margin), "warning");
    assert.equal(marginMetricTone(margin), "warn");
    assert.equal(marginStateClass(margin), "is-warning");
  }
});

test("margem acima de 15% e saudavel em todo o NEXO", () => {
  for (const margin of [15.01, 18, 60]) {
    assert.equal(marginTone(margin), "positive");
    assert.equal(marginMetricTone(margin), "positive");
    assert.equal(marginStateClass(margin), "is-positive");
  }
});

test("margem desconhecida permanece desconhecida", () => {
  for (const margin of [null, undefined, Number.NaN]) {
    assert.equal(marginTone(margin), "unknown");
    assert.equal(marginMetricTone(margin), "default");
    assert.equal(marginStateClass(margin), "is-unknown");
  }
});
