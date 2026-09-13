import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("a faixa do monitor Amazon usa os mesmos trilhos largos do ML", async () => {
  // Defeito visual medido em 13/09/2026: a Amazon cravava cinco trilhos e
  // esticava cada cartão para 316px; o ML preservava o contrato de sete trilhos
  // e cartões de 223px, deixando o restante da faixa respirar.
  const fonte = await readFile(new URL("../src/app/globals.css", import.meta.url), "utf8");
  const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(codigo, /\.amazon-monitor-faixa\s*\{\s*--colunas:\s*7;/,
    "a faixa Amazon voltou a esticar cinco cartões pela largura inteira");
});
