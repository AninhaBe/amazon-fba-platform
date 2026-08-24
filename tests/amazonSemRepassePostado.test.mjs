import test from "node:test";
import assert from "node:assert/strict";
import { amazonFinancialCards } from "../src/app/amazon/amazonFinancialCards.ts";

// ZERO SEM REPASSE POSTADO É AUSÊNCIA, NÃO FATO.
//
// Ela viu em 24/08/2026: um pedido de R$ 21,90 aguardando pagamento, e a tela
// mostrando "Custo dos produtos R$ 0,00" e "Lucro R$ 0,00". O painel ao lado já
// dizia a verdade em prosa — "A Amazon ainda não postou repasse deste período" —
// enquanto os cards afirmavam que não houve custo nem lucro.
//
// É o `null ≠ 0` do AGENTS.md: "não cobraram" e "ainda não sei" davam o mesmo
// número na tela.

const carta = (cards, chave) => cards.find((c) => c.key === chave);

const SEM_REPASSE = {
  currency: "BRL",
  revenue: 0,
  fees: 0,
  refunds: 0,
  buyerShipping: 0,
  feeBreakdown: [],
  orderCount: 0,
};

test("sem repasse postado, os valores derivados sao desconhecidos", () => {
  const cards = amazonFinancialCards({
    finance: SEM_REPASSE,
    cogs: 0,
    estimatedProfit: 0,
    unitsWithoutCost: 0,
    taxRate: null,
    taxes: null,
  });
  for (const chave of ["fees", "cogs", "profit", "marginPct", "roiPct", "refunds"]) {
    const c = carta(cards, chave);
    assert.equal(c.value, "—", `"${c.label}" mostrou ${c.value} em vez de desconhecido`);
  }
  assert.match(carta(cards, "cogs").context, /repasse postado/i);
  assert.match(carta(cards, "profit").context, /repasse postado/i);
});

test("COM repasse postado, zero volta a ser fato explicado", () => {
  // A promoção de vendedor novo realmente zera comissão e logística. Quando há
  // pedido postado, esse zero é notícia e tem que aparecer — não pode virar "—".
  const cards = amazonFinancialCards({
    finance: {
      currency: "BRL",
      revenue: 100,
      fees: 0,
      refunds: 0,
      buyerShipping: 0,
      feeBreakdown: [{ type: "Commission", amount: 0 }],
      orderCount: 3,
    },
    cogs: 40,
    estimatedProfit: 60,
    unitsWithoutCost: 0,
    taxRate: null,
    taxes: null,
  });
  // Compara pelo bruto: o Intl usa espaço NÃO-QUEBRÁVEL depois do "R$", e a
  // comparação por texto falha de um jeito que parece igual na tela.
  assert.equal(carta(cards, "fees").raw, 0);
  assert.notEqual(carta(cards, "fees").value, "—");
  assert.match(carta(cards, "commission").context, /não cobrou comissão/i);
  assert.equal(carta(cards, "cogs").raw, 40);
  assert.equal(carta(cards, "profit").raw, 60);
});

test("origem que nao informa orderCount continua funcionando como antes", () => {
  const { orderCount, ...semContagem } = SEM_REPASSE;
  const cards = amazonFinancialCards({
    finance: { ...semContagem, revenue: 100, fees: 10 },
    cogs: 40,
    estimatedProfit: 50,
    unitsWithoutCost: 0,
    taxRate: null,
    taxes: null,
  });
  assert.equal(carta(cards, "profit").raw, 50, "a trava não pode disparar sem a contagem");
});
