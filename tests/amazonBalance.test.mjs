import test from "node:test";
import assert from "node:assert/strict";
import { calcularSaldo } from "../src/lib/amazonBalance.ts";

// Medido na SP-API em 15/08/2026, conta AO62LVXJMX3AA. Os dois Shipment estão
// DEFERRED com `maturityDate`; só a despesa de anúncios está RELEASED — é por
// isso que o app da Amazon mostrava "Fundos disponíveis: −R$ 6,12" enquanto o
// dashboard mostrava lucro de R$ 20,04. Ambos certos.
const GRUPOS = [
  { processingStatus: "Open", originalTotal: { currencyAmount: 0, currencyCode: "BRL" }, startDate: "2026-07-05T04:02:01Z" },
  { processingStatus: "Open", originalTotal: { currencyAmount: -6.12, currencyCode: "BRL" }, startDate: "2026-07-05T04:02:02Z" },
];
const TRANSACOES = [
  { status: "DEFERRED", amount: 19.9, currency: "BRL", orderId: "702-6105524-7663427", maturityDate: "2026-08-24T23:00:00Z", deferralReason: "DD7" },
  { status: "RELEASED", amount: -6.12, currency: "BRL" },
  { status: "DEFERRED", amount: 19.9, currency: "BRL", orderId: "702-2192919-5915420", maturityDate: "2026-08-18T23:00:00Z", deferralReason: "DD7" },
];

test("o disponível reproduz o número do app da Amazon", () => {
  const s = calcularSaldo(GRUPOS, TRANSACOES);
  // A conta tem dois extratos abertos (Mastercard e Boleto); o saldo é a soma.
  assert.equal(s.disponivel, -6.12);
  assert.equal(s.seraCobrado, true, "negativo significa cobrança, não repasse");
});

test("o retido soma só o que a Amazon ainda não liberou", () => {
  const s = calcularSaldo(GRUPOS, TRANSACOES);
  assert.equal(s.retido, 39.8);
  // A despesa RELEASED não pode entrar no retido — ela já está no disponível.
  assert.notEqual(s.retido, 33.68);
});

test("as liberações saem em ordem, da mais próxima para a mais distante", () => {
  const s = calcularSaldo(GRUPOS, TRANSACOES);
  assert.deepEqual(s.liberacoes.map((l) => l.date), ["2026-08-18", "2026-08-24"]);
  assert.equal(s.liberacoes[0].amount, 19.9);
  assert.deepEqual(s.liberacoes[0].orderIds, ["702-2192919-5915420"]);
});

test("vendas que caem no mesmo dia viram uma linha só", () => {
  const s = calcularSaldo(GRUPOS, [
    { status: "DEFERRED", amount: 19.9, orderId: "A", maturityDate: "2026-08-18T23:00:00Z" },
    { status: "DEFERRED", amount: 30.1, orderId: "B", maturityDate: "2026-08-18T23:00:00Z" },
  ]);
  assert.equal(s.liberacoes.length, 1, "'dia 18 entram R$ 50,00' lê melhor que duas linhas");
  assert.equal(s.liberacoes[0].amount, 50);
  assert.deepEqual(s.liberacoes[0].orderIds, ["A", "B"]);
});

test("sem extrato devolvido o saldo é desconhecido, não zero", () => {
  const s = calcularSaldo([], TRANSACOES);
  assert.equal(s.disponivel, null, "R$ 0,00 afirmaria que não há nada a receber nem a pagar");
  assert.equal(s.seraCobrado, false, "não dá para anunciar cobrança sem saber o saldo");
  assert.equal(s.retido, 39.8, "mas o retido continua sendo um fato conhecido");
});

test("extrato já fechado não conta como saldo disponível", () => {
  const s = calcularSaldo(
    [...GRUPOS, { processingStatus: "Closed", originalTotal: { currencyAmount: 900 }, startDate: "2026-06-01T00:00:00Z" }],
    TRANSACOES
  );
  assert.equal(s.disponivel, -6.12, "o fechado já foi repassado e não está mais disponível");
  assert.equal(s.extratoDesde, "2026-07-05T04:02:01Z", "e não define o início do extrato aberto");
});

