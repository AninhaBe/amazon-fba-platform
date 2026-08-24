import test from "node:test";
import assert from "node:assert/strict";
import {
  auditarFreteTiktok,
  mesmaBase,
  BASE_CUSTO_DO_EXTRATO,
  BASE_FRETE_DO_COMPRADOR,
  MOTIVOS_SEM_COMPARACAO,
  MOTIVO_EM_PORTUGUES,
  TOLERANCIA_TIKTOK,
} from "../src/lib/integrations/tiktokAuditoria.ts";

// Base do TikTok, com a evidência que sustenta cada lado (OAS oficial):
//
//   payment.shipping_fee ......... "Buyer paid shipping fee"        → COMPRADOR
//   shipping_cost_amount ......... "The shipping costs for the order at the time
//                                   of order settlement", igual à soma de
//                                   shipping_cost_breakdown — que JÁ inclui
//                                   customer_paid_shipping_fee_amount → VENDEDOR,
//                                   líquido.
//
// Comparar um com o outro é o falso positivo do Mercado Livre de 16/08/2026 com o
// sinal invertido: desconta a parcela do comprador duas vezes.

const extrato = (valor, currency = "BRL") => ({ base: BASE_CUSTO_DO_EXTRATO, valor, currency });

const pedido = (patch = {}) => ({
  orderId: "583985901599294689",
  ocorridoEm: "2026-08-10T12:00:00.000Z",
  declarado: extrato(6.65),
  cobrado: extrato(6.65),
  extratoLiquidado: true,
  lancamentosLiquidados: 1,
  lancamentosEstimados: 0,
  freteDoComprador: 16.99,
  statementId: "7672560861864609554",
  ...patch,
});

test("REGRESSAO: bases diferentes NAO geram divergencia", () => {
  // Os números são os do caso real do Mercado Livre que produziu 8 alertas
  // falsos: 16,99 pago pelo comprador contra 6,65 debitado do vendedor. Se este
  // módulo subtraísse um do outro, acusaria R$ 10,34 de cobrança indevida que
  // não existe. Bases diferentes = nenhuma afirmação.
  const resultado = auditarFreteTiktok([
    pedido({
      declarado: { base: BASE_FRETE_DO_COMPRADOR, valor: 16.99, currency: "BRL" },
      cobrado: extrato(6.65),
    }),
  ]);

  assert.equal(resultado.pedidos.length, 0, "base diferente nao pode virar alerta");
  assert.equal(resultado.comparados, 0);
  assert.equal(resultado.totalAContestar, null, "sem comparacao o total e desconhecido, nao zero");
  assert.equal(resultado.pendenciasPorMotivo.bases_diferentes, 1);
  assert.equal(resultado.pendencias[0].motivo, "bases_diferentes");
});

test("REGRESSAO: o frete do comprador nunca entra na subtracao", () => {
  // Extrato e repasse batem em 6,65; o comprador pagou 16,99. Uma implementação
  // que somasse ou subtraísse o frete do comprador acusaria divergência em TODO
  // pedido com frete pago pelo comprador — que é praticamente todo pedido.
  const resultado = auditarFreteTiktok([pedido({ freteDoComprador: 16.99 })]);
  assert.equal(resultado.pedidos.length, 0);
  assert.equal(resultado.comparados, 1);
  assert.equal(resultado.totalAContestar, 0);
});

test("mesmaBase e a trava explicita da comparacao", () => {
  assert.equal(mesmaBase(extrato(1), extrato(2)), true);
  assert.equal(mesmaBase(extrato(1), { base: BASE_FRETE_DO_COMPRADOR, valor: 1, currency: "BRL" }), false);
});

test("divergencia real: o repasse debitou mais do que o extrato declarou", () => {
  const resultado = auditarFreteTiktok([pedido({ cobrado: extrato(12.4) })]);
  assert.equal(resultado.pedidos.length, 1);
  const caso = resultado.pedidos[0];
  assert.equal(caso.declarado, 6.65);
  assert.equal(caso.cobrado, 12.4);
  assert.equal(caso.diferenca, 5.75);
  assert.equal(caso.base, BASE_CUSTO_DO_EXTRATO);
  assert.equal(caso.freteDoComprador, 16.99, "o numero do comprador aparece ao lado, sem entrar na conta");
  assert.equal(caso.currency, "BRL");
  assert.equal(resultado.totalAContestar, 5.75);
  assert.equal(resultado.comparados, 1);
});

test("cobranca a menor aparece na lista mas nao entra no total a contestar", () => {
  const resultado = auditarFreteTiktok([pedido({ cobrado: extrato(4.0) })]);
  assert.equal(resultado.pedidos.length, 1);
  assert.equal(resultado.pedidos[0].diferenca, -2.65);
  assert.equal(resultado.totalAContestar, 0, "diferenca a favor dela nao vira pedido de dinheiro");
});

