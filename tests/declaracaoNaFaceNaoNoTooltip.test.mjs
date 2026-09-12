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

test("UMA linha por card na face — a que muda a leitura", async () => {
  // A trava contra a poluicao: dois avisos empilhados no mesmo card viram ruido,
  // e ruido tem o mesmo efeito de estarem escondidos, so que ocupando espaco.
  const amazon = await fonte("src/app/(app)/amazon/page.tsx");

  // O card de Cupom mostrava a ressalva OU a explicacao — nunca as duas. Ele
  // saiu da tela em 12/09/2026 com a tira de indicadores; a asercao virou
  // condicional pelo mesmo motivo do teste acima: o que ela impede e a volta
  // pela metade, com os dois avisos empilhados no mesmo card.
  const codigo = amazon.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  if (/label="Cupom resgatado"/.test(codigo)) {
    assert.match(codigo, /hint=\{faturamento\?\.couponPartial[\s\S]{0,200}info=\{faturamento\?\.couponPartial \? undefined :/,
      "o card de Cupom voltou empilhando ressalva e explicacao");
  }

  // A tela nao escolhe a frase: ela renderiza `card.baseDeclarada` nos dois
  // ramos, e QUEM decide qual linha cada card recebe e o construtor. Uma tela
  // que escolhe frase por card e onde a segunda linha aparece sem ninguem ver.
  // ⚠️ Mesmo caso das outras duas: a base passou a ser entregue
  // a faixa, que a desenha na linha visivel sob o numero da Margem. Quem decide
  // qual frase continua sendo o CONSTRUTOR do card, nao a tela — que era o
  // ponto desta assercao.
  assert.match(amazon, /baseDoResultado: cards\.find\(\(c\) => c\.key === "marginPct"\)\?\.baseDeclarada/);
});
