import test from "node:test";
import assert from "node:assert/strict";
import { calcularSaldoML } from "../src/lib/integrations/mercadoPagoBalance.ts";

// Payloads REAIS da API do Mercado Pago, conta 648425194, colhidos em 15/08/2026.
// A API abre com o MESMO token do ML — só muda o host para api.mercadopago.com.
//
// Um pagamento de 15/08 só libera em 13/09: quase 30 dias em que o dinheiro
// aparece como lucro no painel e não está na conta de ninguém. É a mesma
// pergunta que o bloco da Amazon responde, e sem esta tela o ML não respondia.

const AGORA = new Date("2026-08-15T21:00:00Z");

const PAGO_RETIDO = {
  id: 173015808309, status: "approved", money_release_status: "pending",
  money_release_date: "2026-09-13T00:42:51.000-04:00",
  transaction_amount: 35.33,
  transaction_details: { net_received_amount: 24.62 },
};
const PAGO_LIBERADO = {
  id: 172579192629, status: "approved",
  money_release_date: "2026-08-10T13:10:00.000-04:00",
  transaction_amount: 36.9,
  transaction_details: { net_received_amount: 26.1 },
};
const PAGO_RECUSADO = {
  id: 172494683283, status: "rejected", money_release_date: null,
  transaction_amount: 36.9, transaction_details: { net_received_amount: null },
};

test("o saldo usa o BRUTO, porque o liquido da API nao e confiavel", () => {
  // Medido em 16/08/2026: `net_received_amount` as vezes ja inclui o credito do
  // frete pago pelo comprador e as vezes nao, sem nada na resposta que distinga.
  //   venda 36,90 · tarifas 22,43 · net 26,01 · receiver 0    -> 14,47 != 26,01
  //   venda 36,90 · tarifas 21,88 · net 26,01 · receiver 10,99 -> somar daria 37,00
  // Numero certo com rotulo certo vale mais que liquido inventado.
  const s = calcularSaldoML([PAGO_RETIDO], { agora: AGORA });
  assert.equal(s.retido, 35.33, "bruto: o que o comprador pagou");
  assert.notEqual(s.retido, 24.62, "nao usar net_received_amount");
});

test("pagamento recusado nao vira dinheiro retido", () => {
  // Chega com money_release_date null; conta-lo inventaria um recebimento.
  const s = calcularSaldoML([PAGO_RETIDO, PAGO_RECUSADO], { agora: AGORA });
  assert.equal(s.retido, 35.33);
  assert.equal(s.pagamentosLidos, 1);
});

test("liberacao passada nao entra no retido", () => {
  const s = calcularSaldoML([PAGO_RETIDO, PAGO_LIBERADO], { agora: AGORA });
  assert.equal(s.retido, 35.33);
  assert.equal(s.liberadoNaJanela, 36.9);
  assert.equal(s.liberacoes.length, 1, "so a futura entra no cronograma");
});

test("liberacoes do mesmo dia viram uma linha", () => {
  const outro = { ...PAGO_RETIDO, id: 999, transaction_amount: 10 };
  const s = calcularSaldoML([PAGO_RETIDO, outro], { agora: AGORA });
  assert.equal(s.liberacoes.length, 1);
  assert.equal(s.liberacoes[0].amount, 45.33);
  assert.equal(s.liberacoes[0].pagamentos, 2);
});

test("as liberacoes saem da mais proxima para a mais distante", () => {
  const cedo = { ...PAGO_RETIDO, id: 1, money_release_date: "2026-08-22T13:10:00.000-04:00" };
  const s = calcularSaldoML([PAGO_RETIDO, cedo], { agora: AGORA });
  assert.deepEqual(s.liberacoes.map((l) => l.date), ["2026-08-22", "2026-09-13"]);
});

test("sem valor informado o pagamento e omitido", () => {
  const semValor = { ...PAGO_RETIDO, id: 2, transaction_amount: null };
  const s = calcularSaldoML([semValor], { agora: AGORA });
  assert.equal(s.retido, 0);
  assert.equal(s.pagamentosLidos, 0);
});

test("leitura truncada precisa se declarar parcial", () => {
  // A conta 1191100170 tem 3.233 pagamentos a liberar; lemos as 600 liberacoes
  // mais proximas. Exibir esse total como se fosse tudo faria a pessoa planejar
  // caixa com um numero MENOR que a realidade.
  const s = calcularSaldoML([PAGO_RETIDO], { agora: AGORA, totalDaBusca: 3233 });
  assert.equal(s.parcial, true);
  assert.equal(s.pagamentosLidos, 1);
  assert.equal(s.pagamentosTotais, 3233);
});

test("leitura completa nao se declara parcial", () => {
  const s = calcularSaldoML([PAGO_RETIDO], { agora: AGORA, totalDaBusca: 1 });
  assert.equal(s.parcial, false);
});
