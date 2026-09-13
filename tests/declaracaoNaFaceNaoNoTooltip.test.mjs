import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");

// A LICAO DO v207: a declaracao da base existia e a Ana passou o dia sem ve-la,
// porque morava dentro do "i". Frase que muda COMO o numero e lido tem que
// renderizar sem interacao.
//
// Decisao de 31/08/2026, depois da varredura das quatro telas: sobem para a
// face as tres frases que mudam a leitura; fica no tooltip a que so complementa.

test("a frase que muda a leitura esta na FACE — e as duas que perderam o numero sairam com ele", async () => {
  // 1. Faturamento: o cupom ja abatido explica por que este valor e MENOR que o
  //    preco de tabela. A frase e montada no construtor dos cards, para a tela
  //    ter UMA linha por card sem decidir qual. ESTA CONTINUA, e e a que a faixa
  //    do periodo desenha sob o numero.
  const cards = await fonte("src/app/(app)/amazon/amazonFinancialCards.ts");
  assert.match(cards, /baseDeclarada: \(f\?\.promotions \?\? 0\) > 0[\s\S]{0,160}de cupom\./);

  // ⚠️ AS OUTRAS DUAS PERDERAM O NUMERO QUE QUALIFICAVAM, EM
  // 12/09/2026, quando a tira de indicadores complementares saiu da tela da
  // Amazon (ordem dela: *"replicar a mesma estrutura do mercado livre na
  // amazon"*). Elas eram:
  //
  //   2. "Preço de tabela, antes do cupom" no card PEDIDOS FEITOS — existia para
  //      distinguir DUAS receitas que conviviam na tela. Com uma so, nao ha o
  //      que distinguir: a frase explicaria uma comparacao que a tela nao faz.
  //   3. "pode haver mais" no card CUPOM RESGATADO — ressalva de COBERTURA, para
  //      ninguem tomar um piso por um total. Sem o card, nao ha piso exibido.
  //
  // ⚠️ POR QUE ISTO NAO E SO APAGAR A ASERCAO: as duas frases voltam
  // JUNTO com os cards, e e esta guarda que tem de reprovar a volta pela metade.
  // Ela passou a cobrar a condicional — se o card voltar, a frase vem na FACE
  // (`hint`), nunca no "i" (`info`), que foi a licao do v207.
  const amazon = await fonte("src/app/(app)/amazon/page.tsx");
  const codigo = amazon.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  if (/label="Pedidos feitos"/.test(codigo)) {
    assert.match(codigo, /hint=\{pedidosFeitos \? "Preço de tabela, antes do cupom/,
      "o card de Pedidos feitos voltou sem a frase que o distingue do faturamento");
  }
  if (/label="Cupom resgatado"/.test(codigo)) {
    assert.match(codigo, /hint=\{faturamento\?\.couponPartial[\s\S]{0,140}pode haver mais\./,
      "o card de Cupom voltou sem a ressalva de cobertura");
  }
});

test("nenhuma das tres sobrou no tooltip", async () => {
  const amazon = await fonte("src/app/(app)/amazon/page.tsx");
  const codigo = amazon.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const infos = [...codigo.matchAll(/info=\{?([^\n]*)/g)].map((m) => m[1]).join("\n");
  assert.ok(!/de cupom\./.test(infos), "o cupom abatido voltou para o 'i'");
  assert.ok(!/Preço de tabela, antes do cupom/.test(infos), "a distincao das receitas voltou para o 'i'");
  assert.ok(!/pode haver mais/.test(infos), "a ressalva de cobertura voltou para o 'i'");
});

test("a faixa Amazon fica sem legenda e mantém as faltas em Pendências", async () => {
  // INTENÇÃO ALTERADA EM 13/09/2026: mesmo uma linha alongava os cartões Amazon
  // em relação ao ML. A dona pediu para retirar todas as legendas da faixa.
  const amazon = await fonte("src/app/(app)/amazon/page.tsx");
  const codigo = amazon.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(!/baseDaFaixa|baseDoResultado: cards\.find/.test(codigo), "a legenda longa voltou à faixa");
  assert.match(codigo, /faltaOValorDaAmazon[\s\S]{0,300}href: "\/amazon\/monitor"/,
    "o que falta saiu da legenda e não permaneceu no bloco de pendências");
});
