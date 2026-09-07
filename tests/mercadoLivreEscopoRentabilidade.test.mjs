import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Monitor Unificado, E1 (28/08/2026): o teto de 1000 pedidos detalhados do ML
// passa a ser comunicado na tabela de rentabilidade — mesma frase da referência
// Amazon. Antes, a lista cortava em silêncio.

test("o canonico expoe o escopo do detalhamento amarrado ao teto real", async () => {
  const fonte = await readFile(new URL("../src/lib/integrations/mercadoLivreOverviewCanonical.ts", import.meta.url), "utf8");
  assert.match(fonte, /profitabilityScope: \{\s*detailedOrders: linesByOrder\.size,\s*completePeriod: linesByOrder\.size < DETAILED_ORDER_LIMIT,\s*\}/);
  // O teto continua o da referência; mudou o teto, muda a comunicação junto.
  assert.match(fonte, /const DETAILED_ORDER_LIMIT = 1_000/);
});

test("o caminho legado declara que nao conhece o teto — null, nunca um escopo inventado", async () => {
  const fonte = await readFile(new URL("../src/lib/integrations/mercadoLivre.ts", import.meta.url), "utf8");
  assert.match(fonte, /profitabilityScope: null as MercadoLivreProfitabilityScope \| null/);
});

test("dashboard e monitor do ML passam a frase de escopo, e ela diz o que exibe sem se desculpar", async () => {
  const fonte = await readFile(new URL("../src/app/components/MercadoLivreWorkspace.tsx", import.meta.url), "utf8");
  // ⚠️ ERAM DOIS PONTOS DE USO ATE 07/09/2026: o dashboard e o
  // monitor. O canvas do Caminho do Dinheiro trocou a tabela do dashboard
  // pelo card `TabelaDeVendas`, que recebe a MESMA frase pela prop `escopo`.
  // Sobrou UM `scopeNote` — o do monitor —, e a frase continua nos dois
  // lugares, com nomes diferentes.
  const chamadas = fonte.match(/scopeNote=\{fraseDeEscopo\(overview\.profitabilityScope\)\}/g) ?? [];
  assert.equal(chamadas.length, 1, "o monitor — o dashboard passa a mesma frase por `escopo`");
  assert.match(fonte, /escopo=\{fraseDeEscopo\(overview\.profitabilityScope\)/,
    "o card do dashboard parou de receber a frase de escopo");
  // Período completo = sem frase (o texto padrão da tabela serve).
  assert.match(fonte, /if \(!scope \|\| scope\.completePeriod\) return undefined/);
  assert.match(fonte, /Exibindo os \$\{scope\.detailedOrders\} pedidos mais recentes\. Os totais financeiros acima consideram o período completo\./);
  // Regra da casa: nada de "parcial"/"incompleto" se desculpando na tela.
  assert.doesNotMatch(fonte, /fraseDeEscopo[^}]*parcial/i);
});
