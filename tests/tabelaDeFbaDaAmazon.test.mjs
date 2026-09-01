import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { tarifaFbaPelaTabela, pesoParaTarifa } from "../src/lib/integrations/amazonTabelaDeFba.ts";

// A tabela vem da pagina de ajuda do Seller Central (201112670), capturada em
// 01/09/2026 e versionada em docs/tarifas-amazon-br.md secao 2.
//
// ⚠️ TODA FRONTEIRA AQUI E TESTADA COM VALORES FABRICADOS, DOS DOIS LADOS.
// Regra do AGENTS.md, escrita hoje justamente por causa desta familia: DADO QUE
// NAO EXERCITA A REGRA NAO TESTA A REGRA. Na tabela de COMISSAO eu implementei a
// faixa como aliquota unica em vez de marginal, e nenhum teste pegou porque todo
// produto da conta custa de R$ 14 a R$ 38 — de um lado so da fronteira. Aqui a
// conta nao tem NENHUM produto acima de 10 kg nem acima de R$ 79, entao a matriz
// inteira e a regra do kg adicional so existem sob valores fabricados.

test("abaixo de R$ 79 a tarifa e fixa por faixa e NAO depende do peso", () => {
  // Celula mesclada na tabela original: o peso simplesmente nao entra.
  const leve = { pesoGramas: 50 };
  const pesado = { pesoGramas: 9_000 };
  assert.equal(tarifaFbaPelaTabela(29.99, leve).valor, 5.65);
  assert.equal(tarifaFbaPelaTabela(29.99, pesado).valor, 5.65, "o peso nao pode mudar nada abaixo de 79");
  assert.equal(tarifaFbaPelaTabela(30, leve).valor, 5.85);
  assert.equal(tarifaFbaPelaTabela(49.99, leve).valor, 5.85);
  assert.equal(tarifaFbaPelaTabela(50, leve).valor, 6.05);
  assert.equal(tarifaFbaPelaTabela(78.99, leve).valor, 6.05);
  // E abaixo de 79 nao precisa de peso NENHUM.
  assert.equal(tarifaFbaPelaTabela(25, {}).valor, 5.65);
});

test("a fronteira dos R$ 79 troca de regra — os dois lados", () => {
  const dim = { pesoGramas: 50 };
  assert.equal(tarifaFbaPelaTabela(78.99, dim).regra, "faixa-de-preco");
  assert.equal(tarifaFbaPelaTabela(79, dim).regra, "matriz-peso-preco");
  // 79 com 70 g (50 + 20 de embalagem) cai na primeira linha e na primeira coluna.
  assert.equal(tarifaFbaPelaTabela(79, dim).valor, 10.05);
});

test("o peso para tarifa e o MAIOR entre real e dimensional, mais 20 g", () => {
  // Dimensional = C x L x A / 6000 kg. 30x20x10 = 6000 cm3 -> 1 kg -> 1000 g.
  assert.equal(pesoParaTarifa({ pesoGramas: 300, comprimentoCm: 30, larguraCm: 20, alturaCm: 10 }), 1_020,
    "o dimensional de 1 kg vence os 300 g reais");
  assert.equal(pesoParaTarifa({ pesoGramas: 2_000, comprimentoCm: 30, larguraCm: 20, alturaCm: 10 }), 2_020,
    "o real de 2 kg vence o dimensional de 1 kg");
  assert.equal(pesoParaTarifa({ pesoGramas: 480 }), 500, "so o real, mais a embalagem");
  // Dimensao incompleta nao produz dimensional — duas medidas nao dao volume.
  assert.equal(pesoParaTarifa({ pesoGramas: 480, comprimentoCm: 30, larguraCm: 20 }), 500);
  assert.equal(pesoParaTarifa({}), null, "sem peso e sem dimensao nao ha peso para tarifa");
});

test("os 20 g de embalagem PODEM empurrar para a linha seguinte — e devem", () => {
  // 90 g reais viram 110 g com embalagem: sai da linha "0 a 100 g" para a
  // "100 a 200 g". Se a embalagem fosse esquecida, a tarifa sairia menor.
  assert.equal(tarifaFbaPelaTabela(85, { pesoGramas: 90 }).valor, 10.45);
  assert.equal(tarifaFbaPelaTabela(85, { pesoGramas: 70 }).valor, 10.05, "70 + 20 = 90 g, ainda na primeira linha");
});

test("a matriz cruza peso e faixa de preco — cantos fabricados", () => {
  const doisKg = { pesoGramas: 1_980 }; // 2.000 g com embalagem
  assert.equal(tarifaFbaPelaTabela(79, doisKg).valor, 13.05, "canto: 2 kg na primeira faixa");
  assert.equal(tarifaFbaPelaTabela(100, doisKg).valor, 15.05);
  assert.equal(tarifaFbaPelaTabela(120, doisKg).valor, 17.05);
  assert.equal(tarifaFbaPelaTabela(150, doisKg).valor, 19.95);
  assert.equal(tarifaFbaPelaTabela(250, doisKg).valor, 21.35, "canto: acima de 200");
  // A ultima linha da matriz, nos dois extremos de preco.
  const dezKg = { pesoGramas: 9_980 };
  assert.equal(tarifaFbaPelaTabela(79, dezKg).valor, 35.05);
  assert.equal(tarifaFbaPelaTabela(500, dezKg).valor, 51.35);
});

