import test from "node:test";
import assert from "node:assert/strict";
import { amazonFinancialCards } from "../src/app/(app)/amazon/amazonFinancialCards.ts";

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
  // ⚠️ `cogs` SAIU DESTA LISTA EM 01/09/2026, e a intenção anterior fica escrita.
  //
  // O guard apagava TODOS os cards quando a Amazon não tinha postado repasse de
  // nenhum pedido. Medido às 11:38 na conta dela: Faturamento em BRANCO enquanto
  // o card "Pedidos feitos" logo abaixo exibia R$ 348,07 — o MESMO número do
  // Seller Central. O número certo estava na tela e o card que ela olha estava
  // vazio. É o estado normal de uma manhã: tudo pendente, nada liquidado.
  //
  // O guard continua certo para o que vem do EXTRATO. Faturamento é a base de
  // PEDIDOS e custo é CADASTRO DELA — nenhum dos dois depende de a Amazon ter
  // liquidado. Apagar o custo que ela mesma preencheu porque a Amazon não pagou
  // ainda é esconder o trabalho dela.
  for (const chave of ["fees", "profit", "marginPct", "roiPct", "refunds"]) {
    const c = carta(cards, chave);
    assert.equal(c.value, "—", `"${c.label}" mostrou ${c.value} em vez de desconhecido`);
  }
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

test("🔑 o FATURAMENTO nao pode sumir por falta de repasse — ele nao vem do extrato", () => {
  // O defeito de 01/09/2026, com o numero que ele teve: Faturamento em branco e
  // "Pedidos feitos" R$ 348,07 na linha de baixo, batendo com o Seller Central.
  //
  // Desfazer a correcao (tirar o `true` do ultimo argumento de `num` no card de
  // revenue) reprova aqui.
  const cards = amazonFinancialCards({
    finance: SEM_REPASSE,
    cogs: 16.39,
    estimatedProfit: null,
    unitsWithoutCost: 0,
    taxRate: null,
    taxes: null,
    faturamentoTotal: 348.07,
    baseDoLucro: 348.07,
  });
  const faturamento = carta(cards, "revenue");
  assert.equal(faturamento.raw, 348.07, "o faturamento sumiu numa manha de pedidos pendentes");
  assert.match(faturamento.value, /348,07/);
  // ⚠️ E o rotulo nao pode prometer conciliacao que nao houve.
  assert.doesNotMatch(faturamento.context, /conciliado/i);
  assert.match(faturamento.context, /todos os pedidos/i);
  // O custo cadastrado por ela tambem aparece.
  assert.equal(carta(cards, "cogs").raw, 16.39);
  // E o que DEPENDE do extrato continua desconhecido, pelo motivo certo.
  assert.equal(carta(cards, "fees").value, "—");
  assert.match(carta(cards, "fees").context, /repasse postado/i);
});
