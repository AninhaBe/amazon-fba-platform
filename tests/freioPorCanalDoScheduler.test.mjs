import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Incidente de 29/08/2026: para parar a fonte de demanda foi preciso desligar o
// agendador INTEIRO, e para religar nao havia como subir um canal de cada vez.
// Voltar os quatro juntos depois de um incidente sobe a variavel e o controle no
// mesmo movimento — se der ruim, nao se sabe se foi o canal ou o religamento.

const fonte = () => readFile(new URL("../src/instrumentation.ts", import.meta.url), "utf8");

test("existe freio POR CANAL, e o padrao continua sendo todos", async () => {
  const src = await fonte();
  assert.match(src, /process\.env\.SCHEDULER_CANAIS/);
  // Vazio/ausente = todos: o comportamento normal nao muda.
  assert.match(src, /pedidos\.length \? TODOS_OS_SYNCS\.filter/);
});

test("nome desconhecido AVISA e e ignorado — nao derruba o agendador", async () => {
  const src = await fonte();
  // Erro de digitacao num incidente as 3h nao pode deixar a conta sem sync nenhum.
  assert.match(src, /SCHEDULER_CANAIS ignora nome desconhecido/);
  assert.doesNotMatch(src, /throw new Error\([^)]*SCHEDULER_CANAIS/);
});

test("quando roda parcial, o log DIZ quais canais estao de pe", async () => {
  const src = await fonte();
  assert.match(src, /rodando SO os canais/);
});

test("os quatro canais seguem declarados num lugar so", async () => {
  const src = await fonte();
  for (const canal of ["amazon-sync", "mercado-livre-sync", "shopee-sync", "tiktok-sync"]) {
    assert.match(src, new RegExp(canal));
  }
});
