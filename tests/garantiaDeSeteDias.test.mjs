import test from "node:test";
import assert from "node:assert/strict";
import { decidirReembolso, DIAS_DE_GARANTIA } from "../src/lib/billing/garantiaDeSeteDias.ts";

// GARANTIA DE 7 DIAS — modelo v3 da dona do produto, 07/09/2026.
//
// ⚠️ FRONTEIRAS FABRICADAS, e nao "os dados que a conta tem hoje". A conta nao
// tem NENHUMA assinatura: um teste que so olhasse o banco ficaria verde com a
// regra errada dos dois lados da janela. E o irmao do defeito da faixa de
// comissao de 01/09/2026, onde todos os produtos custavam menos que o teto.

const DIA = 86_400_000;
const AGORA = new Date("2026-09-07T12:00:00.000Z");
const haDias = (n) => new Date(AGORA.getTime() - n * DIA);
const decidir = (extra) => decidirReembolso({ jaReembolsado: false, agora: AGORA, ...extra });

test("dia 6 reembolsa; dia 8 nao", () => {
  assert.equal(decidir({ primeiraCobrancaEm: haDias(6) }).reembolsar, true);
  assert.equal(decidir({ primeiraCobrancaEm: haDias(8) }).reembolsar, false);
});

test("a fronteira exata: 7 dias entra, um instante depois nao", () => {
  // "<= 7 dias" foi a ordem. Testado dos DOIS lados porque um `<` no lugar de
  // um `<=` nao muda nenhum caso real de hoje e so aparece em quem cancelar no
  // ultimo dia — exatamente quem mais tem motivo para reclamar.
  assert.equal(decidir({ primeiraCobrancaEm: haDias(DIAS_DE_GARANTIA) }).reembolsar, true);
  const umPoucoDepois = new Date(AGORA.getTime() - DIAS_DE_GARANTIA * DIA - 1000);
  assert.equal(decidir({ primeiraCobrancaEm: umPoucoDepois }).reembolsar, false);
});

test("cancelar no mesmo dia reembolsa", () => {
  const d = decidir({ primeiraCobrancaEm: AGORA });
  assert.equal(d.reembolsar, true);
  assert.equal(d.diasDesdeACobranca, 0);
});

test("RENOVACAO nao reabre a garantia", () => {
  // O defeito que isto reprova: se a janela contasse da ULTIMA cobranca, no 13o
  // mes cancelar no dia seguinte a fatura devolveria o dinheiro, e a assinatura
  // seria reembolsavel para sempre. A entrada se chama `primeiraCobrancaEm`
  // justamente para que passar a fatura recorrente seja um erro visivel.
  const assinouHaUmAno = haDias(365);
  assert.equal(decidir({ primeiraCobrancaEm: assinouHaUmAno }).reembolsar, false);
  assert.equal(decidir({ primeiraCobrancaEm: assinouHaUmAno }).motivo, "fora-da-garantia");
});

test("evento reentregue NAO reembolsa duas vezes", () => {
  // A Stripe reentrega, e a reentrega pode chegar dias depois. Dinheiro
  // devolvido duas vezes por um cancelamento so nao deixa nada vermelho.
  const d = decidirReembolso({ primeiraCobrancaEm: haDias(1), jaReembolsado: true, agora: AGORA });
  assert.equal(d.reembolsar, false);
  assert.equal(d.motivo, "ja-reembolsado");
});

test("reentrega com cobranca datada no FUTURO tambem nao reembolsa de novo", () => {
  // ⚠️ ESTE TESTE NASCEU DE UM TESTE MEU QUE ERA DECORACAO. O anterior afirmava
  // que "a idempotencia vem antes da janela" e ficou VERDE quando eu moveu a
  // checagem para depois — porque todos os ramos da janela ja devolviam false,
  // entao a ordem nao mudava desfecho nenhum. A ordem so pesa contra o UNICO
  // ramo que devolve `true` cedo: a cobranca com data no futuro. Se a
  // idempotencia ficar depois dele, um evento reentregue com fatura pre-datada
  // reembolsa segunda vez.
  const futuro = new Date(AGORA.getTime() + DIA);
  const d = decidirReembolso({ primeiraCobrancaEm: futuro, jaReembolsado: true, agora: AGORA });
  assert.equal(d.reembolsar, false);
  assert.equal(d.motivo, "ja-reembolsado");
});

test("sem saber a data da cobranca, NAO reembolsa sozinho", () => {
  // Devolver dinheiro por engano e irreversivel do nosso lado; nao devolver e
  // uma conversa. O desfecho fica registrado para alguem olhar.
  const d = decidir({ primeiraCobrancaEm: null });
  assert.equal(d.reembolsar, false);
  assert.equal(d.motivo, "sem-cobranca-conhecida");
});

test("cobranca com data no futuro nao vira garantia vencida", () => {
  // Relogio torto ou fatura pre-datada nao pode recusar quem acabou de pagar.
  const d = decidir({ primeiraCobrancaEm: new Date(AGORA.getTime() + DIA) });
  assert.equal(d.reembolsar, true);
});
