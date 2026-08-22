import test from "node:test";
import assert from "node:assert/strict";

import { somarValorPorPedido, pedidosSemValor } from "../src/lib/integrations/amazonOrdersReportParse.ts";

// Medido em 22/08/2026: a Amazon zera o pedido cancelado em TODAS as APIs de
// pedido (getOrders, getOrderItems, orderMetrics e o próprio relatório). O valor
// só existe enquanto o pedido está vivo — e é o relatório, e só ele, que
// precifica pedido pendente.
//
// Este teste guarda a fronteira entre "não sei" e "zero", que é onde o bug mora:
// linha zerada de cancelado NÃO pode virar 0,00 no canônico, senão a tela passa a
// dizer "cancelaram e não custou nada" — a mesma violação que a migration 0008
// corrigiu no `gross`.

const CABECALHO = "amazon-order-id\titem-status\tquantity\titem-price\tsku";
const linha = (id, status, qtd, preco, sku) => [id, status, qtd, preco, sku].join("\t");

test("soma várias linhas do mesmo pedido", () => {
  const tsv = [
    CABECALHO,
    linha("111-1", "Shipped", "1", "22.11", "kit-clips-320"),
    linha("111-1", "Shipped", "1", "27.90", "martelo-borracha"),
  ].join("\n");
  assert.deepEqual(somarValorPorPedido(tsv), [
    { externalOrderId: "111-1", orderedGross: 50.01 },
  ]);
});

test("pedido cancelado (quantity 0, preço vazio) NÃO vira zero — fica de fora", () => {
  const tsv = [
    CABECALHO,
    linha("222-2", "Cancelled", "0", "", "kit-clips-320"),
    linha("333-3", "Shipped", "1", "19.90", "kit-clips-320"),
  ].join("\n");
  const saida = somarValorPorPedido(tsv);
  assert.equal(saida.length, 1, "o cancelado sem valor não pode entrar");
  assert.equal(saida[0].externalOrderId, "333-3");
});

test("pendente É precificado — é a razão inteira deste caminho existir", () => {
  const tsv = [
    CABECALHO,
    linha("444-4", "Unshipped", "1", "22.11", "kit-clips-320"),
  ].join("\n");
  assert.deepEqual(somarValorPorPedido(tsv), [
    { externalOrderId: "444-4", orderedGross: 22.11 },
  ]);
});

test("arredonda para centavo, sem erro de ponto flutuante", () => {
  const tsv = [
    CABECALHO,
    linha("555-5", "Shipped", "1", "0.1", "x"),
    linha("555-5", "Shipped", "1", "0.2", "x"),
  ].join("\n");
  assert.equal(somarValorPorPedido(tsv)[0].orderedGross, 0.3);
});

test("relatório sem as colunas esperadas falha alto, não devolve vazio", () => {
  assert.throws(
    () => somarValorPorPedido("coluna-a\tcoluna-b\n1\t2"),
    /colunas esperadas/,
    "mudança de layout do relatório tem que aparecer, não virar silêncio"
  );
});

test("relatório sem linhas devolve vazio sem quebrar", () => {
  assert.deepEqual(somarValorPorPedido(CABECALHO), []);
});

// --- A segunda passada: estimar o que a origem zerou ---
//
// O SKU sobrevive ao cancelamento (medido em 22/08/2026: `sku`, `asin`,
// `product-name` e `purchase-date` continuam preenchidos com `quantity 0` e
// `item-price` vazio). É esse resto que permite estimar — e é por isso que
// pedido zerado SEM sku não pode virar estimativa nenhuma.

test("pedido zerado com SKU vira candidato a estimativa", () => {
  const tsv = [
    CABECALHO.replace("sku", "sku\tpurchase-date"),
    "666-6\tCancelled\t0\t\tkit-clips-320\t2026-08-18T15:09:43+00:00",
  ].join("\n");
  const saida = pedidosSemValor(tsv);
  assert.equal(saida.length, 1);
  assert.equal(saida[0].externalOrderId, "666-6");
  assert.deepEqual(saida[0].skus, ["kit-clips-320"]);
  assert.equal(saida[0].purchaseDate, "2026-08-18T15:09:43+00:00");
});

test("pedido zerado SEM sku fica de fora — sem base, sem estimativa", () => {
  const tsv = [CABECALHO, linha("777-7", "Cancelled", "0", "", "")].join("\n");
  assert.deepEqual(pedidosSemValor(tsv), []);
});

test("pedido COM valor nunca entra na estimativa", () => {
  const tsv = [CABECALHO, linha("888-8", "Shipped", "1", "22.11", "kit-clips-320")].join("\n");
  assert.deepEqual(pedidosSemValor(tsv), []);
});

test("pedido com uma linha paga e outra zerada NÃO é estimado", () => {
  // Senão o valor real da linha paga seria substituído por preço de tabela.
  const tsv = [
    CABECALHO,
    linha("999-9", "Shipped", "1", "22.11", "kit-clips-320"),
    linha("999-9", "Cancelled", "0", "", "martelo-borracha"),
  ].join("\n");
  assert.deepEqual(pedidosSemValor(tsv), []);
});
