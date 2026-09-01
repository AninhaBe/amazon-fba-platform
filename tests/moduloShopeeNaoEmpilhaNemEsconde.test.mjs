import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
const semComentarios = (codigo) => codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

// OS DOIS DEFEITOS QUE ESTE ARQUIVO REPROVA (01/09/2026).
//
// ⚠️ A AUDITORIA DE EMPILHAMENTO OLHOU AS TELAS DE CANAL E ESTE ARQUIVO FICOU DE
// FORA — com o defeito inteiro vivo. A proxima varredura tem de ser por
// COMPONENTE que renderiza sinais, nao por nome de tela.
//
// 1. QUATRO renders da MESMA lista de sinais (ate 3), ou seja ate 12 marcas
//    dizendo tres coisas.
// 2. O multiplexador que SUPRIME informacao: o sub era
//    `sinais.length > 0 ? <SinaisDoResultado/> : declaracao`, entao a declaracao
//    de base e a de periodo so apareciam QUANDO NAO HAVIA SINAL — escondidas
//    justamente nas contas com pendencia.

test("os sinais aparecem UMA vez na tela do modulo", async () => {
  const codigo = semComentarios(await fonte("src/app/components/ShopeeModulePage.tsx"));
  const vezes = (codigo.match(/<SinaisDoResultado sinais=\{sinaisDaTela\}\/>/g) ?? []).length;
  assert.equal(vezes, 1, `os sinais voltaram a repetir (${vezes} vezes)`);
});

test("e NENHUM sinal desapareceu — a condicao que atravessa todo corte", async () => {
  const codigo = semComentarios(await fonte("src/app/components/ShopeeModulePage.tsx"));
  assert.match(codigo, /<SinaisDoResultado sinais=\{sinaisDaTela\}\/>/, "os sinais sumiram de vez");
});

test("as declaracoes NAO dependem de nao haver sinal", async () => {
  // O multiplexador escondia a declaracao exatamente nas contas que mais
  // precisam dela. Os cartoes voltaram ao sub deles.
  const codigo = semComentarios(await fonte("src/app/components/ShopeeModulePage.tsx"));
  assert.ok(
    !/sinaisDaTela\.length>0\?<SinaisDoResultado/.test(codigo),
    "voltou o multiplexador que suprime a declaracao quando ha pendencia",
  );
  assert.match(codigo, /sub="no período selecionado"/);
  assert.match(codigo, /sub=\{baseDoResultado\}/);
});

test("⚠️ FRASE VERDADEIRA COM VALIDADE: a base sai do campo USADO, nao de uma string", async () => {
  // A categoria que a varredura de hoje NAO procurava: "sobre a receita
  // processada" era VERDADEIRO e estava programado para virar mentira no dia em
  // que o backend trocasse o denominador da Shopee para o faturamento — e
  // ninguem ia lembrar de voltar aqui.
  //
  // As duas saidas obvias eram ruins pelo mesmo motivo: string especifica (que
  // vira mentira) ou texto generico (que perde a especificidade hoje). As duas
  // tratavam o texto como CONSTANTE. Ele e propriedade do DADO.
  const codigo = semComentarios(await fonte("src/app/components/ShopeeModulePage.tsx"));
  assert.match(
    codigo,
    /const baseDoResultado=profit\?\.revenueDoLucro!=null\?"sobre o faturamento":"sobre a receita processada";/,
    "a frase da base voltou a ser constante",
  );
  // E o campo tem de existir no contrato, mesmo antes de o backend mandar.
  assert.match(codigo, /revenueDoLucro\?:number\|null;/, "o campo saiu do contrato do modulo");
});

test("o TikTok continua sem repetir — e a ausencia e verificada", async () => {
  const codigo = semComentarios(await fonte("src/app/components/TikTokModulePage.tsx"));
  const vezes = (codigo.match(/<SinaisDoResultado/g) ?? []).length;
  assert.ok(vezes <= 1, `o modulo do TikTok passou a repetir sinais (${vezes})`);
});
