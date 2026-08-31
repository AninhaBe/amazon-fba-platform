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

test("as tres frases que mudam a leitura estao na FACE", async () => {
  const amazon = await fonte("src/app/amazon/page.tsx");

  // 1. Faturamento: o cupom ja abatido explica por que este valor e MENOR que
  //    "Pedidos feitos". A frase e montada no construtor dos cards, para a tela
  //    ter UMA linha por card sem decidir qual.
  const cards = await fonte("src/app/amazon/amazonFinancialCards.ts");
  assert.match(cards, /baseDeclarada: \(f\?\.promotions \?\? 0\) > 0[\s\S]{0,160}de cupom\./);

  // 2. Pedidos feitos: distingue DUAS receitas que convivem na tela.
  assert.match(amazon, /hint=\{pedidosFeitos \? "Preço de tabela, antes do cupom/);

  // 3. Cupom: "pode haver mais" e ressalva de COBERTURA — sem ela a pessoa toma
  //    um piso por um total.
  assert.match(amazon, /hint=\{faturamento\?\.couponPartial[\s\S]{0,140}pode haver mais\./);
});

test("nenhuma das tres sobrou no tooltip", async () => {
  const amazon = await fonte("src/app/amazon/page.tsx");
  const codigo = amazon.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const infos = [...codigo.matchAll(/info=\{?([^\n]*)/g)].map((m) => m[1]).join("\n");
  assert.ok(!/de cupom\./.test(infos), "o cupom abatido voltou para o 'i'");
  assert.ok(!/Preço de tabela, antes do cupom/.test(infos), "a distincao das receitas voltou para o 'i'");
  assert.ok(!/pode haver mais/.test(infos), "a ressalva de cobertura voltou para o 'i'");
});

test("UMA linha por card na face — a que muda a leitura", async () => {
  // A trava contra a poluicao: dois avisos empilhados no mesmo card viram ruido,
  // e ruido tem o mesmo efeito de estarem escondidos, so que ocupando espaco.
  const amazon = await fonte("src/app/amazon/page.tsx");

  // O card de Cupom mostra a ressalva OU a explicacao — nunca as duas.
  assert.match(amazon, /hint=\{faturamento\?\.couponPartial[\s\S]{0,200}info=\{faturamento\?\.couponPartial \? undefined :/);

  // A tela nao escolhe a frase: ela renderiza `card.baseDeclarada` nos dois
  // ramos, e QUEM decide qual linha cada card recebe e o construtor. Uma tela
  // que escolhe frase por card e onde a segunda linha aparece sem ninguem ver.
  assert.match(amazon, /sub=\{card\.baseDeclarada\}/);
});