test("diferenca dentro da tolerancia de um centavo nao vira caso", () => {
  const resultado = auditarFreteTiktok([pedido({ cobrado: extrato(6.65 + TOLERANCIA_TIKTOK) })]);
  assert.equal(resultado.pedidos.length, 0);
  assert.equal(resultado.comparados, 1);
});

test("frete desconhecido nao vira zero em nenhum dos lados", () => {
  const semExtrato = auditarFreteTiktok([pedido({ declarado: extrato(null) })]);
  assert.equal(semExtrato.pedidos.length, 0);
  assert.equal(semExtrato.pendenciasPorMotivo.frete_ausente_no_extrato, 1);
  assert.equal(semExtrato.pendencias[0].declarado, null);

  const semRepasse = auditarFreteTiktok([pedido({ cobrado: extrato(null), lancamentosLiquidados: 0 })]);
  assert.equal(semRepasse.pedidos.length, 0);
  assert.equal(semRepasse.pendenciasPorMotivo.repasse_ainda_nao_liquidado, 1);
  assert.equal(semRepasse.pendencias[0].cobrado, null);
});

test("extrato que ainda nao fechou fica pendente em vez de virar divergencia", () => {
  // Extrato pré-settlement responde com placeholder; tratar isso como "o TikTok
  // cobrou 0" acusaria o canal de nao ter debitado nada.
  const resultado = auditarFreteTiktok([
    pedido({ extratoLiquidado: false, declarado: extrato(null), cobrado: extrato(9.9) }),
  ]);
  assert.equal(resultado.pedidos.length, 0);
  assert.equal(resultado.pendenciasPorMotivo.extrato_do_pedido_pendente, 1);
});

test("lancamento apenas estimado nao conta como cobranca", () => {
  const resultado = auditarFreteTiktok([
    pedido({ cobrado: extrato(null), lancamentosLiquidados: 0, lancamentosEstimados: 2 }),
  ]);
  assert.equal(resultado.comparados, 0);
  assert.equal(resultado.pendenciasPorMotivo.repasse_ainda_nao_liquidado, 1);
});

test("moedas diferentes tambem sao bases diferentes", () => {
  const resultado = auditarFreteTiktok([
    pedido({ declarado: extrato(6.65, "BRL"), cobrado: extrato(6.65, "USD") }),
  ]);
  assert.equal(resultado.pedidos.length, 0);
  assert.equal(resultado.pendenciasPorMotivo.moedas_diferentes, 1);
});

test("periodo com moedas misturadas nao soma um total sem sentido", () => {
  const resultado = auditarFreteTiktok([
    pedido({ orderId: "A", cobrado: extrato(12.4) }),
    pedido({ orderId: "B", declarado: extrato(6.65, "USD"), cobrado: extrato(20, "USD") }),
  ]);
  assert.equal(resultado.currency, "BRL");
  assert.deepEqual(resultado.pedidos.map((p) => p.orderId), ["A"]);
  assert.equal(resultado.pendenciasPorMotivo.moedas_diferentes, 1);
  assert.equal(resultado.totalAContestar, 5.75);
});

test("maior diferenca primeiro — e onde esta o dinheiro", () => {
  const resultado = auditarFreteTiktok([
    pedido({ orderId: "A", cobrado: extrato(8.65) }),
    pedido({ orderId: "B", cobrado: extrato(20.65) }),
    pedido({ orderId: "C", cobrado: extrato(2.65) }),
  ]);
  assert.deepEqual(resultado.pedidos.map((p) => p.orderId), ["B", "A", "C"]);
  assert.equal(resultado.totalAContestar, 16);
});

test("lista vazia responde desconhecido, nao 'esta tudo certo'", () => {
  const resultado = auditarFreteTiktok([]);
  assert.equal(resultado.currency, null);
  assert.equal(resultado.comparados, 0);
  assert.equal(resultado.totalAContestar, null);
  assert.deepEqual(resultado.pedidos, []);
});

test("todo motivo de pendencia tem texto em portugues", () => {
  for (const motivo of MOTIVOS_SEM_COMPARACAO) {
    assert.equal(typeof MOTIVO_EM_PORTUGUES[motivo], "string");
    assert.ok(MOTIVO_EM_PORTUGUES[motivo].length > 0, motivo);
    // "parcial" e "incompleto" explicam o que a vendedora ja sabe. O motivo tem
    // que dizer o que falta.
    assert.doesNotMatch(MOTIVO_EM_PORTUGUES[motivo], /parcial|incomplet/i, motivo);
  }
});
