import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Fase 2 do briefing por canal — Shopee (ordem da Ana, 27/08/2026). Replicar é
// reimplementar com o que o canônico do canal realmente tem, sem extrapolar.

test("os 3 detectores da Shopee estão registrados com provider explícito", async () => {
  const registry = await readFile(new URL("../src/lib/insights/registry.ts", import.meta.url), "utf8");
  for (const nome of ["shopeeRupturaDetector", "shopeeVelocidadeDetector", "shopeeMargemDetector"]) {
    assert.match(registry, new RegExp(nome), `${nome} fora do registry`);
  }
  for (const arquivo of ["shopeeRuptura", "shopeeVelocidade", "shopeeMargem"]) {
    const fonte = await readFile(new URL(`../src/lib/insights/detectors/${arquivo}.ts`, import.meta.url), "utf8");
    assert.match(fonte, /provider: PROVIDER/, `${arquivo} sem provider explícito`);
    assert.match(fonte, /connection\.externalAccountId/, `${arquivo} sem a loja no fingerprint`);
  }
});

test("margem Shopee é no nível da LOJA — o contrato do canal não permite lucro por SKU", async () => {
  const fonte = await readFile(new URL("../src/lib/insights/detectors/shopeeMargem.ts", import.meta.url), "utf8");
  // O portão da alíquota vem antes de qualquer avaliação (alíquota é por loja).
  const semAliquota = fonte.indexOf("overview.profit.taxRate == null");
  const autoridade = fonte.indexOf("overview.profit.estimatedProfit == null");
  assert.ok(semAliquota > -1 && autoridade > -1 && semAliquota < autoridade);
  assert.match(fonte, /Cadastre a alíquota/);
  // estimatedProfit nulo (componente desconhecido, escrow aberto, período
  // descoberto) = não avaliar — null nunca vira 0.
  assert.match(fonte, /estimatedProfit == null \|\| overview\.profit\.marginPct == null\) continue/);
  assert.match(fonte, /:loja/);
});

test("velocidade Shopee usa os status de receita do canal e os mesmos limiares", async () => {
  const fonte = await readFile(new URL("../src/lib/insights/detectors/shopeeVelocidade.ts", import.meta.url), "utf8");
  assert.match(fonte, /\["paid", "shipped", "delivered"\]/);
  assert.match(fonte, /DROP_THRESHOLD = 0\.25/);
  assert.match(fonte, /MIN_PREVIOUS_UNITS = 5/);
  assert.match(fonte, /unidadesPorSku/);
});

test("ruptura Shopee vem do stockRadar canônico, com a premissa de agregação por anúncio", async () => {
  const fonte = await readFile(new URL("../src/lib/insights/detectors/shopeeRuptura.ts", import.meta.url), "utf8");
  assert.match(fonte, /getShopeeOverviewFromCanonical/);
  assert.match(fonte, /quantidades agregadas por anúncio/);
  assert.match(fonte, /\/shopee\/estoque/);
});