test("saldo positivo não anuncia cobrança", () => {
  const s = calcularSaldo([{ processingStatus: "Open", originalTotal: { currencyAmount: 120.5 }, startDate: "2026-07-05T04:02:01Z" }], []);
  assert.equal(s.seraCobrado, false);
  assert.equal(s.retido, 0);
  assert.deepEqual(s.liberacoes, []);
});

test("transação diferida sem maturityDate entra no retido mas não no cronograma", () => {
  // A Amazon nem sempre devolve o DeferredContext; inventar uma data seria pior
  // que omitir a linha.
  const s = calcularSaldo(GRUPOS, [{ status: "DEFERRED", amount: 42, orderId: "C" }]);
  assert.equal(s.retido, 42);
  assert.deepEqual(s.liberacoes, []);
});

// ── COBRANCAS FECHADAS (12/09/2026, aprovado pela Ana) ──────────────────────
// Cenario medido na conta real em 12/09/2026: dois grupos Closed NEGATIVOS
// (-119,50 fechado em 30/08 e -6,12 fechado em 16/08) com FundTransferStatus
// "Unknown" — extrato que fechou devendo, que a Amazon desconta no proximo
// fechamento. Nenhum dinheiro se moveu.

const COBRANCA_RECENTE = {
  processingStatus: "Closed",
  originalTotal: { currencyAmount: -119.5, currencyCode: "BRL" },
  startDate: "2026-08-16T04:02:02Z",
  endDate: "2026-08-30T04:02:02Z",
  fundTransferStatus: "Unknown",
  fundTransferDate: "2026-08-30T04:02:02Z",
};
const TRANSFERENCIA_ANTIGA = {
  processingStatus: "Closed",
  originalTotal: { currencyAmount: 44.33, currencyCode: "BRL" },
  startDate: "2026-08-01T00:00:00Z",
  endDate: "2026-08-05T00:00:00Z",
  fundTransferStatus: "Succeeded",
  fundTransferDate: "2026-08-05T00:00:00Z",
  accountTail: "991",
};

test("cobranca fechada sai com valor POSITIVO ('quanto SERA cobrado') e a data do fechamento", () => {
  // Reprova o sinal cru: Math.abs na tela e onde o sinal se perde em silencio
  // (contrato com a Vitrine, 12/09/2026).
  const s = calcularSaldo([...GRUPOS, COBRANCA_RECENTE], TRANSACOES);
  assert.deepEqual(s.cobrancasFechadas, [{ valor: 119.5, fechadaEm: "2026-08-30T04:02:02Z" }]);
});

test("a COBRANCA MAIS RECENTE nao vira ultimaTransferencia — cobranca nao e transferencia", () => {
  // Reprova a transferencia que NUNCA EXISTIU: o grupo negativo vem com
  // FundTransferStatus 'Unknown' e data, e se for o mais recente da lista a
  // exclusao e a UNICA coisa que muda o que aparece — e exatamente este caso
  // que o teste cobre (pedido da Vitrine: cobranca no meio da lista passaria
  // sem provar nada).
  const s = calcularSaldo([TRANSFERENCIA_ANTIGA, COBRANCA_RECENTE], TRANSACOES);
  assert.equal(s.ultimaTransferencia.status, "Succeeded");
  assert.equal(s.ultimaTransferencia.valor, 44.33);
});

test("fechadaEm null quando a API omite o fim — 'fechada' sem data, nunca data inventada", () => {
  const s = calcularSaldo([{ ...COBRANCA_RECENTE, endDate: null }], []);
  assert.equal(s.cobrancasFechadas[0].fechadaEm, null);
});

test("extrato ABERTO negativo NAO e cobranca fechada — ele segue em disponivel/seraCobrado", () => {
  // Reprova contar o mesmo debito duas vezes (aberto ja aparece no disponivel).
  const s = calcularSaldo(GRUPOS, TRANSACOES);
  assert.deepEqual(s.cobrancasFechadas, []);
  assert.equal(s.seraCobrado, true);
});
