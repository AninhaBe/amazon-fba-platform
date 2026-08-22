import test from "node:test";
import assert from "node:assert/strict";

import { somarValorPorPedido } from "../src/lib/integrations/amazonOrdersReportParse.ts";

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