test("a fronteira das faixas de preco da matriz, dos dois lados", () => {
  const w = { pesoGramas: 80 }; // 100 g com embalagem, primeira linha
  assert.equal(tarifaFbaPelaTabela(99.99, w).valor, 10.05);
  assert.equal(tarifaFbaPelaTabela(100, w).valor, 12.05, "cruzou para a segunda coluna");
  assert.equal(tarifaFbaPelaTabela(119.99, w).valor, 12.05);
  assert.equal(tarifaFbaPelaTabela(120, w).valor, 14.05);
  assert.equal(tarifaFbaPelaTabela(149.99, w).valor, 14.05);
  assert.equal(tarifaFbaPelaTabela(150, w).valor, 15.05);
  assert.equal(tarifaFbaPelaTabela(199.99, w).valor, 15.05);
  assert.equal(tarifaFbaPelaTabela(200, w).valor, 15.55, "acima de 200 e a ultima coluna");
});

test("ACIMA DE 10 kg entra o kg adicional — a fronteira que nenhum produto dela exercita", () => {
  // 10 kg exatos ainda e a ultima linha da matriz.
  assert.equal(tarifaFbaPelaTabela(160, { pesoGramas: 9_980 }).regra, "matriz-peso-preco");
  assert.equal(tarifaFbaPelaTabela(160, { pesoGramas: 9_980 }).valor, 51.05);
  // Um grama acima ja cobra um quilo adicional inteiro (arredondamento para cima).
  const acima = tarifaFbaPelaTabela(160, { pesoGramas: 9_981 });
  assert.equal(acima.regra, "matriz-mais-kg-adicional");
  assert.equal(acima.valor, 54.55, "51,05 + 1 x 3,50");
  // E o kg adicional muda por faixa de preco: 3,05 abaixo de 150, 3,50 acima.
  assert.equal(tarifaFbaPelaTabela(90, { pesoGramas: 10_981 }).valor, 41.15, "35,05 + 2 x 3,05");
});

test("o exemplo 3 da pagina diverge da leitura literal — e a leitura literal e a implementada", () => {
  // ⚠️ AMBIGUIDADE DA PROPRIA PAGINA, registrada em docs/tarifas-amazon-br.md:
  // o exemplo 3 (12,62 kg, faixa 150-199,99) resulta em R$ 61,85 la, enquanto a
  // matriz lida ao pe da letra da 51,05 + 3 x 3,50 = R$ 61,55.
  //
  // Implementamos o literal porque e o que a TABELA diz, e a diferenca de trinta
  // centavos fica escrita em vez de escondida atras de um numero redondo. A
  // ordem observada > tabela corrige na pratica.
  const r = tarifaFbaPelaTabela(160, { pesoGramas: 12_600 }); // 12,62 kg com embalagem
  assert.equal(r.valor, 61.55, "a leitura literal da matriz");
  assert.notEqual(r.valor, 61.85, "o valor do exemplo da pagina, que nao fecha com a tabela");
});

test("SEM PRECO nao ha tarifa FBA por tabela — nem para produto barato", () => {
  // ⚠️ Mesmo abaixo de R$ 79 a FAIXA depende do preco (5,65 / 5,85 / 6,05).
  // Nao existe atalho para o pedido pendente: sem valor publicado, sem tarifa.
  assert.equal(tarifaFbaPelaTabela(null, { pesoGramas: 100 }), null);
  assert.equal(tarifaFbaPelaTabela(0, { pesoGramas: 100 }), null, "preco zero e ausencia");
});

test("preco alto SEM peso nem dimensao fica sem estimativa, nunca na primeira linha", () => {
  // ⚠️ Cair na primeira linha da matriz seria escolher a tarifa MAIS BARATA por
  // falta de dado — uma escolha nossa disfarcada de numero da Amazon.
  assert.equal(tarifaFbaPelaTabela(150, {}), null);
  assert.equal(tarifaFbaPelaTabela(150, { pesoGramas: 0 }), null);
});

test("a tabela declara FONTE e DATA, e nomeia a promocao que a torna otimista", () => {
  const fonte = fs.readFileSync(
    new URL("../src/lib/integrations/amazonTabelaDeFba.ts", import.meta.url), "utf8");
  assert.match(fonte, /201112670/, "a URL da fonte precisa estar no arquivo");
  assert.match(fonte, /Capturada em:\*\* \d{2}\/\d{2}\/\d{4}/, "a data da captura precisa estar no arquivo");
  // A promocao de isencao e a razao de a observada ter precedencia aqui: a conta
  // pode pagar MENOS que a tabela, ate zero.
  assert.match(fonte, /isenção|isencao/i, "a promocao vigente precisa estar registrada");
});
