import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Crase dentro de template literal de SQL — o erro que já aconteceu SEIS vezes.
//
// Comentário SQL escrito com `coluna` entre crases fecha o template literal do
// TypeScript no meio da consulta. O `tsc` pega, mas só depois de escrever o
// arquivo inteiro, e o erro que ele dá ("',' expected") não aponta para a causa.
// Este teste aponta: arquivo, linha e o trecho.

function arquivos(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return arquivos(p);
    return e.name.endsWith(".ts") || e.name.endsWith(".tsx") ? [p] : [];
  });
}

test("nenhum comentário SQL usa crase dentro de template literal", () => {
  const problemas = [];
  for (const arquivo of arquivos("src")) {
    const linhas = fs.readFileSync(arquivo, "utf8").split(/\r?\n/);
    let dentro = false;
    linhas.forEach((linha, i) => {
      // Entra no template quando abre uma crase que não fecha na mesma linha.
      const crases = (linha.match(/`/g) ?? []).length;
      const comentarioSql = /^\s*--/.test(linha);
      if (dentro && comentarioSql && crases > 0) {
        problemas.push(`${arquivo}:${i + 1}  ${linha.trim().slice(0, 70)}`);
      }
      if (crases % 2 === 1) dentro = !dentro;
    });
  }
  assert.deepEqual(
    problemas,
    [],
    "Crase em comentário SQL fecha o template literal. Use aspas ou nada:\n" + problemas.join("\n")
  );
});
