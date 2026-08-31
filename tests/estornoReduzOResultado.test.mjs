import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { amazonFinancialCards } from "../src/app/amazon/amazonFinancialCards.ts";

// DECISAO DELA, 31/08/2026, verbatim: "estorno reduz o resultado do periodo".
//
// Ate aqui os estornos nao entravam em lucro NENHUM. `fees` os exclui de
// proposito — devolucao ao comprador nao e tarifa, e soma-la como tarifa
// contaria a devolucao como custo operacional —, mas eles tambem nao entravam em
// nenhum outro termo. Medido: R$ 3.091,33 em 123 devolucoes fora da conta.
//
// ⚠️ PELA DATA DO PEDIDO, E POR FALTA DE DADO — NAO POR PREFERENCIA.
// `workspace_channel_order_fees` nao tem coluna de data: o estorno nao carrega
// data propria no nosso banco. A data real existe na Transactions API
// (`postedDate`) e nunca foi persistida. Quando existir, revisitar.

const carta = (cards, key) => cards.find((c) => c.key === key);
const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");

const FINANCE = {
  currency: "BRL", revenue: 418.43, fees: 0, refunds: 0, buyerShipping: 0,
  orderCount: 22, feeBreakdown: [{ type: "commission", amount: 0 }],
};
const base = {
  finance: FINANCE, cogs: 154.49, estimatedProfit: 263.94, unitsWithoutCost: 0,
  faturamentoTotal: 1270.13, pedidosAguardando: 40,
};

test("o canonico SUBTRAI o estorno do lucro", async () => {
  const canonico = await fonte("src/lib/integrations/amazonOverviewCanonical.ts");
  assert.match(
    canonico,
    /processedRevenue - fees - cogs - \(taxes \?\? 0\) - refunds/,
    "o estorno precisa ser termo da formula, nao so um campo no payload",
  );
});

test("o estorno vem pela data do PEDIDO, nao pela do lancamento", async () => {
  // A unica data disponivel. Se alguem trocar por uma data do proprio estorno
  // sem antes CAPTURAR essa data, estara inventando o campo.
  const canonico = await fonte("src/lib/integrations/amazonOverviewCanonical.ts");
  const i = canonico.indexOf("f.fee_type = 'refund'");
  assert.ok(i > 0, "a consulta de estorno precisa existir");
  const consulta = canonico.slice(i, i + 200);
  assert.match(consulta, /o\.occurred_at >= \$4 AND o\.occurred_at <= \$5/, "recorte pela data do pedido");
});

test("a tela AVISA quando o passado muda de valor, com numero", () => {
  // Numero que muda sozinho vira "esta errado" mesmo estando certo — aconteceu
  // duas vezes em 30/08 (anuncio e margem). Junho caiu R$ 1.877,31 por esta
  // decisao; quem leu junho antes precisa entender por que junho e outro agora.
  const cards = amazonFinancialCards({ ...base, refunds: 270.93, refundCount: 14 });
  const nota = carta(cards, "profit").baseDeclarada;
  assert.match(nota, /270,93/, "o valor devolvido precisa aparecer");
  assert.match(nota, /14 devolução/, "e quantas devolucoes sao");
  assert.match(nota, /pela data da venda/, "e por qual data, que e o que muda o passado");
  assert.doesNotMatch(nota, /parcial|incompleto/i);
});

test("sem devolucao a frase SOME — zero e fato, escrever zero e ruido", () => {
  const cards = amazonFinancialCards({ ...base, refunds: 0, refundCount: 0 });
  assert.doesNotMatch(carta(cards, "profit").baseDeclarada ?? "", /devolução/);
});

test("nenhum fee_type e gravado com sinal negativo", async () => {
  // ⚠️ O DEFEITO QUE ISTO REPROVA (achado em 31/08/2026): `shopee/refund` era o
  // UNICO tipo do banco inteiro gravado negativo — 129 de 129, contra 43 mil
  // linhas positivas em todos os outros canais e tipos. E
  // `shopeeOverviewCanonical` calcula `... - refunds`: com refunds negativo,
  // isso SOMAVA R$ 5.461,72 ao lucro em vez de subtrair.
  //
  // A formula estava certa e legivel. A convencao de sinal e que a traia — e um
  // numero errado que se decompoe direitinho e mais perigoso que um que nao
  // fecha. A convencao agora e uma so: POSITIVO = dinheiro que saiu da vendedora.
  const shopee = await fonte("src/lib/integrations/shopeeCanonical.ts");
  assert.match(shopee, /amount: Math\.abs\(round2\(Number\(value\)\)\)/,
    "o gravador da Shopee precisa normalizar o sinal");
  assert.match(shopee, /POSITIVO = DINHEIRO QUE SAIU DA VENDEDORA/,
    "a convencao precisa estar escrita onde alguem vai mexer");
});

test("a Shopee ja subtraia o estorno — nao duplicar o termo la", async () => {
  // Ela sempre teve `- refunds!` na formula, com `refunds_known` para o `null`.
  // O defeito dela era o SINAL, nao a ausencia do termo. Acrescentar um segundo
  // desconto teria descontado duas vezes.
  const shopee = await fonte("src/lib/integrations/shopeeOverviewCanonical.ts");
  const formula = shopee.slice(shopee.indexOf("const estimatedProfit = financialComplete"), shopee.indexOf("const marginPct = estimatedProfit"));
  assert.equal((formula.match(/refunds/g) ?? []).length, 1, "um desconto de estorno, nao dois");
});

test("ML e TikTok nao tem estorno — ausencia VERIFICADA, nao presumida", async () => {
  // ⚠️ A distincao importa: ausencia verificada e `0` (fato), ausencia
  // desconhecida seria `null`. Medido no banco em 31/08/2026 — os unicos
  // `fee_type` desses dois canais sao `commission` e `shipping_seller`, em
  // 39.782 + 34.259 + 10.128 + 1.002 linhas. Nenhuma de estorno.
  //
  // Se um dia aparecer `fee_type` de estorno neles, o termo entra — e este
  // comentario e o registro de que a ausencia foi medida, nao suposta.
  const ml = await fonte("src/lib/integrations/mercadoLivreOverviewCanonical.ts");
  const tiktok = await fonte("src/lib/integrations/tiktokOverviewCanonical.ts");
  for (const [nome, src] of [["mercadoLivre", ml], ["tiktok", tiktok]]) {
    assert.doesNotMatch(src, /fee_type = 'refund'/, `${nome} nao deveria consultar estorno: nao ha nenhum`);
  }
});
