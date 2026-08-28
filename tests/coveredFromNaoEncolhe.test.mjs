import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// covered_from é o ponto mais antigo JÁ coberto. O re-walk pós-reopen
// (presente → alvo) fecha as janelas recentes primeiro, e o branch de avanço
// gravava covered_from = janela atual SEM LEAST — a cobertura "encolhia" para
// ontem numa loja com o período inteiro capturado (visto em produção em
// 27/08/2026: foi o que armou a faixa "0 pedido(s) aguardam captura" da
// UTILEIRA). O TikTok já usava LEAST; os quatro agora usam.

const ARQUIVOS = [
  "../src/lib/integrations/shopeeSync.ts",
  "../src/lib/integrations/mercadoLivreSync.ts",
  "../src/lib/integrations/amazonSync.ts",
  "../src/lib/integrations/tiktokSync.ts",
];

for (const arquivo of ARQUIVOS) {
  const nome = arquivo.split("/").pop();
  test(`${nome}: covered_from nunca encolhe (LEAST no avanço de janela)`, async () => {
    const fonte = await readFile(new URL(arquivo, import.meta.url), "utf8");
    assert.match(fonte, /covered_from = LEAST\(COALESCE\(covered_from, \$\d+\), \$\d+\)/);
    assert.doesNotMatch(
      fonte,
      /covered_from = \$\d+\b/,
      "atribuição direta de covered_from reintroduz o encolhimento do re-walk"
    );
  });
}
