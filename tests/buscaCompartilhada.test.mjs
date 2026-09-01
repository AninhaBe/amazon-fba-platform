import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { buscaCompartilhada } from "../src/app/components/buscaCompartilhada.ts";

// Medido em producao em 28/08/2026: /api/admin/eu e /api/trial saiam DUAS vezes
// na abertura de qualquer canal, e /api/auth/accounts duas vezes na Amazon. Os
// tres ja guardavam o RESULTADO — e resultado so cobre quem monta DEPOIS da
// resposta. Quem monta DURANTE (a navegacao entre telas, justamente quando a
// pessoa espera) nao encontrava nada e perguntava de novo.

test("duas perguntas simultaneas viram uma so, e ambas recebem a resposta", async () => {
  let idas = 0;
  const buscar = () => { idas += 1; return new Promise((ok) => setTimeout(() => ok("valor"), 20)); };
  const [a, b] = await Promise.all([
    buscaCompartilhada("t:junta", buscar),
    buscaCompartilhada("t:junta", buscar),
  ]);
  assert.equal(idas, 1);
  assert.equal(a, "valor");
  assert.equal(b, "valor");
});

test("NAO e cache de resposta: depois de resolver, perguntar de novo vai de novo", async () => {
  // Segurar o resultado aqui daria dado velho a quem monta depois — e estas
  // perguntas mudam (troca de conta, teste que expira, permissao revogada).
  let idas = 0;
  const buscar = async () => { idas += 1; return idas; };
  assert.equal(await buscaCompartilhada("t:solta", buscar), 1);
  assert.equal(await buscaCompartilhada("t:solta", buscar), 2);
});

test("falha chega em quem perguntou e libera a chave para tentar de novo", async () => {
  let idas = 0;
  const quebrado = () => { idas += 1; return Promise.reject(new Error("caiu")); };
  const espera = [buscaCompartilhada("t:erro", quebrado), buscaCompartilhada("t:erro", quebrado)];
  await Promise.all(espera.map((p) => assert.rejects(p, /caiu/)));
  assert.equal(idas, 1, "as duas assinam a mesma tentativa");
  // Falha presa no mapa deixaria a tela sem nunca mais poder tentar.
  await assert.rejects(buscaCompartilhada("t:erro", quebrado), /caiu/);
  assert.equal(idas, 2);
});

test("perguntas diferentes nunca se cruzam", async () => {
  const [a, b] = await Promise.all([
    buscaCompartilhada("t:a", async () => "a"),
    buscaCompartilhada("t:b", async () => "b"),
  ]);
  assert.equal(a, "a");
  assert.equal(b, "b");
});

test("as tres perguntas repetidas da abertura usam o helper", async () => {
  const casos = [
    ["src/app/components/useEhAdmin.ts", /buscaCompartilhada\("admin\/eu"/],
    ["src/app/components/TrialNotice.tsx", /buscaCompartilhada\("trial"/],
    ["src/app/components/AccountSwitcher.tsx", /buscaCompartilhada\("auth\/accounts"/],
    ["src/app/(app)/amazon/page.tsx", /buscaCompartilhada\("auth\/accounts"/],
  ];
  for (const [caminho, padrao] of casos) {
    const fonte = await readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
    assert.match(fonte, padrao, `${caminho}: voltou a perguntar por conta propria — a segunda montagem paga de novo.`);
  }
});
