import test from "node:test";
import assert from "node:assert/strict";
import { amazonFinancialCards } from "../src/app/(app)/amazon/amazonFinancialCards.ts";

// ⚠️ O DEFEITO QUE ESTES TESTES REPROVAM — a SEXTA forma da familia "numerador
// de um universo, denominador de outro", medida na Silveiras Import
// (amazon:A15NQMF7A6J1Y0) em 01/09/2026 com a autorizacao da SP-API caida:
//
//   A tela exibia "Faturamento R$ 781,95 · 31 pedidos" — numero que vem do
//   `orderMetrics`, agregado pela propria Amazon — e logo ao lado afirmava
//   "Margem 91,7%", calculada sobre UM pedido: o unico dos 31 que a Amazon
//   valorizou. Os outros 30 chegaram com `gross` 0, `ordered_gross` null e
//   `unit_price` NULL.
//
// Nenhum dos dois numeros estava errado sozinho. O que era falso e a AFIRMACAO
// de que o segundo descreve o periodo do primeiro. E a Ana leu a tela como quem
// le uma margem de dia — que e exatamente para isso que ela existe.
//
// O corte e a MAIORIA: um percentual so descreve o periodo se cobrir mais do que
// omite. Nao e limiar de tolerancia escolhido a dedo — e a fronteira em que a
// frase "a margem do periodo" para de ser verdadeira.

const carta = (cards, key) => cards.find((c) => c.key === key);

const BASE = {
  finance: {
    currency: "BRL", revenue: 781.95, fees: 7.45, refunds: 0, buyerShipping: 0,
    feeBreakdown: [{ type: "Commission", amount: 7.45 }],
  },
  cogs: 18.56,
  estimatedProfit: 716.84,
  unitsWithoutCost: 0,
  faturamentoTotal: 781.95,
  baseDoLucro: 781.95,
};

test("com 30 de 31 pedidos sem valor, a margem NAO e afirmada", () => {
  const cards = amazonFinancialCards({ ...BASE, pedidosSemValor: 30, pedidosNaBase: 31 });
  const margem = carta(cards, "marginPct");
  assert.equal(margem.value, "—", "91,7% descrevia 1 pedido e era lido como o dia inteiro");
  assert.equal(margem.raw, null, "quem consome o bruto tambem nao pode receber a afirmacao");
  assert.equal(margem.tone, "default", "verde/vermelho e afirmacao por outro meio");
});

test("no lugar do percentual entra O QUE FALTA, com os dois numeros", () => {
  const cards = amazonFinancialCards({ ...BASE, pedidosSemValor: 30, pedidosNaBase: 31 });
  const contexto = carta(cards, "marginPct").context;
  assert.match(contexto, /30 de 31/, "sem o denominador nao da para saber se e quase tudo ou quase nada");
  assert.match(contexto, /sem valor publicado pela Amazon/, "o que falta e o VALOR, e quem deve e a Amazon");
  // AGENTS.md: a palavra explica o que a pessoa ja sabe e nao diz o que fazer.
  assert.doesNotMatch(contexto, /parcial|incompleto/i);
});

test("a frase NAO manda cadastrar custo — o custo nao e o que falta", () => {
  // ⚠️ Ela dizia "ainda sem custo e tarifa apurados". Manda a pessoa cadastrar
  // custo que ja esta cadastrado, e esconde a causa real. A tarifa desses
  // pedidos nos ATE temos: 12 dos 13 ASINs do dia ja tinham tarifa observada no
  // proprio extrato.
  const cards = amazonFinancialCards({ ...BASE, pedidosSemValor: 30, pedidosNaBase: 31 });
  assert.doesNotMatch(carta(cards, "marginPct").context, /sem custo e tarifa apurados/);
});

test("cobertura quase total continua afirmando a margem — o conserto nao apaga o numero bom", () => {
  // Medido no mesmo dia, mesma conta, recorte de 30 dias: 1.625 pedidos na base
  // e margem de 21,3%. Suprimir esta seria remover em vez de consertar.
  const cards = amazonFinancialCards({
    ...BASE, revenueProcessed: 34135.56, pedidosSemValor: 30, pedidosNaBase: 1625,
  });
  const margem = carta(cards, "marginPct");
  assert.notEqual(margem.value, "—", "30 de 1.625 nao impede a margem de descrever o periodo");
  assert.notEqual(margem.raw, null);
});

test("na fronteira exata da maioria a margem ainda e afirmada", () => {
  // 15 de 30 e metade, nao maioria: a base cobre tanto quanto omite. A regra
  // suprime quando a base cobre MENOS do que omite.
  const meio = amazonFinancialCards({ ...BASE, pedidosSemValor: 15, pedidosNaBase: 30 });
  assert.notEqual(carta(meio, "marginPct").value, "—");
  const passou = amazonFinancialCards({ ...BASE, pedidosSemValor: 16, pedidosNaBase: 30 });
  assert.equal(carta(passou, "marginPct").value, "—");
});

test("sem pedido nenhum sem valor, nada muda", () => {
  const cards = amazonFinancialCards({ ...BASE, pedidosSemValor: 0, pedidosNaBase: 31 });
  const margem = carta(cards, "marginPct");
  assert.notEqual(margem.value, "—");
  assert.doesNotMatch(margem.context ?? "", /sem valor publicado/);
});

test("o LUCRO continua na tela — o que sai e a afirmacao da margem, nao o resultado", () => {
  // "Consertar nao e remover": ela pediu o lucro do faturamento inteiro, e o
  // lucro continua sendo exibido com a nota do que falta ao lado.
  const cards = amazonFinancialCards({ ...BASE, pedidosSemValor: 30, pedidosNaBase: 31 });
  const lucro = carta(cards, "profit");
  assert.notEqual(lucro.value, "—", "apagar o lucro seria remover, nao consertar");
  assert.match(lucro.baseDeclarada ?? "", /30 de 31/, "e a nota diz o tamanho do que falta");
});
