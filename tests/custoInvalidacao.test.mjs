import test from "node:test";
import assert from "node:assert/strict";
import { cachedByKey, clearCache, invalidateByKeyPart, cacheSize } from "../src/lib/memoryCache.ts";

// Ana trocou o custo do kit-clips-320 e o dashboard da Amazon não mudou.
// Duas causas somadas, e só uma era defeito:
//
//   1. DEFEITO — salvar custo invalidava só o snapshot do Mercado Livre. Os
//      caches da Amazon (`order-profitability:` 5 min, `amazon-overview-
//      canonical:` 60s, `amazon-abc:` 5 min) seguiam servindo o valor velho.
//      O ML respondia na hora e a Amazon não: a assimetria é que enganava.
//
//   2. NÃO é defeito — custo tem vigência. Uma troca feita hoje vale para as
//      vendas de hoje em diante; venda de 08/08 mantém o custo que tinha em
//      08/08. Coberto por `costAt`, não aqui.

test("invalidacao por trecho derruba so o que casa", async () => {
  clearCache();
  const feito = (v) => () => Promise.resolve(v);
  await cachedByKey("ws|conta|order-profitability:30d", 60_000, feito(1));
  await cachedByKey("ws|conta|amazon-abc:X:1:2", 60_000, feito(2));
  await cachedByKey("ws|conta|transactions:30d", 60_000, feito(3));
  assert.equal(cacheSize(), 3);

  const removidas = invalidateByKeyPart("order-profitability:", "amazon-abc:");
  assert.equal(removidas, 2);
  assert.equal(cacheSize(), 1, "o que nao depende de custo continua cacheado");
});

test("casa dentro da chave, nao so no comeco", async () => {
  clearCache();
  // A chave real carrega o namespace de workspace e conta antes do prefixo cru.
  await cachedByKey("workspace-1|AO62LVXJMX3AA|order-profitability:7d", 60_000, () => Promise.resolve(1));
  assert.equal(invalidateByKeyPart("order-profitability:"), 1);
  assert.equal(cacheSize(), 0);
});

test("apos invalidar, a proxima leitura recalcula", async () => {
  clearCache();
  let chamadas = 0;
  const calcular = () => { chamadas += 1; return Promise.resolve(chamadas); };

  assert.equal(await cachedByKey("ws|c|order-profitability:30d", 60_000, calcular), 1);
  assert.equal(await cachedByKey("ws|c|order-profitability:30d", 60_000, calcular), 1, "veio do cache");

  invalidateByKeyPart("order-profitability:");
  assert.equal(await cachedByKey("ws|c|order-profitability:30d", 60_000, calcular), 2, "recalculou apos a troca de custo");
});

test("invalidar sem trechos nao derruba nada", async () => {
  clearCache();
  await cachedByKey("ws|c|order-profitability:30d", 60_000, () => Promise.resolve(1));
  assert.equal(invalidateByKeyPart(), 0, "chamada vazia nao pode limpar o cache inteiro");
  assert.equal(cacheSize(), 1);
});

test("trecho que nao existe nao afeta o cache", async () => {
  clearCache();
  await cachedByKey("ws|c|transactions:30d", 60_000, () => Promise.resolve(1));
  assert.equal(invalidateByKeyPart("nao-existe:"), 0);
  assert.equal(cacheSize(), 1);
});

// Guarda de cobertura: todo cache que embute custo precisa estar na lista, e
// toda rota que grava custo precisa chamar a invalidação. A pergunta da Ana —
// "isso vale pra todas as integrações?" — só tem resposta estável se isso for
// verificado, e não lembrado.
import { readFileSync } from "node:fs";

// Lido do fonte, não importado: `costInvalidation.ts` puxa banco na cadeia de
// imports e não sobrevive ao strip-only mode dos testes.
const fonteDe = (caminho) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");

test("a lista cobre os caches de custo de todos os canais", () => {
  const fonte = fonteDe("src/lib/costInvalidation.ts");
  for (const chave of ["order-profitability:", "amazon-overview-canonical:", "amazon-abc:", "ml-abc:"]) {
    assert.ok(fonte.includes(`"${chave}"`), `${chave} precisa ser invalidada ao trocar custo`);
  }
});

test("nenhum cache com custo ficou de fora da lista", () => {
  // Varre os módulos que cacheiam e cobra que cada chave que embute custo esteja
  // coberta. Falha de propósito quando alguém adiciona um cache novo e esquece.
  const lista = fonteDe("src/lib/costInvalidation.ts");
  const comCusto = [
    ["src/lib/amazonProfitability.ts", "order-profitability:"],
    ["src/lib/integrations/amazonOverviewCanonical.ts", "amazon-overview-canonical:"],
    ["src/lib/integrations/amazonAbc.ts", "amazon-abc:"],
    ["src/lib/integrations/mercadoLivreAbc.ts", "ml-abc:"],
  ];
  for (const [modulo, chave] of comCusto) {
    assert.ok(fonteDe(modulo).includes(chave), `${modulo} deveria usar a chave ${chave}`);
    assert.ok(lista.includes(`"${chave}"`), `${chave} existe mas nao e invalidada`);
  }
});

test("toda rota que grava custo invalida os caches", () => {
  const rotas = [
    "src/app/api/costs/route.ts",                        // Amazon e ML
    "src/app/api/integrations/tiktok/costs/route.ts",    // TikTok
    "src/lib/integrations/shopeeModules.ts",             // Shopee
  ];
  for (const rota of rotas) {
    const fonte = readFileSync(new URL(`../${rota}`, import.meta.url), "utf8");
    assert.match(fonte, /invalidateCostDerivedCaches/, `${rota} grava custo sem invalidar cache`);
  }
});
