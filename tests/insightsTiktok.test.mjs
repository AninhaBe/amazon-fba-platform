import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Fase 2 do briefing por canal — TikTok Shop (ordem da Ana, 27/08/2026). O
// lucro só existe com ledger LIQUIDADO e componentes conhecidos (a autoridade
// já aplicada dentro do overview canônico); a fila financeira não é tocada.

test("os 3 detectores do TikTok estão registrados com provider explícito", async () => {
  const registry = await readFile(new URL("../src/lib/insights/registry.ts", import.meta.url), "utf8");
  for (const nome of ["tiktokRupturaDetector", "tiktokVelocidadeDetector", "tiktokMargemDetector"]) {
    assert.match(registry, new RegExp(nome), `${nome} fora do registry`);
  }
  for (const arquivo of ["tiktokRuptura", "tiktokVelocidade", "tiktokMargem"]) {
    const fonte = await readFile(new URL(`../src/lib/insights/detectors/${arquivo}.ts`, import.meta.url), "utf8");
    assert.match(fonte, /provider: PROVIDER/, `${arquivo} sem provider explícito`);
    assert.match(fonte, /shop\.shopId/, `${arquivo} sem a loja no fingerprint`);
  }
});

test("margem TikTok respeita a autoridade do ledger e a alíquota por loja", async () => {
  const fonte = await readFile(new URL("../src/lib/insights/detectors/tiktokMargem.ts", import.meta.url), "utf8");
  const semAliquota = fonte.indexOf("shop.taxRate == null");
  const autoridade = fonte.indexOf("data.overview.profit == null");
  assert.ok(semAliquota > -1 && autoridade > -1 && semAliquota < autoridade);
  assert.match(fonte, /Cadastre a alíquota/);
  // profit/marginPct nulos = ledger aberto ou componente desconhecido → não
  // avaliar (null nunca vira 0); a autoridade vive no overview canônico.
  assert.match(fonte, /profit == null \|\| data\.overview\.marginPct == null\) continue/);
  assert.match(fonte, /getTiktokOverviewFromCanonical/);
  // Fila financeira intocada: o detector só LÊ o overview — nada de scheduler
  // ou pipeline financeiro.
  assert.doesNotMatch(fonte, /tiktokFinancialScheduler|tiktokFinancialPipeline|runTiktokFinancialScheduler/);
});

test("velocidade TikTok usa os status confirmados do canal e os mesmos limiares", async () => {
  const fonte = await readFile(new URL("../src/lib/insights/detectors/tiktokVelocidade.ts", import.meta.url), "utf8");
  assert.match(fonte, /\["paid", "shipped", "delivered"\]/);
  assert.match(fonte, /DROP_THRESHOLD = 0\.25/);
  assert.match(fonte, /MIN_PREVIOUS_UNITS = 5/);
  assert.match(fonte, /unidadesPorSku/);
});

test("ruptura TikTok usa o módulo de estoque com a classificação compartilhada, com teto de páginas", async () => {
  const fonte = await readFile(new URL("../src/lib/insights/detectors/tiktokRuptura.ts", import.meta.url), "utf8");
  assert.match(fonte, /readInventory/);
  assert.match(fonte, /item\.cobertura !== "out" && item\.cobertura !== "critical"/);
  assert.match(fonte, /MAX_PAGES/);
  assert.match(fonte, /\/tiktok\/estoque/);
});
