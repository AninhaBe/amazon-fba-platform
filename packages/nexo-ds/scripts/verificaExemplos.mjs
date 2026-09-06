#!/usr/bin/env node
/**
 * ⚠️ A GUARDA DO PACOTE: todo export do `index.ts` tem exemplo, e o build
 * QUEBRA se um sumir.
 *
 * Ela roda ANTES do `tsup` no script de build, entao um export sem exemplo (ou
 * um exemplo que ficou apontando para um componente removido) reprova o build
 * inteiro em vez de gerar um `dist/` que ninguem sabe usar.
 *
 * ⚠️ E ela olha a LISTA DOS DOIS LADOS, nao so um: export sem exemplo e
 * componente que ninguem sabe montar; exemplo sem export e codigo morto
 * apontando para algo que saiu. As duas direcoes reprovam.
 *
 * ⚠️ TIPOS SAO IGNORADOS de proposito (`export type`): tipo nao renderiza, e
 * exigir exemplo para ele viraria burocracia — o tipo aparece no exemplo do
 * componente que o usa.
 */
import { readFile } from "node:fs/promises";

const raiz = new URL("../", import.meta.url);
const semComentarios = (codigo) =>
  codigo
    .split(String.fromCharCode(13)).join("")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

const indice = semComentarios(await readFile(new URL("src/index.ts", raiz), "utf8"));
const exemplos = semComentarios(await readFile(new URL("src/exemplos/exemplos.tsx", raiz), "utf8"));

/** Os `export { A, B } from "..."` — sem os `export type`, que nao renderizam. */
const exportados = [];
for (const bloco of indice.matchAll(/export\s*\{([^}]*)\}\s*from/g)) {
  const antes = indice.slice(Math.max(0, bloco.index - 6), bloco.index + 7);
  if (antes.includes("export type")) continue;
  for (const nome of bloco[1].split(",")) {
    const limpo = nome.trim();
    if (limpo) exportados.push(limpo);
  }
}

if (exportados.length === 0) {
  console.error("verificaExemplos: nenhum export encontrado no index — a guarda ficaria vazia e passaria por engano.");
  process.exit(1);
}

const problemas = [];

for (const nome of exportados) {
  // ⚠️ COM DELIMITADOR: procurar so o nome faria `ChipDeMargem` casar dentro
  // de `ChipDeMargemAntigo`, e a guarda passaria com o componente errado. Casar
  // a ABERTURA da tag (ou a chamada) prova uso, nao mencao.
  const usado = exemplos.includes("<" + nome + " ")
    || exemplos.includes("<" + nome + ">")
    || exemplos.includes("<" + nome + String.fromCharCode(10))
    || exemplos.includes(nome + "(");
  if (!usado) problemas.push(`export sem exemplo: ${nome}`);
}

// A outra direcao: exemplo apontando para algo que saiu do index.
for (const importado of exemplos.matchAll(/import\s*\{([^}]*)\}\s*from\s*"\.\.\/index"/g)) {
  for (const nome of importado[1].split(",")) {
    const limpo = nome.trim();
    if (limpo && !exportados.includes(limpo)) {
      problemas.push(`exemplo usa "${limpo}", que nao esta exportado no index`);
    }
  }
}

if (problemas.length > 0) {
  console.error("verificaExemplos REPROVOU:\n  " + problemas.join("\n  "));
  process.exit(1);
}

console.log(`verificaExemplos: ${exportados.length} exports, todos com exemplo.`);
