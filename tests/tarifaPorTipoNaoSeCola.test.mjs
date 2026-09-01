import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { computeOrderFinancials } from "../src/lib/transactions.ts";

const fonte = (c) => readFile(new URL(`../${c}`, import.meta.url), "utf8");

// ═══ A DECOMPOSICAO DA TARIFA CHEGAVA E ERA JOGADA FORA ══════════════════════
//
// Medido em 01/09/2026 na conta A15NQMF7A6J1Y0: 5.266 pedidos com tarifa real,
// R$ 51.782,74, TODOS gravados como uma linha so —
// `commission / transactions_total` — e ZERO linhas de `fulfillment` em todo o
// banco daquela conexao.
//
// O comentario do proprio tipo dizia o que estava sendo somado ali: "taxas da
// Amazon (comissao, FBA, armazenagem, ads...)". Ou seja, armazenagem e anuncio
// entravam num campo chamado COMISSAO, e o card "Taxas" somava tudo isso como
// tarifa de pedido.
//
// E custava a feature inteira que a vendedora pediu: sem comissao e FBA
// separadas nao da para estimar por tabela, nem para exibir as duas parcelas que
// o software de referencia dela mostra. O `feeMap` do parser ja trazia a
// decomposicao desde sempre — so nao era gravada.

const transacao = (breakdowns) => ({
  transactionType: "Shipment",
  transactionStatus: "Released",
  postedDate: "2026-09-01T10:00:00Z",
  totalAmount: { currencyCode: "BRL", currencyAmount: 10 },
  relatedIdentifiers: [{ relatedIdentifierName: "ORDER_ID", relatedIdentifierValue: "PEDIDO-1" }],
  breakdowns,
});

test("a Transactions API entrega a tarifa POR TIPO, e ela sobrevive", () => {
  const financials = computeOrderFinancials([
    transacao([
      { breakdownType: "Sales", breakdowns: [{ breakdownType: "ProductCharges", breakdownAmount: { currencyCode: "BRL", currencyAmount: 28.9 } }] },
      { breakdownType: "Expenses", breakdowns: [{ breakdownType: "AmazonFees", breakdowns: [
        { breakdownType: "ReferralFee", breakdownAmount: { currencyCode: "BRL", currencyAmount: -3.47 } },
        { breakdownType: "FBAPerUnitFulfillmentFee", breakdownAmount: { currencyCode: "BRL", currencyAmount: -5.65 } },
        { breakdownType: "StorageFee", breakdownAmount: { currencyCode: "BRL", currencyAmount: -0.22 } },
      ] }] },
    ]),
  ]);
  const pedido = financials["PEDIDO-1"];
  assert.ok(pedido, "o pedido precisa existir");
  // ⚠️ A DECOMPOSICAO EXISTE — era isto que se perdia.
  assert.deepEqual(pedido.porTipo, {
    ReferralFee: 3.47,
    FBAPerUnitFulfillmentFee: 5.65,
    StorageFee: 0.22,
  });
  // E o total continua sendo a SOMA dela. Se um dia divergir, uma das duas
  // leituras esta errada e a tela mostraria numeros que nao fecham.
  const soma = Object.values(pedido.porTipo).reduce((a, b) => a + b, 0);
  assert.equal(Number(soma.toFixed(2)), pedido.fees);
});

test("🔑 a natureza da tarifa nao vira 'comissao' por descuido", async () => {
  // A traducao para o vocabulario canonico e o que faz previsto e real terem a
  // MESMA chave (ADR-027 Emenda II). E o desconhecido vai para `other`: mandar
  // para `commission` foi o defeito — armazenagem e anuncio inflando a comissao.
  const sync = await fonte("src/lib/integrations/amazonSync.ts");
  assert.match(sync, /function naturezaDaTarifa/);
  assert.match(sync, /referral.*commission|commission.*referral/is);
  assert.match(sync, /return "other";/, "sem destino para o desconhecido, ele cai em alguma parcela");
  // A trava que importa: o agregado NAO pode mais ser gravado como comissao.
  assert.doesNotMatch(
    sync,
    /feeType: "commission", providerFeeCode: "transactions_total"/,
    "o total agregado voltou a ser gravado com nome de comissao",
  );
});

test("sem decomposicao, o total entra como 'other' — nunca como comissao", async () => {
  // Transacao antiga ou formato que o parser nao abriu: o numero nao se perde,
  // mas nao ganha um nome que ele nao tem.
  const sync = await fonte("src/lib/integrations/amazonSync.ts");
  assert.match(sync, /feeType: "other", providerFeeCode: "transactions_total"/);
});
