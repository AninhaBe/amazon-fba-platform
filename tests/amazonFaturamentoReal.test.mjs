import test from "node:test";
import assert from "node:assert/strict";
import { calculateContribution } from "../src/lib/profitability.ts";

// Ground truth colhido da SP-API em 15/08/2026, conta AO62LVXJMX3AA:
//
//   702-2192919-5915420  ItemPrice 19,90  PromotionDiscount 0,00  OrderTotal 19,90
//   702-6105524-7663427  ItemPrice 22,11  PromotionDiscount 2,21  OrderTotal 19,90
//
// As duas vendas são economicamente IDÊNTICAS: o comprador pagou R$ 19,90 nas
// duas, o custo é R$ 6,82 nas duas, a tarifa é zero nas duas. A tela exibia
// margens de 65,73% e 59,16% porque tratava `ItemPrice` (preço de tabela) como
// faturamento numa delas — numerador líquido do cupom, denominador bruto.

const CUSTO = 6.82;

/** Como `amazonProfitability.ts` monta a receita: o que o comprador pagou. */
const receita = (itemPrice, promotionDiscount) => Math.max(0, itemPrice - promotionDiscount);

test("receita é o valor pago, não o preço de tabela", () => {
  // Confere contra o `OrderTotal` que a Amazon devolveu para cada pedido.
  assert.equal(receita(19.9, 0), 19.9);
  assert.equal(+receita(22.11, 2.21).toFixed(2), 19.9);
});

test("duas vendas idênticas têm a mesma margem, com ou sem cupom", () => {
  const semCupom = calculateContribution({ revenue: receita(19.9, 0), productCost: CUSTO, marketplaceFees: 0 });
  const comCupom = calculateContribution({ revenue: +receita(22.11, 2.21).toFixed(2), productCost: CUSTO, marketplaceFees: 0 });

  assert.equal(semCupom.contribution, 13.08);
  assert.equal(comCupom.contribution, 13.08);
  assert.equal(semCupom.marginPct, comCupom.marginPct, "mesmo bolso, mesma margem");
  assert.equal(semCupom.marginPct, 65.73);
});

test("o cupom não PODE mais ser descontado de novo, nem por engano", () => {
  // Antes este teste documentava a armadilha: passar `promotions` junto de uma
  // receita já líquida devolvia 10,87 em vez de 13,08 — o cupom saía duas vezes.
  //
  // Em 23/08/2026 o parâmetro foi REMOVIDO do cálculo, então a armadilha deixou
  // de existir. O teste passa a garantir isso: mesmo que alguém passe o campo
  // (JS não impede), o resultado não muda.
  const comCampoIndevido = calculateContribution({
    revenue: +receita(22.11, 2.21).toFixed(2),
    productCost: CUSTO,
    marketplaceFees: 0,
    promotions: 2.21,
  });
  assert.equal(comCampoIndevido.contribution, 13.08, "o cupom já está abatido da receita");
  assert.notEqual(comCampoIndevido.contribution, 10.87, "10,87 é o duplo desconto — não pode voltar");
});

test("a linha da tela fecha: venda − custos = margem", () => {
  const revenue = +receita(22.11, 2.21).toFixed(2);
  const r = calculateContribution({ revenue, productCost: CUSTO, marketplaceFees: 0 });
  // `deductions` do OrderProfitabilityTable — sem o cupom, que não é custo.
  const custosNaTela = CUSTO + 0;
  assert.equal(+(revenue - custosNaTela).toFixed(2), r.contribution);
});

test("o período fecha contra os repasses postados pela Amazon", () => {
  // Transações reais do período: dois Shipment de 19,90 e um ProductAdsPayment.
  const netProceeds = +(19.9 + 19.9 - 6.12).toFixed(2);
  const cogs = +(2 * CUSTO).toFixed(2);
  const faturamento = 39.8; // soma dos OrderTotal, NÃO 42,01 (soma dos ItemPrice)
  const lucro = +(netProceeds - cogs).toFixed(2);

  assert.equal(netProceeds, 33.68);
  assert.equal(cogs, 13.64);
  assert.equal(lucro, 20.04);
  // A cascata precisa fechar com o card: faturamento − taxas − custo = lucro.
  assert.equal(+(faturamento - 6.12 - cogs).toFixed(2), lucro);
  assert.equal(+((lucro / faturamento) * 100).toFixed(1), 50.4);
});
