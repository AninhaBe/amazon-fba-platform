import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

import { ehFundo, runComoFundo } from "../src/lib/execucaoDeFundo.ts";

// Incidente de 29/08/2026: UM pool de 10 compartilhado entre a tela e o sync.
// Medido: uma carga do dashboard pede 28 transacoes — quase tres vezes o pool —
// e quatro canais batiam a cada 2 min nas mesmas 10. O fundo matou de fome quem
// esperava a tela: requisicoes morrendo em ECHECKOUTTIMEOUT e dashboard em 54s,
// com as consultas executando em 0,030ms. Nao era consulta lenta, era fila.

test("fora de trabalho de fundo, ehFundo() e false — o padrao e o usuario", () => {
  assert.equal(ehFundo(), false);
});

test("dentro de runComoFundo a marca vale, e ela NAO vaza para fora", async () => {
  const dentro = await runComoFundo(async () => ehFundo());
  assert.equal(dentro, true);
  assert.equal(ehFundo(), false, "a marca vazou para fora do escopo");
});

test("a marca atravessa await — senao metade do sync usaria o pool errado", async () => {
  const resultado = await runComoFundo(async () => {
    await new Promise((r) => setTimeout(r, 5));
    return ehFundo();
  });
  assert.equal(resultado, true);
});

test("sao DOIS pools e o fundo e MENOR — a assimetria e o ponto", async () => {
  const db = await readFile(new URL("../src/lib/db.ts", import.meta.url), "utf8");
  assert.match(db, /let poolDeFundo: Pool \| null = null/);
  assert.match(db, /const MAX_USUARIO = process\.env\.VERCEL \? 2 : 8/);
  assert.match(db, /const MAX_FUNDO = process\.env\.VERCEL \? 1 : 3/);
  // O fundo escolhe o proprio pool: e isso que torna a fome impossivel por
  // construcao, em vez de depender de escalonamento feliz.
  assert.match(db, /if \(ehFundo\(\)\)/);
  // Cada pool tem a propria variavel, para subir sem deploy quando o teto do
  // tenant for conhecido.
  assert.match(db, /"DB_POOL_MAX_FUNDO"/);
});

test("TODAS as rotas de cron se marcam como fundo — uma que esqueca anula a separacao", async () => {
  const dir = new URL("../src/app/api/cron/", import.meta.url);
  const rotas = await readdir(dir);
  assert.ok(rotas.length >= 5, "esperava ao menos os 4 canais + retencao");
  for (const rota of rotas) {
    const src = await readFile(new URL(`${rota}/route.ts`, dir), "utf8");
    assert.match(src, /runComoFundo/, `${rota}: nao se marca como fundo e vai competir com a tela`);
  }
});
