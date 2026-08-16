import test from "node:test";
import assert from "node:assert/strict";
import { auditarFrete, freteCobrado, TOLERANCIA } from "../src/lib/integrations/mercadoLivreAuditoria.ts";

// Caso REAL da conta 1191100170, colhido em 16/08/2026. Pedido único, sem pack,
// um item, um envio, um pagamento — verificado antes de tratar como divergência:
//
//   shipment senders[0].cost = 6,65   (o que o vendedor deveria pagar)
//   charges_details shipping = 15,64  (o que o MP descontou)
//   paid_amount − total_amount = 8,99 (o que o COMPRADOR pagou de frete)
//
// A diferença é exatamente o frete do comprador: o vendedor foi cobrado como se
// o frete dele também fosse do vendedor.

const REAL = {
  id: 174148057876,
  orderId: "2000017962602834",
  status: "approved",
  transactionAmount: 39.9,
  netReceived: 28.26,
  paidAt: "2026-08-16T09:12:00.000-03:00",
  charges: [
    { name: "shp_fulfillment", type: "shipping", amounts: { original: 15.64 } },
    { name: "mp_financing_1x_fee", type: "fee", amounts: { original: 0.05 } },
    { name: "mp_processing_fee", type: "fee", amounts: { original: 1.1 } },
    { name: "ml_sale_fee", type: "fee", amounts: { original: 3.84 } },
  ],
};
const ESPERADO_REAL = { orderId: "2000017962602834", custoVendedor: 6.65, freteCheio: 31.8, shipmentId: "47782747964" };

test("o caso real e detectado com a diferenca exata", () => {
  const r = auditarFrete([REAL], [ESPERADO_REAL]);
  assert.equal(r.pedidos.length, 1);
  assert.equal(r.pedidos[0].esperado, 6.65);
  assert.equal(r.pedidos[0].cobrado, 15.64);
  assert.equal(r.pedidos[0].diferenca, 8.99);
  assert.equal(r.totalACustestar, 8.99);
});

test("so as cobrancas de frete entram na conta", () => {
  // ml_sale_fee e mp_processing_fee sao tarifa, nao frete. Somar tudo daria
  // 20,63 e acusaria divergencia em TODO pedido.
  assert.equal(freteCobrado(REAL.charges), 15.64);
});

test("pedido que bate no centavo nao aparece", () => {
  const ok = { ...REAL, orderId: "X", charges: [{ type: "shipping", amounts: { original: 6.65 } }] };
  const r = auditarFrete([ok], [{ ...ESPERADO_REAL, orderId: "X" }]);
  assert.equal(r.pedidos.length, 0);
  assert.equal(r.comparados, 1, "comparado, mas sem divergencia");
});

test("diferenca de arredondamento fica abaixo da tolerancia", () => {
  const quase = { ...REAL, orderId: "Y", charges: [{ type: "shipping", amounts: { original: 6.66 } }] };
  const r = auditarFrete([quase], [{ ...ESPERADO_REAL, orderId: "Y" }]);
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
  const r = auditarFrete([menor], [{ ...ESPERADO_REAL, orderId: "Z" }]);
  assert.equal(r.pedidos.length, 1);
  assert.equal(r.pedidos[0].diferenca, -4.65);
  assert.equal(r.totalACustestar, 0);
});

test("a maior diferenca vem primeiro", () => {
  const mk = (id, frete) => ({ ...REAL, orderId: id, charges: [{ type: "shipping", amounts: { original: frete } }] });
  const esp = (id) => ({ ...ESPERADO_REAL, orderId: id });
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
