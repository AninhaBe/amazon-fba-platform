import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { aliquotaEmTexto, painelDeAliquotaAberto } from "../src/app/components/painelDeAliquota.ts";

// O PEDIDO (29/08/2026): com as alíquotas ja cadastradas, o painel ocupava a
// Visao geral com quatro campos de digitacao que ninguem ia usar — era a segunda
// das duas faixas empilhadas no topo que ela reclamou de manha. Recolhido mostra
// o VALOR; aberto mostra o formulario.
//
// Tres estados, aprovados pelo wireframe:
//   A. recolhido, com o valor a vista;
//   B. aberto sozinho quando falta alíquota em canal conectado;
//   C. aberto por clique, e o clique manda.

const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");

test("A: tudo cadastrado, painel RECOLHIDO", () => {
  assert.equal(painelDeAliquotaAberto({ abertoPeloUsuario: null, lendo: false, canaisSemAliquota: 0 }), false);
});

test("B: falta alíquota em canal conectado, painel ABRE sozinho", () => {
  assert.equal(painelDeAliquotaAberto({ abertoPeloUsuario: null, lendo: false, canaisSemAliquota: 1 }), true);
  assert.equal(painelDeAliquotaAberto({ abertoPeloUsuario: null, lendo: false, canaisSemAliquota: 4 }), true);
});

test("C: o clique da pessoa manda sobre o estado do dado", () => {
  // Fechou com pendencia aberta: continua fechado. Sem isto, a releitura das
  // alíquotas reabriria o painel e ela clicaria de novo achando que a tela nao
  // obedece.
  assert.equal(painelDeAliquotaAberto({ abertoPeloUsuario: false, lendo: false, canaisSemAliquota: 3 }), false);
  // Abriu sem pendencia nenhuma: continua aberto.
  assert.equal(painelDeAliquotaAberto({ abertoPeloUsuario: true, lendo: false, canaisSemAliquota: 0 }), true);
});

test("enquanto le, fica recolhido — 'ainda nao sei' nao e pendencia", () => {
  // Abrir e fechar sozinho no meio do carregamento e salto de layout. E o
  // estado inicial das linhas e `carregando`, entao sem esta regra o painel
  // piscaria aberto em toda visita.
  assert.equal(painelDeAliquotaAberto({ abertoPeloUsuario: null, lendo: true, canaisSemAliquota: 0 }), false);
  assert.equal(painelDeAliquotaAberto({ abertoPeloUsuario: null, lendo: true, canaisSemAliquota: 4 }), false);
});

test("o recolhido nunca escreve 0% para quem nao cadastrou", () => {
  // `null` != `0` (AGENTS.md): zero e isencao DECLARADA. Um resumo que mostrasse
  // "0%" para alíquota ausente afirmaria isencao no lugar da vendedora.
  assert.equal(aliquotaEmTexto(null), "sem alíquota");
  assert.equal(aliquotaEmTexto(0), "0%");
  assert.equal(aliquotaEmTexto(8.5), "8,5%");
  assert.equal(aliquotaEmTexto(12), "12%");
});

test("a pendencia diz O QUE falta, com numero e nome do canal", async () => {
  // AGENTS.md: nada de "parcial"/"incompleto" nem adjetivo que se desculpa.
  const componente = await fonte("src/app/components/AliquotasPorCanal.tsx");
  const trecho = componente.slice(componente.indexOf("aliquotas-pendencia"));
  assert.match(trecho, /canal sem alíquota cadastrada/);
  assert.match(trecho, /semAliquota\.map\(\(c\) => c\.nome\)/, "a frase precisa nomear os canais");
  assert.ok(!/parcial|incompleto/i.test(componente), "o painel nao se desculpa: diz o que falta");
});

test("recolhido nao esconde o formulario de quem precisa dele", async () => {
  // O 4o passo do tour aponta para este painel e manda cadastrar. Quem chega
  // novo nao tem alíquota nenhuma, entao o estado B ja deixa o formulario
  // aberto — mas o corpo precisa continuar alcancavel pelo botao.
  const componente = await fonte("src/app/components/AliquotasPorCanal.tsx");
  assert.match(componente, /aria-expanded=\{aberto\}/);
  assert.match(componente, /aria-controls=\{corpoId\}/);
  assert.match(componente, /id=\{corpoId\} hidden=\{!aberto\}/);
});
