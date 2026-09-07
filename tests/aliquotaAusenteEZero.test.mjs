import test from "node:test";
import assert from "node:assert/strict";
import { amazonTaxAmount } from "../src/lib/integrations/amazonSettings.ts";
import { calculateTiktokFinancialV2 } from "../src/lib/integrations/tiktokFinancialV2.ts";

// ⚠️ ADR-038 — ALIQUOTA AUSENTE ENTRA COMO ZERO, e a fronteira e o teste.
//
// Decisao da dona do produto em 07/09/2026, verbatim: *"nesse caso, ausencia e
// zero mesmo"*. E excecao NOMEADA ao `null != 0`, e o motivo esta na ADR: o
// dado e DELA (nao do marketplace), ela resolve num campo, e existe default
// honesto — sem aliquota declarada, nada incide.
//
// 🔴 A ARMADILHA QUE ESTE ARQUIVO EXISTE PARA COBRIR: depois desta mudanca,
// **quem cadastrou 0% e quem nao cadastrou produzem a MESMA conta.** Os numeros
// sao identicos, byte a byte. Um cenario com apenas UM dos dois lados passa
// verde com a regra errada nos dois — e o unico sinal que os separa e
// `taxRateKnown`.
//
// Por isso cada caso aqui tem os DOIS lados fabricados, e a assercao que
// distingue e sempre sobre o SINAL, nunca sobre o valor.

test("Amazon: os dois lados da fronteira", async (t) => {
  await t.test("🔴 sem aliquota o imposto e ZERO, nao desconhecido", () => {
    assert.equal(amazonTaxAmount(100, null), 0);
  });
  await t.test("aliquota 0% declarada tambem e zero", () => {
    assert.equal(amazonTaxAmount(100, 0), 0);
  });
  await t.test("🔴 e os dois sao IGUAIS — e e assim mesmo", () => {
    // Se algum dia isto ficar vermelho porque alguem "consertou" a diferenca,
    // leia a ADR-038 antes: a igualdade e a decisao, nao o defeito.
    assert.equal(amazonTaxAmount(100, null), amazonTaxAmount(100, 0));
  });
  await t.test("🔴 aliquota CADASTRADA continua exata — 5% da Silveiras", () => {
    // A excecao nao pode contaminar quem configurou: 5% sobre 425,18 sao
    // R$ 21,26, o numero que a Ana conferiu em 04/09.
    assert.equal(amazonTaxAmount(425.18, 5), 21.26);
    assert.equal(amazonTaxAmount(100, 5), 5);
  });
  await t.test("faturamento negativo continua sem gerar imposto a favor", () => {
    // A excecao e sobre a ALIQUOTA ausente, nao sobre a base. Imposto negativo
    // seria credito tributario inventado, e isso nao mudou.
    assert.equal(amazonTaxAmount(-50, 5), 0);
  });
});

// Forma real do `FinancialOrderInput`: o custo vem por ITEM, nao agregado.
const pedido = (over = {}) => ({
  revenue: 100, buyerShipping: 0, statementSettled: true, fees: 10,
  sellerShipping: 0, ads: 0, taxesWithheld: 0, refunds: 0,
  items: [{ quantity: 1, unitCost: 10 }], ...over,
});
const calc = (taxRate) => calculateTiktokFinancialV2({
  periodCovered: true, taxRate, orders: [pedido()],
}).overview;

test("TikTok: mesma conta, sinais diferentes", async (t) => {
  const semCadastro = calc(null);
  const isento = calc(0);
  const comAliquota = calc(5);

  await t.test("🔴 o VALOR e identico nos dois lados", () => {
    assert.equal(semCadastro.tax, 0);
    assert.equal(isento.tax, 0);
    assert.equal(semCadastro.profit, isento.profit,
      "o lucro tambem tem de ser igual — a incidencia e a mesma");
  });

  await t.test("🔴 o SINAL e a UNICA diferenca", () => {
    assert.equal(semCadastro.taxRateKnown, false, "ninguem cadastrou: a pendencia fica");
    assert.equal(isento.taxRateKnown, true, "declarou 0%: nao ha o que apontar");
    assert.notEqual(semCadastro.taxRateKnown, isento.taxRateKnown);
  });

  await t.test("🔴 o lucro EXISTE para quem nunca configurou", () => {
    // Era o custo real da regra antiga: travessao em lucro e margem de quem so
    // nao preencheu um campo. 100 − 10 de tarifa − 10 de custo − 0 = 80.
    assert.equal(semCadastro.profit, 80);
    assert.notEqual(semCadastro.marginPct, null);
  });

  await t.test("🔴 aliquota cadastrada continua exata e MUDA a conta", () => {
    // Sem esta, "zero sempre" passaria verde: 5% de 100 = 5, lucro 75.
    assert.equal(comAliquota.tax, 5);
    assert.equal(comAliquota.profit, 75);
    assert.equal(comAliquota.taxRateKnown, true);
  });
});
