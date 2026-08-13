import test from "node:test";
import assert from "node:assert/strict";
import { acceptsStatus, summarize } from "../scripts/health-local.mjs";

test("health gate aceita somente códigos explicitamente esperados", () => {
  assert.equal(acceptsStatus(401, [401, 503]), true);
  assert.equal(acceptsStatus(500, [401, 503]), false);
});

test("BLOCKED não falha o gate, mas regressão técnica falha", () => {
  assert.deepEqual(summarize([{ status: "PASS" }, { status: "BLOCKED" }]), {
    failed: 0, blocked: 1, exitCode: 0,
  });
  assert.equal(summarize([{ status: "FAIL" }]).exitCode, 1);
});
