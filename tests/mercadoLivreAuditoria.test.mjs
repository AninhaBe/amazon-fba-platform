import test from "node:test";
import assert from "node:assert/strict";
import { auditarFrete, freteCobrado, TOLERANCIA } from "../src/lib/integrations/mercadoLivreAuditoria.ts";

// Caso REAL da conta 648425194 (pedido 2000017874507858, pagamento 172276681179),
// colhido em 16/08/2026 — e que provou que a PRIMEIRA versão desta auditoria
// estava errada.
//
// A tela do Mercado Pago mostra a conta inteira:
//   Pagamento do Mercado Envios (por conta do comprador)   R$ 16,99
//   Tarifa por envios no Mercado Livre                    −R$ 23,64
//   Envios (efeito para o vendedor)                       −R$  6,65
//
// O MP debita o frete CHEIO e credita de volta a parte do comprador. Comparar
// `shp_fulfillment` (23,64) direto com `senders[].cost` (6,65) acusava 8
// divergências falsas na conta dela. O esperado é a SOMA das duas pontas.

const REAL = {
  id: 172276681179,
  orderId: "2000017874507858",
  status: "approved",
  transactionAmount: 36.9,
  netReceived: 9.02,
  paidAt: "2026-08-16T09:12:00.000-03:00",
  charges: [
    { name: "shp_fulfillment", type: "shipping", amounts: { original: 23.64 } },
    { name: "mp_processing_fee", type: "fee", amounts: { original: 0.04 } },
    { name: "ml_sale_fee", type: "fee", amounts: { original: 4.2 } },
  ],
};
const ESPERADO_REAL = { orderId: "2000017874507858", custoVendedor: 6.65, custoComprador: 16.99, freteCheio: 51.95, shipmentId: "47782747964" };

test("o caso real NAO e divergencia — as duas pontas fecham", () => {
  // Este e o teste que impede a volta do falso positivo: 6,65 + 16,99 = 23,64.
  const r = auditarFrete([REAL], [ESPERADO_REAL]);
  assert.equal(r.pedidos.length, 0, "cobranca legitima nao pode virar alerta");
  assert.equal(r.comparados, 1);
  assert.equal(r.totalACustestar, 0);
});

test("divergencia REAL e quando nem a soma das duas pontas fecha", () => {
  const cobradoAMais = { ...REAL, charges: [{ type: "shipping", amounts: { original: 30.0 } }] };
  const r = auditarFrete([cobradoAMais], [ESPERADO_REAL]);
  assert.equal(r.pedidos.length, 1);
  assert.equal(r.pedidos[0].esperado, 23.64, "esperado = vendedor + comprador");
  assert.equal(r.pedidos[0].esperadoVendedor, 6.65);
  assert.equal(r.pedidos[0].esperadoComprador, 16.99);
  assert.equal(r.pedidos[0].diferenca, 6.36);
});

test("so as cobrancas de frete entram na conta", () => {
  // ml_sale_fee e mp_processing_fee sao tarifa, nao frete. Somar tudo daria
  // 20,63 e acusaria divergencia em TODO pedido.
  assert.equal(freteCobrado(REAL.charges), 23.64);
});

test("pedido que bate no centavo nao aparece", () => {
  const ok = { ...REAL, orderId: "X", charges: [{ type: "shipping", amounts: { original: 6.65 } }] };
  const r = auditarFrete([ok], [{ ...ESPERADO_REAL, orderId: "X", custoComprador: 0 }]);
  assert.equal(r.pedidos.length, 0);
  assert.equal(r.comparados, 1, "comparado, mas sem divergencia");
});

test("diferenca de arredondamento fica abaixo da tolerancia", () => {
  const quase = { ...REAL, orderId: "Y", charges: [{ type: "shipping", amounts: { original: 6.66 } }] };
  const r = auditarFrete([quase], [{ ...ESPERADO_REAL, orderId: "Y", custoComprador: 0 }]);
  assert.equal(r.pedidos.length, 0, "1 centavo e arredondamento entre duas fontes, nao divergencia");
  assert.equal(TOLERANCIA, 0.01);
});

test("sem shipment conhecido NAO vira divergencia", () => {
  // "Nao sei o frete esperado" viraria "o ML cobrou 15,64 indevidamente".
  const r = auditarFrete([REAL], []);
  assert.equal(r.pedidos.length, 0);
  assert.equal(r.comparados, 0);
  assert.equal(r.semReferencia, 1, "precisa ser contado, para a tela dizer que nao cobriu tudo");
});

test("pagamento recusado nao entra", () => {
  const r = auditarFrete([{ ...REAL, status: "rejected" }], [ESPERADO_REAL]);
  assert.equal(r.pedidos.length, 0);
  assert.equal(r.comparados, 0);
});

test("cobranca a MENOR aparece na lista mas nao no total a contestar", () => {
  // E a favor dela; listar e honesto, cobrar de volta nao faz sentido.
  const menor = { ...REAL, orderId: "Z", charges: [{ type: "shipping", amounts: { original: 2.0 } }] };
  const r = auditarFrete([menor], [{ ...ESPERADO_REAL, orderId: "Z", custoComprador: 0 }]);
  assert.equal(r.pedidos.length, 1);
  assert.equal(r.pedidos[0].diferenca, -4.65);
  assert.equal(r.totalACustestar, 0);
});

test("a maior diferenca vem primeiro", () => {
  const mk = (id, frete) => ({ ...REAL, orderId: id, charges: [{ type: "shipping", amounts: { original: frete } }] });
  const esp = (id) => ({ ...ESPERADO_REAL, orderId: id, custoComprador: 0 });
  const r = auditarFrete(
    [mk("a", 10), mk("b", 100), mk("c", 20)],
    [esp("a"), esp("b"), esp("c")]
  );
  assert.deepEqual(r.pedidos.map((p) => p.orderId), ["b", "c", "a"]);
  assert.equal(r.totalACustestar, round3(3.35 + 13.35 + 93.35));
});

function round3(v) { return +v.toFixed(2); }

test("leitura truncada se declara parcial", () => {
  const r = auditarFrete([REAL], [ESPERADO_REAL], { parcial: true });
  assert.equal(r.parcial, true, "senao a tela afirma 'so 1 divergencia' tendo lido metade");
});

test("sem pagamento nenhum o resultado e vazio, nao erro", () => {
  const r = auditarFrete([], []);
  assert.deepEqual(r.pedidos, []);
  assert.equal(r.totalACustestar, 0);
  assert.equal(r.comparados, 0);
});
