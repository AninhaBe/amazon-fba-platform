import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("o Ritmo não oferece botão de histórico dentro do gráfico", async () => {
  // Defeito visual medido em 13/09/2026: o botão repetia a ação de histórico
  // dentro do cartão e ocupava o cabeçalho do gráfico nas duas telas do canal.
  // A proibição olha o fonte sem comentários para não casar esta explicação.
  const fonte = await readFile(new URL("../src/app/components/PainelV3.tsx", import.meta.url), "utf8");
  const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(!codigo.includes("href={dados.hrefs.historico}"), "o botão de histórico continua no cartão do Ritmo");
});
