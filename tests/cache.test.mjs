import test from "node:test";
import assert from "node:assert/strict";
import { cachedByKey as cached, cacheSize, clearCache, MAX_ENTRIES } from "../src/lib/memoryCache.ts";

// O cache guarda resultados por chave de consulta (termo pesquisado, período,
// página), então o número de chaves cresce com o uso. Sem despejo, o processo
// acumula tudo até estourar a memória do container — foi o que derrubou o
// serviço em 09/08/2026.

test("entrega do cache enquanto está no prazo", async () => {
  clearCache();
  let chamadas = 0;
  const buscar = () => cached("k", 60_000, async () => ++chamadas);
  assert.equal(await buscar(), 1);
  assert.equal(await buscar(), 1, "segunda chamada não deve reexecutar");
  assert.equal(chamadas, 1);
});

test("entrada vencida é REMOVIDA, não só ignorada", async () => {
  clearCache();
  await cached("vencida", 1, async () => "v");
  assert.equal(cacheSize(), 1);
  await new Promise((r) => setTimeout(r, 5));
  await cached("vencida", 1, async () => "v2");
  assert.equal(cacheSize(), 1, "não pode acumular duas entradas para a mesma chave");
});

test("não cresce além do teto, por mais consultas distintas que cheguem", async () => {
  clearCache();
  for (let i = 0; i < MAX_ENTRIES * 2; i++) {
    await cached(`busca:${i}`, 60_000, async () => `r${i}`);
  }
  assert.ok(
    cacheSize() <= MAX_ENTRIES,
    `esperava no máximo ${MAX_ENTRIES} entradas, tinha ${cacheSize()}`
  );
});

test("ao despejar, descarta as mais antigas e mantém as recentes", async () => {
  clearCache();
  for (let i = 0; i < MAX_ENTRIES + 50; i++) {
    await cached(`item:${i}`, 60_000, async () => i);
  }
  // A última inserida tem de continuar viva sem reexecutar a função.
  let reexecutou = false;
  const ultima = MAX_ENTRIES + 49;
  const valor = await cached(`item:${ultima}`, 60_000, async () => {
    reexecutou = true;
    return -1;
  });
  assert.equal(valor, ultima);
  assert.equal(reexecutou, false, "a entrada mais recente não deveria ter sido despejada");
});

test("erro não fica grudado no cache", async () => {
  clearCache();
  await assert.rejects(() => cached("falha", 60_000, async () => { throw new Error("boom"); }));
  const valor = await cached("falha", 60_000, async () => "ok agora");
  assert.equal(valor, "ok agora");
});

test("entradas vencidas saem na varredura de despejo", async () => {
  clearCache();
  for (let i = 0; i < MAX_ENTRIES; i++) {
    await cached(`curta:${i}`, 1, async () => i);
  }
  await new Promise((r) => setTimeout(r, 5));
  await cached("nova", 60_000, async () => "n");
  assert.ok(cacheSize() < MAX_ENTRIES, "as vencidas deveriam ter sido varridas");
});
