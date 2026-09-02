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

test("a composicao diz oficial, estimada e X DE Y — com acento", () => {
  const linha = carta(amazonFinancialCards(misto), "fees").baseDeclarada;
  assert.match(linha, /oficial R\$\s?58,99/, "a parcela oficial sumiu da composicao");
  assert.match(linha, /estimada R\$\s?253,44/, "a parcela estimada sumiu da composicao");
  // O denominador e a MESMA contagem do topo (item 4 da spec): aviso que conta
  // por fora e o proximo "15 de 50 enquanto o topo diz 61".
  assert.match(linha, /15 de 50 pedidos/, "a base de contagem deixou de ser a do periodo");
  // ⚠️ ACENTO E TEXTO DE TELA, e esta assercao existe porque a frase
  // nasceu sem: "substituida pela oficial na liquidacao" ia para a vendedora.
  assert.match(linha, /substitu\u00edda pela oficial na liquida\u00e7\u00e3o/, "o texto da tela perdeu os acentos");

  // ⚠️ E NAO PODE DIZER "PELA TABELA": medido em 02/09/2026, as 92
  // estimativas da conta dela sao `product_fees_api` e NENHUMA e de tabela.
  // Nomear a unica fonte que a conta nao tem e o defeito que ela mesma flagrou
  // no card do agregado. A proibicao le a STRING devolvida, nao o fonte — nao ha
  // comentario para casar por engano (docs/achado-guarda-que-depende-da-forma.md).
  assert.ok(!/pela tabela/i.test(linha), "a tela voltou a nomear uma fonte que a conta pode nao ter");
});

test("sem estimativa, a composicao NAO aparece — marca permanente vira decoracao", () => {
  const soOficial = amazonFinancialCards({
    ...misto, feesEstimadas: 0, pedidosComTarifaEstimada: 0, feesDoLucro: 58.99,
    estimatedProfit: 1000 - 58.99 - 300,
  });
  const taxas = carta(soOficial, "fees");
  assert.equal(numero(taxas.value), 58.99);
  assert.ok(!taxas.baseDeclarada || !/estimada/.test(taxas.baseDeclarada), "a composicao ficou na tela sem ter o que compor");
  assert.equal(taxas.marcaEstimativa, undefined, "a marca ficou sem estimativa para marcar");
});
