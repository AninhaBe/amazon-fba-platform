import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

/**
 * A AMAZON NO ESQUELETO DO MERCADO LIVRE — a leva de 12/09/2026.
 *
 * Ordem da dona do produto, verbatim: *"cara, e replicar a mesma estrutura do
 * mercado livre na amazon"*. A tela inteira, na mesma ordem do ML: faixa do
 * periodo, Top 8 produtos e Ritmo dos ultimos 7 dias lado a lado, o cartao do
 * que falta para o numero fechar, e a lista de pedidos na forma v3.
 *
 * ⚠️ QUAL DEFEITO ESTE ARQUIVO REPROVA: o da v288 do ML, que
 * SOMOU a tela nova a tela velha em vez de substituir. A pessoa abria o
 * dashboard e via duas leituras do mesmo periodo, com bases diferentes, uma
 * embaixo da outra. Frente de substituicao que nao confere o que saiu entrega
 * acumulo, nao redesenho — e o acumulo e pior que as duas telas separadas.
 *
 * Por isso as asercoes daqui vem em PARES: o que entrou existe, e o que ele
 * substituiu nao existe mais.
 *
 * ⚠️ E A PROIBICAO OLHA O FONTE SEM COMENTARIOS, sempre: os
 * comentarios desta tela CITAM os blocos que sairam, nomeados, porque e assim
 * que a proxima pessoa sabe o que foi removido de proposito. Casar o fonte cru
 * reprovaria a propria documentacao da remocao.
 */
const CAMINHO = "src/app/(app)/amazon/page.tsx";
const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
const semComentarios = (codigo) =>
  codigo
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

test("a tela monta o PainelV3 — a MESMA peca do Mercado Livre, nao uma copia", async () => {
  const codigo = semComentarios(await fonte(CAMINHO));
  assert.match(codigo, /<PainelV3 dados=\{dadosV3\} \/>/, "a Amazon parou de montar o PainelV3");

  // ⚠️ A MESMA PECA, E ISSO E A GARANTIA: peca duplicada divergiria
  // no primeiro ajuste, e o defeito apareceria so num dos canais — o tipo de
  // coisa que ninguem ve ate um cliente ver. O ML monta o mesmo componente.
  const ml = semComentarios(await fonte("src/app/components/MercadoLivreWorkspace.tsx"));
  assert.match(ml, /<PainelV3 dados=/, "o ML deixou de montar a peca compartilhada");
  const painel = await fonte("src/app/components/PainelV3.tsx");
  assert.match(painel, /<FaixaDoPeriodoV3/, "a peca perdeu a faixa do periodo");
});

test("O QUE ISTO SUBSTITUI SAIU DA TELA — os quatro blocos antigos", async () => {
  const codigo = semComentarios(await fonte(CAMINHO));

  // 1. A abertura com a frase solta (`BriefingLead`). As pendencias que ela
  //    carregava foram para o cartao "O que falta para o numero fechar".
  assert.ok(!codigo.includes("<BriefingLead"), "a abertura com a frase solta voltou para a tela");

  // 2. A tira "Pedidos feitos / Vendas / Unidades / Ticket medio / ROI".
  assert.ok(!codigo.includes('className="secondary-metrics"'),
    "a tira de indicadores complementares voltou — a faixa do periodo e que diz o numero agora");

  // 3. "Evolucao das vendas" — o grafico diario. O ritmo dos ultimos 7 dias, no
  //    PainelV3, ocupa o lugar dele.
  assert.ok(!codigo.includes("<RevenueChart"), "o grafico antigo de evolucao voltou");
  assert.ok(!codigo.includes("Evolução das vendas"), "o titulo do grafico antigo voltou");

  // 4. A rosquinha "Repasses, taxas e lucro" e a cascata escrita ao lado dela.
  assert.ok(!codigo.includes("<FinancialSummaryPanel"), "o painel de repasses voltou");
  assert.ok(!codigo.includes('className="performance-panel"'),
    "a superficie que hospedava grafico e rosquinha voltou");

  // ⚠️ E O CODIGO MORTO SAIU COM ELES: import que nao e usado nao
  // quebra build nem teste, e e assim que a proxima pessoa acha "a tela ainda
  // usa isso" lendo o topo do arquivo.
  for (const morto of ["RevenueChart,", "FinancialSummaryPanel", "LegendaDeVendas",
                       "TopProductsRanking", "SinaisDoResultado", "CompactMetric"]) {
    assert.ok(!codigo.includes(morto), `sobrou referencia morta na tela: ${morto}`);
  }
});

test("os pedidos aparecem na forma v3 — a mesma tabela do ML", async () => {
  const codigo = semComentarios(await fonte(CAMINHO));
  assert.match(codigo, /<OrderProfitabilityTableV3/, "a lista de pedidos nao esta na forma v3");
  assert.ok(!codigo.includes("<OrderProfitabilityTable\n") && !/<OrderProfitabilityTable\s/.test(codigo),
    "a tabela antiga voltou ao lado da v3 — duas listas do mesmo dado");

  // ⚠️ A DUPLICACAO DA TABELA E DECLARADA E ENCOLHEU, nao sumiu:
  // `OrderProfitabilityTable` (forma antiga) ainda serve a Shopee e a central, e
  // por isso as duas convivem no disco. O que esta asercao impede e uma TELA ter
  // as duas, que seria a v288 de novo.
  const antiga = await fonte("src/app/components/OrderProfitabilityTable.tsx");
  assert.match(antiga, /export function OrderProfitabilityTable\(/,
    "a forma antiga foi apagada — a Shopee e a central a renderizam");
});

test("o ranking de produtos nao aparece DUAS vezes", async () => {
  // ⚠️ O DEFEITO EXATO QUE ISTO PEGA, e ele esteve na arvore por
  // alguns minutos em 12/09/2026: o PainelV3 ja monta o Top 8 produtos, e o
  // `TopProductsRanking` antigo continuava logo abaixo. Dois rankings do mesmo
  // periodo, um com contribuicao e outro sem, um embaixo do outro.
  const codigo = semComentarios(await fonte(CAMINHO));
  assert.ok(!codigo.includes("<TopProductsRanking"),
    "o ranking antigo voltou — o Top 8 do PainelV3 ja ocupa esse lugar");
  // E o Top do painel continua recebendo produto: painel sem produto e um
  // cartao vazio onde antes havia ranking.
  assert.match(codigo, /produtos: produtosDoTopAmazon\(top, currency\)/,
    "o Top do painel deixou de receber os produtos do periodo");
});

test("ACOS, TACOS e ROI MUDARAM DE LUGAR — nao sairam da tela", async () => {
  // A regra da casa: adicionar nao e redesenhar, e remover precisa ser decisao.
  // Estes tres eram cartoes da tira que saiu; o mapa aprovado os manda para o
  // bloco de Anuncios, ao lado das linhas que os explicam.
  const codigo = semComentarios(await fonte(CAMINHO));
  assert.match(codigo, /\["acos", "tacos", "roiPct"\]\.includes\(c\.key\) && c\.raw != null/,
    "a eficiencia do anuncio deixou de ser derivada dos MESMOS cartoes");
  assert.match(codigo, /eficiencia=\{cardsDaEficiencia\}/,
    "o bloco de Anuncios parou de receber ACOS, TACOS e ROI");
  const anuncios = await fonte("src/app/components/AnunciosPorProduto.tsx");
  assert.match(anuncios, /eficiencia\?:/, "o bloco de Anuncios perdeu a prop de eficiencia");
});
