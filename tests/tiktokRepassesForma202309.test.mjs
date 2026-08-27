import test from "node:test";
import assert from "node:assert/strict";
import { TiktokFinancialAdapters } from "../src/lib/integrations/tiktokFinancialLedger.ts";

// O RECURSO `payments` FALHOU 18 VEZES SEGUIDAS COM `UNKNOWN_ERROR` (27/08/2026).
//
// Terceira vez que a mesma familia de defeito aparece no ledger do TikTok: a
// FORMA suposta do payload nao e a real. Medido na conta real, `/finance/202309/
// payments` devolve:
//   - `amount` como OBJETO `{currency, value}`, nao escalar;
//   - NENHUM `currency` na linha nem no envelope — a moeda vive dentro do valor;
//   - SEM `expected_time` e SEM `statement_id`.
// `requiredCurrency(raw.currency)` lancava em toda linha. Como a mensagem nao tem
// marcador em maiusculas nem codigo numerico, `financialErrorCode` a classificava
// como `UNKNOWN_ERROR` — o diagnostico que o campo existe para dar sumia.

/** Linha real da conta da Ana (valores preservados, identificadores trocados). */
const REPASSE_REAL = {
  id: "pay-1", status: "PAID",
  create_time: 1787713353, paid_time: 1787713476,
  amount: { currency: "BRL", value: "151.49" },
  settlement_amount: { currency: "BRL", value: "151.49" },
  reserve_amount: { currency: "BRL", value: "0" },
  exchange_rate: "1", bank_account: "****",
};

const adaptersDevolvendo = (payload) => new TiktokFinancialAdapters(async () => payload);

test("payload real do 202309 e lido sem lancar, com valor e moeda corretos", async () => {
  const page = await adaptersDevolvendo({ payments: [REPASSE_REAL], next_page_token: "" })
    .payments({ from: 1, to: 2 });
  assert.equal(page.items.length, 1);
  const [repasse] = page.items;
  assert.equal(repasse.amount, "151.49", "o valor sai de amount.value");
  assert.equal(repasse.currency, "BRL", "a moeda sai de DENTRO do amount");
  assert.equal(repasse.paidAt, 1787713476);
  assert.equal(repasse.status, "PAID");
});

test("ausencia de expected_time e statement_id vira null, nunca zero nem data inventada", async () => {
  const [repasse] = (await adaptersDevolvendo({ payments: [REPASSE_REAL] }).payments({ from: 1, to: 2 })).items;
  assert.equal(repasse.expectedAt, null, "o 202309 nao manda expected_time");
  assert.equal(repasse.statementId, null, "o 202309 nao manda statement_id");
});

test("repasse ainda nao pago: paid_time zerado vira null, e nao 1970", async () => {
  // `epoch(0)` devolvia 0 e `requiredEpoch` lancava; agora 0 e ausencia.
  const [repasse] = (await adaptersDevolvendo({ payments: [{ ...REPASSE_REAL, status: "PROCESSING", paid_time: 0 }] })
    .payments({ from: 1, to: 2 })).items;
  assert.equal(repasse.paidAt, null);
  assert.equal(repasse.status, "PROCESSING");
});

test("moeda continua fail-closed: sem moeda em lugar nenhum, LANCA", async () => {
  // Guardar repasse sem moeda seria pior que falhar — o painel somaria valores
  // de moedas diferentes sem saber.
  await assert.rejects(
    () => adaptersDevolvendo({ payments: [{ id: "x", status: "PAID", amount: { value: "10.00" } }] }).payments({ from: 1, to: 2 }),
    /sem moeda ISO valida/i
  );
});

test("forma antiga (escalar + currency ao lado) continua aceita", async () => {
  // Nao quebrar leitura de qualquer endpoint/versao que ainda mande escalar.
  const [repasse] = (await adaptersDevolvendo({ payments: [{ id: "x", status: "PAID", amount: "99.90", currency: "BRL", paid_time: 1787713476 }] })
    .payments({ from: 1, to: 2 })).items;
  assert.equal(repasse.amount, "99.9");
  assert.equal(repasse.currency, "BRL");
});

test("a query mantem os parametros que a API exige", async () => {
  let visto = null;
  await new TiktokFinancialAdapters(async (path, options) => { visto = { path, ...options }; return { payments: [] }; })
    .payments({ from: 111, to: 222, pageToken: "t" });
  assert.equal(visto.path, "/finance/202309/payments");
  // `sort_field` obrigatorio aceitando so `create_time` — entrada de 13/08.
  assert.equal(visto.query.sort_field, "create_time");
  assert.equal(visto.query.create_time_ge, 111);
  assert.equal(visto.query.create_time_lt, 222);
  assert.equal(visto.query.page_token, "t");
});
