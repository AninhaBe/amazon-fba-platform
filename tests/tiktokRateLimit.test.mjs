import test from "node:test";
import assert from "node:assert/strict";
import { classifyTiktokApiError } from "../src/lib/tiktok.ts";

test("HTTP 429 interrompe o lote por sinal explicito e sanitizado", () => {
  const error = classifyTiktokApiError({ httpStatus: 429, code: 42900, message: "detalhe privado" });
  assert.equal(error.code, "RATE_LIMITED");
  assert.equal(error.message.includes("detalhe privado"), false);
});

test("code 36009002 interrompe inclusive resposta HTTP 200", () => {
  const error = classifyTiktokApiError({ httpStatus: 200, code: 36009002, message: "provider detail" });
  assert.equal(error.code, "RATE_LIMITED");
  assert.equal(error.message.includes("provider detail"), false);
});
