// Guarda o contrato das chamadas financeiras contra a OAS oficial da TikTok Shop.
//
// Existe porque as tres chamadas foram escritas com `start_time`/`end_time` — nomes que
// nenhuma delas aceita — e sem o `sort_field`, que e obrigatorio nas tres. A API recusava
// com `36009004` em toda execucao e nenhum teste percebia, porque todos exercitavam o
// parser com fixtures e nenhum verificava o que era enviado.
import test from "node:test";
import assert from "node:assert/strict";
import { TiktokFinancialAdapters } from "../src/lib/integrations/tiktokFinancialLedger.ts";

// path -> { janela: [nomeDe, nomeAte], sortField } conforme
// references/oas/paths/finance.json da spec oficial.
const CONTRATO = {
  statements: {
    path: "/finance/202309/statements",
    de: "statement_time_ge",
    ate: "statement_time_lt",
    sortField: "statement_time",
  },
  payments: {
    path: "/finance/202309/payments",
    de: "create_time_ge",
    ate: "create_time_lt",
    sortField: "create_time",
  },
  unsettled: {
    path: "/finance/202507/orders/unsettled",
    de: "search_time_ge",
    ate: "search_time_lt",
    sortField: "order_create_time",
  },
};

async function capturar(metodo) {
  let capturado = null;
  const adapter = new TiktokFinancialAdapters(async (path, options) => {
    capturado = { path, query: (options && options.query) || {} };
    return {};
  });
  await adapter[metodo]({ from: 1000, to: 2000, pageToken: "cursor" }).catch(() => {});
  return capturado;
}

for (const [metodo, esperado] of Object.entries(CONTRATO)) {
  test(`${metodo}: path, janela e sort_field batem com a OAS oficial`, async () => {
    const chamada = await capturar(metodo);
    assert.ok(chamada, `${metodo} nao chamou a API`);
    assert.equal(chamada.path, esperado.path, "versao/path divergem da OAS");

    assert.equal(chamada.query[esperado.de], 1000, `janela deve usar ${esperado.de}`);
    assert.equal(chamada.query[esperado.ate], 2000, `janela deve usar ${esperado.ate}`);

    // sort_field e obrigatorio nas tres e aceita um unico valor por endpoint.
    assert.equal(chamada.query.sort_field, esperado.sortField, "sort_field ausente ou invalido");

    // start_time/end_time nao existem em nenhuma das tres: sao a causa do 36009004.
    assert.equal(chamada.query.start_time, undefined, "start_time nao existe nesta API");
    assert.equal(chamada.query.end_time, undefined, "end_time nao existe nesta API");

    const pageSize = Number(chamada.query.page_size);
    assert.ok(pageSize >= 1 && pageSize <= 100, "page_size fora do intervalo [1-100]");
  });
}
