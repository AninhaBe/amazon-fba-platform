import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Fase 2 do briefing por canal (ordem da Ana, 27/08/2026): os 3 detectores de
// insight reimplementados para o Mercado Livre com o canônico do canal —
// replicar é reimplementar, não copiar chamadas da SP-API.

test("os 3 detectores do ML estão registrados, com provider explícito nos 6", async () => {
  const registry = await readFile(new URL("../src/lib/insights/registry.ts", import.meta.url), "utf8");
  for (const nome of ["mercadoLivreRupturaDetector", "mercadoLivreVelocidadeDetector", "mercadoLivreMargemDetector"]) {
    assert.match(registry, new RegExp(nome), `${nome} fora do registry`);
  }
  for (const arquivo of ["ruptura", "velocidade", "margem"]) {
    const fonte = await readFile(new URL(`../src/lib/insights/detectors/${arquivo}.ts`, import.meta.url), "utf8");
    assert.match(fonte, /provider: "amazon"/, `${arquivo} sem provider explícito`);
  }
  for (const arquivo of ["mercadoLivreRuptura", "mercadoLivreVelocidade", "mercadoLivreMargem"]) {
    const fonte = await readFile(new URL(`../src/lib/insights/detectors/${arquivo}.ts`, import.meta.url), "utf8");
    assert.match(fonte, /provider: PROVIDER/, `${arquivo} sem provider explícito`);
  }
});

test("margem ML: alíquota ausente vira pendência de cadastro, nunca margem calculada sem imposto", async () => {
  const fonte = await readFile(new URL("../src/lib/insights/detectors/mercadoLivreMargem.ts", import.meta.url), "utf8");
  const semAliquota = fonte.indexOf("abc.taxRate == null");
  const loopDeProdutos = fonte.indexOf("for (const product of abc.products)");
  assert.ok(semAliquota > -1 && loopDeProdutos > -1);
  assert.ok(semAliquota < loopDeProdutos, "o portão da alíquota vem ANTES de qualquer margem por produto");
  assert.match(fonte, /Cadastre a alíquota/);
  assert.match(fonte, /continue;\s*\n\s*\}\s*\n\s*for \(const product/, "sem alíquota o detector pula os produtos da conta");
  // null ≠ 0: produto sem custo cadastrado fica de fora, não vira margem falsa.
  assert.match(fonte, /product\.contribution == null \|\| product\.marginPct == null\) continue/);
});

test("velocidade ML: vendas aprovadas do canônico, mesmos limiares da Amazon", async () => {
  const fonte = await readFile(new URL("../src/lib/insights/detectors/mercadoLivreVelocidade.ts", import.meta.url), "utf8");
  assert.match(fonte, /o\.status = 'paid'/);
  assert.match(fonte, /workspace_channel_order_items/);
  assert.match(fonte, /DROP_THRESHOLD = 0\.25/);
  assert.match(fonte, /MIN_PREVIOUS_UNITS = 5/);
});

test("fingerprints do ML carregam a conta — dois vendedores no mesmo workspace não colidem", async () => {
  for (const arquivo of ["mercadoLivreRuptura", "mercadoLivreVelocidade", "mercadoLivreMargem"]) {
    const fonte = await readFile(new URL(`../src/lib/insights/detectors/${arquivo}.ts`, import.meta.url), "utf8");
    assert.match(fonte, /connection\.externalAccountId/, `${arquivo} sem a conta no fingerprint`);
  }
});

test("auto-resolve por (tipo, canal) e só para detector que rodou até o fim", async () => {
  const run = await readFile(new URL("../src/lib/insights/run.ts", import.meta.url), "utf8");
  const store = await readFile(new URL("../src/lib/insights/store.ts", import.meta.url), "utf8");
  // A chave entra no conjunto DEPOIS do run() do detector — quem lançou não
  // auto-resolve os próprios insights como se tivessem sarado.
  const pushIdx = run.indexOf("candidates.push(...(await detector.run()))");
  const addIdx = run.indexOf("ranKeys.add(");
  assert.ok(pushIdx > -1 && addIdx > -1 && pushIdx < addIdx);
  // E a chave é tipo:canal — a falha do detector de um canal não resolve os
  // insights abertos do outro canal que compartilha o tipo.
  assert.match(store, /ranKeys\.has\(`\$\{r\.type\}:\$\{r\.provider\}`\)/);
});
