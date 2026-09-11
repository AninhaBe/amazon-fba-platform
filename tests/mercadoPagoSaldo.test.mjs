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

// Pagamento 172276681179 da conta 648425194. A tela do MP mostra "Total a
// receber R$ 26,01" e a formula reproduz: 36,90 − 4,24 − 6,65 = 26,01.
const PAGO_RETIDO = {
  id: 172276681179, status: "approved", money_release_status: "pending",
  money_release_date: "2026-09-13T00:42:51.000-04:00",
  transaction_amount: 36.9,
  freteDoVendedor: 6.65,
  charges: [
    { type: "shipping", amounts: { original: 23.64 } },
    { type: "fee", amounts: { original: 4.2 } },
    { type: "fee", amounts: { original: 0.04 } },
  ],
  transaction_details: { net_received_amount: 9.02 },
};
const PAGO_LIBERADO = {
  id: 172579192629, status: "approved",
  money_release_date: "2026-08-10T13:10:00.000-04:00",
  transaction_amount: 36.9, freteDoVendedor: 6.65,
  charges: [{ type: "fee", amounts: { original: 4.24 } }],
};
const PAGO_RECUSADO = {
  id: 172494683283, status: "rejected", money_release_date: null,
  transaction_amount: 36.9, transaction_details: { net_received_amount: null },
};

test("o liquido reproduz o 'Total a receber' da tela do Mercado Pago", () => {
  // Formula derivada do relatorio de liberacoes e conferida contra a tela:
  //   36,90 (venda) − 4,24 (tarifas) − 6,65 (frete DO VENDEDOR) = 26,01
  const s = calcularSaldoML([PAGO_RETIDO], { agora: AGORA });
  assert.equal(s.retido, 26.01);
});

test("nao usa net_received_amount, que e inconsistente", () => {
  // O campo diz 9,02 neste pagamento e 26,01 em outros identicos, sem regra.
  const s = calcularSaldoML([PAGO_RETIDO], { agora: AGORA });
  assert.notEqual(s.retido, 9.02);
});

test("nao desconta o frete CHEIO, so a parte do vendedor", () => {
  // shp_fulfillment = 23,64 e o cheio; o ML credita de volta a parte do
  // comprador. Descontar 23,64 daria 9,02 — dinheiro que volta, subtraido.
  const s = calcularSaldoML([PAGO_RETIDO], { agora: AGORA });
  assert.equal(s.retido, 26.01);
  assert.notEqual(s.retido, +(36.9 - 4.24 - 23.64).toFixed(2));
});

test("sem o frete do vendedor o pagamento e omitido, nao estimado", () => {
  const semFrete = { ...PAGO_RETIDO, freteDoVendedor: null };
  const s = calcularSaldoML([semFrete], { agora: AGORA });
  assert.equal(s.retido, 0);
  assert.equal(s.pagamentosLidos, 0);
});

test("pagamento recusado nao vira dinheiro retido", () => {
  // Chega com money_release_date null; conta-lo inventaria um recebimento.
  const s = calcularSaldoML([PAGO_RETIDO, PAGO_RECUSADO], { agora: AGORA });
  assert.equal(s.retido, 26.01);
  assert.equal(s.pagamentosLidos, 1);
});

test("liberacao passada nao entra no retido", () => {
  const s = calcularSaldoML([PAGO_RETIDO, PAGO_LIBERADO], { agora: AGORA });
  assert.equal(s.retido, 26.01);
  assert.equal(s.liberadoNaJanela, 26.01);
  assert.equal(s.liberacoes.length, 1, "so a futura entra no cronograma");
});

test("liberacoes do mesmo dia viram uma linha", () => {
  const outro = { ...PAGO_RETIDO, id: 999, transaction_amount: 20, charges: [], freteDoVendedor: 0 };
  const s = calcularSaldoML([PAGO_RETIDO, outro], { agora: AGORA });
  assert.equal(s.liberacoes.length, 1);
  assert.equal(s.liberacoes[0].amount, 46.01);
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

/**
 * ⚠️ DEFEITO ACHADO POR ELA NA TELA, 10/09/2026: *"esses dados
 * fazem sentido?"*. O cartao dizia 276 pagamentos retidos com um extrato de 34
 * — e o "parcial" acendia sem leitura truncada nenhuma.
 *
 * A causa: `parcial` comparava o total da BUSCA com a contagem dos RETIDOS.
 * A busca vai de `agora - 24h` ate `agora + 180d`, entao ela inclui o que ja
 * foi liberado nas ultimas 24 horas. Qualquer pagamento ja liberado fazia
 * `totalDaBusca > pagamentosLidos` e a tela afirmava *"o retido real e maior
 * que o exibido"* — mentira, e a mentira que a regra da casa manda subir na
 * fila na hora.
 *
 * ⚠️ POR QUE A SUITE NAO PEGOU: os dois testes de `parcial`
 * acima usam SO pagamento retido. O caso que quebra a regra — um liberado ao
 * lado de um retido — nunca entrou na amostra. E o irmao do "dado que nao
 * exercita a regra nao testa a regra" do AGENTS.md: nao faltou asserção,
 * faltou o CASO.
 */
test("pagamento ja liberado NAO faz a leitura se declarar parcial", () => {
  const liberado = { ...PAGO_RETIDO, id: 99, money_release_date: new Date(AGORA.getTime() - 3_600_000).toISOString() };
  // Dois pagamentos na janela, os dois lidos: um ja caiu, um ainda cai.
  const s = calcularSaldoML([PAGO_RETIDO, liberado], { agora: AGORA, totalDaBusca: 2 });
  assert.equal(s.parcial, false, "a tela afirma que o retido real e maior sem leitura truncada");
  assert.equal(s.pagamentosLidos, 1, "o retido continua sendo um so");
});

test("a contagem de retidos e a MESMA que a soma do extrato", () => {
  // O cartao "Pagamentos retidos" e a coluna "Pagamentos" da tabela saem do
  // mesmo lugar; se divergirem, a tela se contradiz a si mesma na mesma altura
  // da pagina — que foi exatamente o que ela viu.
  const outroRetido = { ...PAGO_RETIDO, id: 100 };
  const s = calcularSaldoML([PAGO_RETIDO, outroRetido], { agora: AGORA, totalDaBusca: 2 });
  const soma = s.liberacoes.reduce((total, l) => total + l.pagamentos, 0);
  assert.equal(soma, s.pagamentosLidos, "o cartao e o extrato deixaram de contar a mesma coisa");
});
