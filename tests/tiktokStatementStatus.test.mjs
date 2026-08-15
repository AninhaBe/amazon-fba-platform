import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Payload REAL da conta 7494291387899806731, janela 12/08→13/08, colhido em
// 15/08/2026 chamando /finance/202309/statements:
//
// {"next_page_token":"","statements":[{
//    "adjustment_amount":"51.2","currency":"BRL","fee_amount":"-385.99",
//    "id":"7672560861864609554","net_sales_amount":"640.48",
//    "payment_id":"3679938634926752779","payment_status":"PAID",
//    "payment_time":1786511469,"revenue_amount":"640.48",
//    "settlement_amount":"271.49","shipping_cost_amount":"-34.2",
//    "statement_time":1786492800}]}
//
// Repare: **não existe campo `status`** — o status vem em `payment_status`.
// O parser lia `raw.status`, o status saía vazio, `isFinalStatement` recusava,
// `unknown` virava 1 e `processStatementsPage` lançava
// FINANCIAL_STATEMENT_STATUS_NOT_FINAL_RETRYABLE. Resultado: 85 rodadas presas
// na página 0 desde 13/08, com `error_count` zerado — a exceção subia antes de
// qualquer contador, então nada aparecia na tela nem no banco.

const ESTATEMENT_REAL = {
  adjustment_amount: "51.2",
  currency: "BRL",
  fee_amount: "-385.99",
  id: "7672560861864609554",
  net_sales_amount: "640.48",
  payment_id: "3679938634926752779",
  payment_status: "PAID",
  payment_time: 1786511469,
  revenue_amount: "640.48",
  settlement_amount: "271.49",
  shipping_cost_amount: "-34.2",
  statement_time: 1786492800,
};

const text = (value) => (typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "");
const FINAL_STATUSES = new Set(["PAID", "SETTLED", "COMPLETED", "CLOSED"]);

test("o statement real nao tem campo `status`", () => {
  assert.equal(ESTATEMENT_REAL.status, undefined, "se a TikTok voltar a mandar `status`, o fallback continua valendo");
  assert.equal(ESTATEMENT_REAL.payment_status, "PAID");
});

test("ler so `raw.status` recusa um statement pago (o defeito)", () => {
  const status = text(ESTATEMENT_REAL.status).toUpperCase();
  assert.equal(status, "");
  assert.equal(FINAL_STATUSES.has(status), false, "era isto que travava o checkpoint");
});

test("com o fallback para payment_status o statement e aceito", () => {
  const status = text(ESTATEMENT_REAL.status ?? ESTATEMENT_REAL.payment_status).toUpperCase();
  assert.equal(status, "PAID");
  assert.equal(FINAL_STATUSES.has(status), true);
});

test("`status` continua tendo precedencia quando existir", () => {
  const comAmbos = { ...ESTATEMENT_REAL, status: "settled" };
  assert.equal(text(comAmbos.status ?? comAmbos.payment_status).toUpperCase(), "SETTLED");
});

test("o codigo aplica o fallback nos dois campos afetados", () => {
  const s = readFileSync(new URL("../src/lib/integrations/tiktokFinancialLedger.ts", import.meta.url), "utf8");
  assert.match(s, /text\(raw\.status\?\?raw\.payment_status\)/, "status precisa do fallback");
  // `start_time` tambem nao vem; a janela real chega em `statement_time`.
  assert.match(s, /epoch\(raw\.start_time\?\?raw\.statement_time\)/);
});
