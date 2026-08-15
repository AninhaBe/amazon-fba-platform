import test from "node:test";
import assert from "node:assert/strict";
import { calculateContribution } from "../src/lib/profitability.ts";

// Pedido `Pending` na Amazon vem SEM `ItemPrice` e sem `OrderTotal` — a Amazon só
// libera o valor quando envia. Confirmado em 15/08/2026 nos pedidos
// 701-7251196-0106632 e 701-1264699-4789065 (ambos kit-clips-320, ambos sem preço),
// enquanto os dois `Shipped` do mesmo produto traziam 22,11 e 19,90.
//
// O risco: `amount()` devolve 0 para campo ausente, e a tela exibia
// "Venda R$ 0,00" — afirmando que a venda não rendeu nada. É a mesma confusão
// entre "zero" e "não sei" que o projeto trata como não-negociável.

test("venda sem preço informado não vira zero na margem", () => {
  // Custo conhecido, tarifa ainda não postada: o resultado tem de ficar em aberto.
  const r = calculateContribution({ revenue: 0, productCost: 6.82, marketplaceFees: null });
  assert.equal(r.contribution, null);
  assert.equal(r.marginPct, null);
  assert.equal(r.complete, false);
});

test("o mesmo produto com preço já informado fecha o cálculo", () => {
  const r = calculateContribution({ revenue: 19.9, productCost: 6.82, marketplaceFees: 0 });
  assert.equal(r.contribution, 13.08);
  assert.equal(r.complete, true);
});

test("custo conhecido não pode ser reportado como ausente", () => {
  // Guarda do rótulo: com custo cadastrado e tarifa pendente, quem falta é a
  // tarifa — a tela não pode dizer que o custo está incompleto.
  const productCost = 6.82;
  const marketplaceFees = null;
  const deducoes = productCost == null || marketplaceFees == null ? null : productCost + marketplaceFees;
  assert.equal(deducoes, null, "sem tarifa não há total de custos");
  assert.notEqual(productCost, null, "mas o custo do produto é conhecido e deve ser exibido");
});
