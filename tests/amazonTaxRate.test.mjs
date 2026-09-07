import test from "node:test";
import assert from "node:assert/strict";
import {
  amazonTaxAmount,
  amazonTaxRateSettingKey,
  normalizeAmazonTaxRate,
  parseAmazonTaxRateSetting,
} from "../src/lib/integrations/amazonSettings.ts";

// A Amazon não informa imposto — não conhece o regime tributário de quem vende.
// Sem alíquota declarada, o lucro da Amazon saía SEM imposto enquanto o do
// Mercado Livre saía COM, e comparar os dois canais no painel era injusto: o
// mesmo produto pelo mesmo preço parecia mais rentável na Amazon.
//
// Segue o desenho da Shopee, não o do ML: o ML faz `Number(metadata.taxRate ?? 0)`
// e transforma "não configurado" em "0%", que é a confusão entre null e zero
// que o projeto proíbe.

test("nao configurado VIRA zero — e o sinal e que separa os dois casos", () => {
  // ⚠️ ESTE TESTE MUDOU DE INTENCAO EM 07/09/2026, e a versao anterior estava
  // CERTA no mundo anterior. Ele exigia `amazonTaxAmount(x, null) === null`
  // ("sem aliquota o imposto e desconhecido"), e isso valeu ate a dona do
  // produto decidir o contrario, verbatim: *"nesse caso, ausencia e zero
  // mesmo"* (ADR-038). O motivo esta la: o dado e DELA, ela resolve num campo,
  // e existe default honesto — travessao apagava lucro e margem inteiros de
  // quem so nao preencheu.
  //
  // ⚠️ E A FRONTEIRA QUE ISSO CRIA E O QUE ESTE TESTE PASSA A GUARDAR: quem
  // cadastrou 0% e quem nao cadastrou produzem a MESMA conta. Os dois valores
  // sao identicos de proposito; quem os separa e `taxRateKnown`, que viaja no
  // payload. Testar so o numero aqui nao provaria nada.
  assert.equal(amazonTaxAmount(39.8, null), 0, "sem aliquota, nada incide (ADR-038)");
  assert.equal(amazonTaxAmount(39.8, 0), 0, "isencao declarada tambem e zero");
  // O par indistinguivel, dito na cara: mesmo numero, e e isso mesmo.
  assert.equal(amazonTaxAmount(39.8, null), amazonTaxAmount(39.8, 0));
});

test("o imposto incide sobre o faturamento", () => {
  // 6% sobre os R$ 39,80 conciliados do período.
  assert.equal(amazonTaxAmount(39.8, 6), 2.39);
  // E derruba o lucro de 20,04 para 17,65 — o numero que sobra de verdade.
  assert.equal(+(20.04 - 2.39).toFixed(2), 17.65);
});

test("faturamento negativo nao gera imposto a favor", () => {
  // Periodo dominado por estorno pode zerar/negativar a receita; imposto
  // negativo seria credito tributario inventado.
  assert.equal(amazonTaxAmount(-50, 6), 0);
});

test("aliquota fora da faixa e recusada", () => {
  for (const invalido of [-1, 101, Number.NaN, Number.POSITIVE_INFINITY, "6", null, undefined]) {
    assert.equal(normalizeAmazonTaxRate(invalido), null, `${String(invalido)} nao pode virar aliquota`);
  }
  assert.equal(normalizeAmazonTaxRate(0), 0);
  assert.equal(normalizeAmazonTaxRate(6.5), 6.5);
  assert.equal(normalizeAmazonTaxRate(100), 100);
});

test("o corpo da requisicao distingue limpar de nao enviar", () => {
  assert.deepEqual(parseAmazonTaxRateSetting({ taxRate: null }), { valid: true, value: null });
  assert.deepEqual(parseAmazonTaxRateSetting({ taxRate: 6 }), { valid: true, value: 6 });
  assert.deepEqual(parseAmazonTaxRateSetting({ taxRate: 0 }), { valid: true, value: 0 });
  // Sem o campo, nao da para saber a intencao — recusa em vez de assumir.
  assert.deepEqual(parseAmazonTaxRateSetting({}), { valid: false });
  assert.deepEqual(parseAmazonTaxRateSetting(undefined), { valid: false });
  assert.deepEqual(parseAmazonTaxRateSetting({ taxRate: "6" }), { valid: false }, "string nao passa");
  assert.deepEqual(parseAmazonTaxRateSetting({ taxRate: 120 }), { valid: false });
});

test("a chave e por conta, para nao vazar aliquota entre contas", () => {
  // A pessoa pode ter mais de uma conta Amazon, em regimes diferentes.
  assert.equal(amazonTaxRateSettingKey("AO62LVXJMX3AA"), "amazon:tax_rate:AO62LVXJMX3AA");
  assert.notEqual(amazonTaxRateSettingKey("AO62LVXJMX3AA"), amazonTaxRateSettingKey("A15NQMF7A6J1Y0"));
});
