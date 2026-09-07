import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
const semComentarios = (codigo) =>
  codigo
    .split(String.fromCharCode(13)).join("")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const LAYOUT = "src/app/layout.tsx";
const CSS = "src/app/globals.css";

/**
 * ⚠️ O DEFEITO QUE ESTE ARQUIVO REPROVA JA ACONTECEU NESTE MESMO ARQUIVO.
 *
 * A Bricolage Grotesque foi removida em 20/08/2026 depois de virar, nas palavras
 * do proprio `layout.tsx`, *"uma fonte inteira baixada em todo page load sem
 * aparecer na tela"*: a identidade monocromatica tirou ela dos titulos e o
 * `next/font` continuou injetando o preload que ninguem consumia.
 *
 * O Archivo entrou em 06/09/2026 na MESMA situacao de partida — declarado antes
 * do primeiro consumidor existir. A diferenca e o `preload: false`: o
 * `<link rel=preload>` do `next/font` e `true` por padrao e vai para o `<head>`
 * de TODA rota, inclusive a landing e o login, que nem tem dashboard.
 *
 * Medido no build de 06/09/2026: preloads de fonte na home, 1 antes e 1 depois
 * da mudanca. A classe `.num-display` existe no CSS servido e nao veste nenhum
 * elemento — zero pixel mudou.
 */

test("o Archivo entra com preload DESLIGADO enquanto nada acima da dobra o usa", async () => {
  const codigo = semComentarios(await fonte(LAYOUT));
  const inicio = codigo.indexOf("const archivoDisplay = Archivo({");
  assert.ok(inicio >= 0, "o Archivo sumiu do layout");
  const chamada = codigo.slice(inicio, codigo.indexOf("});", inicio));

  assert.ok(chamada.includes("preload: false,"),
    "o Archivo voltou a ser pre-carregado em toda rota — é o defeito da Bricolage, palavra por palavra");
  assert.ok(chamada.includes('variable: "--font-app-display",'),
    "a familia deixou de entrar como variavel CSS: nada consegue consumi-la");
  // Peso unico: trazer a familia inteira e pagar por peso que ninguem usa.
  assert.ok(chamada.includes('weight: ["600"]'), "o Archivo passou a baixar pesos que a tela nao usa");
});

test("a variavel do Archivo chega ao html — senao a familia e inalcancavel", async () => {
  const codigo = semComentarios(await fonte(LAYOUT));
  assert.ok(codigo.includes("${archivoDisplay.variable}"),
    "a variavel do Archivo saiu do <html>: a classe existiria e cairia direto no fallback, sem ninguem notar");
});

test("o Archivo veste NUMERO GRANDE, e sempre com Inter atras", async () => {
  const css = (await fonte(CSS)).replace(/\/\*[\s\S]*?\*\//g, "");
  const inicio = css.indexOf(".num-display {");
  assert.ok(inicio >= 0, "a classe que consome o Archivo sumiu");
  const regra = css.slice(inicio, css.indexOf("}", inicio));

  // ⚠️ O FALLBACK NAO E ZELO: com `preload: false` o arquivo chega DEPOIS
  // do primeiro paint. Sem Inter atras, o numero apareceria na fonte do sistema
  // por um quadro — trocando de largura no meio de uma tabela de numeros.
  assert.ok(regra.includes("var(--font-app-display), var(--font-app-sans)"),
    "o Archivo perdeu a Inter como fallback imediato: o numero pisca na fonte do sistema antes de trocar");
});
