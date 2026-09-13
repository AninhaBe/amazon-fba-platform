import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("a faixa do monitor mantém a altura do cartão de referência", async () => {
  // Defeito visual medido em 13/09/2026: os cartões Amazon ficavam em 110px,
  // enquanto o Mercado Livre chegava a 126px quando a nota de Margem quebrava.
  const fonte = await readFile(new URL("../src/app/globals.css", import.meta.url), "utf8");
  const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(codigo, /\.ml-monitor-body \.v3-colunas \.v3-coluna \{[\s\S]*?min-height: 126px;/,
    "a faixa do monitor pode voltar a ter alturas diferentes entre os canais");
});
