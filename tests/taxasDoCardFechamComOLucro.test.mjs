import test from "node:test";
import assert from "node:assert/strict";
import { amazonFinancialCards } from "../src/app/(app)/amazon/amazonFinancialCards.ts";

/**
 * ⚠️ GUARDA POSITIVA: O CARD DE TAXAS E O LUCRO LEEM O MESMO UNIVERSO.
 *
 * O defeito real (spec de 02/09/2026): o card mostrava R$ 58,99 enquanto o lucro
 * descontava R$ 312,43 — os R$ 253,44 de tarifa estimada entravam na conta e nao
 * apareciam em lugar nenhum. Quem somasse os cards nao chegava no lucro exibido,
 * e a diferenca era invisivel.
 *
 * E a mesma doenca do widget da Shopee: DOIS CONSUMIDORES DOS MESMOS NUMEROS,
 * cada um num universo. Por isso a guarda e POSITIVA — ela nao proibe uma
 * string, ela EXIGE que a conta feche: Faturamento - Custo - Taxas - Ads =
 * Lucro, com os numeros que estao na tela, sem valor oculto.
 *
 * Guarda negativa ("nao pode aparecer 58,99") passaria com qualquer outro par
 * errado. Esta so passa se os dois lerem o mesmo total.
 */

const carta = (cards, key) => cards.find((c) => c.key === key);
const numero = (texto) => Number(String(texto).replace(/[^0-9,-]/g, "").replace(",", "."));

// CENARIO MISTO — oficial E estimada no mesmo periodo, que e o unico em que o
// defeito aparece. So oficial ou so estimada nao exercitam a fronteira: os dois
// universos coincidem e a guarda ficaria verde com a soma errada.
const misto = {
  finance: {
    revenue: 1000, fees: 58.99, refunds: 0, netProceeds: 0,
    buyerShipping: null, promotions: 0, currency: "BRL", orderCount: 50,
  },
  // O faturamento e a BASE do lucro (decisao dela, 31/08/2026): sem ele o card
  // fica travessao e nao ha conta para fechar.
  faturamentoTotal: 1000,
  cogs: 300,
  unitsWithoutCost: 0,
  feesEstimadas: 253.44,
  feesDoLucro: 312.43,
  pedidosComTarifaEstimada: 15,
  pedidosDoPeriodo: 50,
  estimatedProfit: 1000 - 312.43 - 300,
};

test("o card de Taxas mostra o MESMO total que o lucro desconta", () => {
  const cards = amazonFinancialCards(misto);
  const taxas = carta(cards, "fees");
  assert.equal(
    numero(taxas.value), 312.43,
    "o card voltou a mostrar so a parte oficial — a estimada some da tela e continua na conta",
  );
  // E o piso: sem `feesDoLucro`, o card cai no oficial e NAO inventa soma.
  const semTotal = amazonFinancialCards({ ...misto, feesDoLucro: undefined });
  assert.equal(numero(carta(semTotal, "fees").value), 58.99);
});

test("e a conta FECHA lendo os cards — sem valor oculto", () => {
  const cards = amazonFinancialCards(misto);
  const faturamento = numero(carta(cards, "revenue").value);
  const taxas = numero(carta(cards, "fees").value);
  const lucro = numero(carta(cards, "profit").value);
  const fechamento = +(faturamento - taxas - misto.cogs).toFixed(2);
  assert.equal(
    lucro, fechamento,
    `os cards nao fecham: ${faturamento} - ${taxas} - ${misto.cogs} = ${fechamento}, e o lucro exibe ${lucro}`,
  );
});

test("o card de Taxas NAO decompoe — so o numero", () => {
  // ⚠️ ESTE TESTE MUDOU DE INTENCAO EM 02/09/2026, e o registro fica
  // porque a inversao e o ponto. Ele EXIGIA a decomposicao oficial/estimada no
  // card — que era pedido da dona, de ontem. Ela mesma reverteu, verbatim:
  // *"nao precisamos informar o que e oficial e o que e estimado. remove de
  // tudo essa palavra/card, ja dissemos as regras do que mostrar (numeros)"*.
  //
  // O QUE NAO MUDOU E O QUE O TESTE PROTEGE DE VERDADE: o card exibe o MESMO
  // total que o lucro desconta. Isso nunca dependeu do texto.
  //
  // A assercao inverteu: antes exigia "oficial R$ 58,99 - estimada R$ 253,44 em
  // 15 de 50 pedidos - substituida pela oficial na liquidacao"; agora PROIBE.
  const taxas = carta(amazonFinancialCards(misto), "fees");
  assert.equal(numero(taxas.value), 312.43, "o total mudou junto com o texto — nao era para mudar");
  const linha = taxas.baseDeclarada ?? "";
  for (const proibido of [/oficial/i, /estimad/i, /liquida[cç][aã]o/i]) {
    assert.ok(!proibido.test(linha), `a decomposicao voltou ao card: ${linha}`);
  }
  assert.equal(taxas.marcaEstimativa, undefined, "o selo do agregado voltou");
});

test("sem estimativa, o card continua igual — e nada de texto aparece", () => {
  const soOficial = amazonFinancialCards({
    ...misto, feesEstimadas: 0, pedidosComTarifaEstimada: 0, feesDoLucro: 58.99,
    estimatedProfit: 1000 - 58.99 - 300,
  });
  const taxas = carta(soOficial, "fees");
  assert.equal(numero(taxas.value), 58.99);
  assert.ok(!taxas.baseDeclarada || !/estimada/.test(taxas.baseDeclarada), "a composicao ficou na tela sem ter o que compor");
  assert.equal(taxas.marcaEstimativa, undefined, "a marca ficou sem estimativa para marcar");
});
