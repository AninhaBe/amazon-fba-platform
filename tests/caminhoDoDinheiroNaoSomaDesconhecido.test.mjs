import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ordenaPorMargem, sobreAVenda, somaDosCustos } from "../src/app/components/caminhoDoDinheiro.ts";

const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
const semComentarios = (codigo) =>
  codigo
    .split(String.fromCharCode(13)).join("")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/**
 * ⚠️ TODO DADO AQUI E FABRICADO, DOS DOIS LADOS DA FRONTEIRA — e essa e a
 * exigencia, nao um detalhe de montagem.
 *
 * A conta da vendedora hoje tem as quatro parcelas preenchidas. Um teste que so
 * usasse os numeros dela nunca exercitaria o caso `null`, e a regra ficaria
 * verde com as duas leituras possiveis — ate o primeiro periodo sem aliquota
 * cadastrada, onde o defeito nasceria calado. E o irmao do "desconfie de zero":
 * ali o numero nao aparecia, aqui o CASO nao aparecia.
 */

test("com TODAS as parcelas conhecidas, o total e a soma exata", () => {
  const { total, faltando } = somaDosCustos([
    { rotulo: "produtos", valor: 1263.18 },
    { rotulo: "frete", valor: 634.41 },
    { rotulo: "taxas", valor: 331.44 },
    { rotulo: "impostos", valor: 253.79 },
  ]);
  assert.equal(faltando.length, 0);
  // O valor do canvas, ao centavo.
  assert.equal(Number(total.toFixed(2)), 2482.82);
});

test("UMA parcela desconhecida torna o TOTAL desconhecido — nunca uma soma menor", () => {
  // ⚠️ Este e o caso que a conta de hoje nao exercita. Sem aliquota
  // cadastrada, `taxes` chega `null`. Somando como zero, o total sairia
  // 2.229,03 — um numero exato e MENOR que o real, e o "Sobrou" ao lado
  // pareceria melhor do que e. Nada ficaria vermelho.
  const { total, faltando } = somaDosCustos([
    { rotulo: "produtos", valor: 1263.18 },
    { rotulo: "frete", valor: 634.41 },
    { rotulo: "taxas", valor: 331.44 },
    { rotulo: "impostos", valor: null },
  ]);
  assert.equal(total, null, "a soma engoliu a parcela desconhecida e devolveu um total menor que o real");
  assert.deepEqual(faltando, ["impostos"], "o total sumiu sem dizer O QUE falta — a tela nao teria o que apontar");
});

test("as parcelas que faltam saem NOMEADAS, todas elas", () => {
  const { total, faltando } = somaDosCustos([
    { rotulo: "produtos", valor: null },
    { rotulo: "frete", valor: 634.41 },
    { rotulo: "taxas", valor: undefined },
    { rotulo: "impostos", valor: 253.79 },
  ]);
  assert.equal(total, null);
  assert.deepEqual(faltando, ["produtos", "taxas"]);
});

test("zero e FATO e entra na soma — nao e ausencia", () => {
  // "Nao houve frete" e um fato do periodo; confundi-lo com "nao sei o frete"
  // apagaria um total que a tela pode mostrar com seguranca.
  const { total, faltando } = somaDosCustos([
    { rotulo: "produtos", valor: 100 },
    { rotulo: "frete", valor: 0 },
  ]);
  assert.equal(total, 100);
  assert.equal(faltando.length, 0);
});

test("porcentagem sobre a venda: sem divisor valido nao ha porcentagem", () => {
  assert.equal(Number(sobreAVenda(1263.18, 2819.9).toFixed(1)), 44.8);   // o valor do canvas
  // ⚠️ Os tres jeitos de a divisao virar lixo na tela. `NaN%` e
  // `Infinity%` sao PIORES que ausencia, porque parecem um numero.
  assert.equal(sobreAVenda(100, 0), null, "base zero virou porcentagem — na tela sairia Infinity%");
  assert.equal(sobreAVenda(100, null), null, "base desconhecida virou porcentagem — na tela sairia NaN%");
  assert.equal(sobreAVenda(null, 2819.9), null, "parcela desconhecida virou porcentagem");
});

test("ordenar por margem poe o DESCONHECIDO no fim, nao entre os piores", () => {
  // ⚠️ Lista fabricada com o `null` NO MEIO, de proposito: se ele ja
  // entrasse no fim, a ordenacao poderia estar quebrada e o teste passaria.
  const ordenado = ordenaPorMargem([
    { id: "a", marginPct: 12.6 },
    { id: "b", marginPct: null },
    { id: "c", marginPct: 30.3 },
    { id: "d", marginPct: -5.5 },
    { id: "e", marginPct: null },
  ]);
  assert.deepEqual(ordenado.map((i) => i.id), ["c", "a", "d", "b", "e"],
    "o produto sem custo cadastrado foi ordenado como 0% — a tela acusa de pior quem ninguem mediu");
  // E os dois desconhecidos mantem a ordem de entrada, para nao trocarem de
  // lugar a cada render.
  assert.deepEqual(ordenado.slice(3).map((i) => i.id), ["b", "e"]);
});

test("a faixa consome ESTAS contas — e nao soma no meio do JSX", async () => {
  // ⚠️ ANCORADO NA DEFINICAO, nao no nome da variavel: o que importa e DE
  // ONDE cada parcela vem. Alguem pode trocar a fonte de `custos` uma linha
  // acima sem o nome mudar, e foi assim que o ticket medio quebrou em 02/09.
  const ml = semComentarios(await fonte("src/app/components/MercadoLivreWorkspace.tsx"));
  assert.match(
    ml,
    /const custosDoPeriodo = somaDosCustos\(\[\s*\{ rotulo: "produtos", valor: overview\.profit\.cogs \},\s*\{ rotulo: "frete", valor: overview\.profit\.sellerShipping \},\s*\{ rotulo: "taxas", valor: overview\.profit\.fees \},\s*\{ rotulo: "impostos", valor: overview\.profit\.taxes \},\s*\]\);/,
    "a soma dos custos mudou de forma ou de FONTE — as parcelas precisam vir do produtor, nomeadas",
  );
});
