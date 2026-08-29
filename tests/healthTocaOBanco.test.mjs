import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Incidente de 29/08/2026: por 7 minutos o app nao conseguia NENHUMA conexao
// (ECHECKOUTTIMEOUT FATAL no log, os 4 syncs falhando, toda tela com dado
// quebrada) e o /api/health respondeu 200 em ~1s, varias vezes. Duas pessoas
// leram esse verde como "o app esta de pe" e escreveram isso em reporte.
//
// Um health check que nao toca a dependencia nao e health check.

const CAMINHO = "../src/app/api/health/route.ts";
const fonte = () => readFile(new URL(CAMINHO, import.meta.url), "utf8");

test("o health TOCA o banco — sem isso ele so prova que o processo subiu", async () => {
  const src = await fonte();
  assert.match(src, /dbQuery\("SELECT 1"/, "o health precisa executar uma consulta de verdade");
});

test("banco fora devolve NAO-200 — verde falso foi o defeito do incidente", async () => {
  const src = await fonte();
  assert.match(src, /\{ status: 503 \}/, "sem 503 o monitoramento continua vendo verde");
  assert.match(src, /ok: false/);
});

test("o timeout e CURTO — health que espera na fila alimenta a saturacao", async () => {
  const src = await fonte();
  const m = /const TIMEOUT_MS = ([\d_]+)/.exec(src);
  assert.ok(m, "o timeout precisa ser explicito e nomeado");
  const ms = Number(m[1].replace(/_/g, ""));
  assert.ok(ms > 0 && ms <= 5000, `timeout de ${ms}ms: acima de 5s o health vira mais um cliente na fila do pool`);
  // 15s era o tempo do checkout que estourava no incidente — nunca esperar tanto.
  assert.ok(ms < 15000);
});

test("sem banco configurado, responde 200 e DIZ que nao checou", async () => {
  const src = await fonte();
  // Afirmar saude de dependencia que nao existe seria a mesma mentira ao contrario.
  assert.match(src, /if \(!hasDb\(\)\)/);
  assert.match(src, /banco: "nao-configurado"/);
});

test("nao vaza credencial no corpo do erro", async () => {
  const src = await fonte();
  // O nome da variavel aparece em COMENTARIO (explicando o caso sem banco), o que
  // e inofensivo. O que nao pode e o VALOR entrar na resposta.
  assert.doesNotMatch(src, /process\.env\.DATABASE_URL/);
  assert.doesNotMatch(src, /connectionString/);
  assert.match(src, /slice\(0, 120\)/, "mensagem de erro truncada, sem despejar objeto inteiro");
});

test("a razao esta escrita no arquivo, para nao ser revertida por simplificacao", async () => {
  const src = await fonte();
  assert.match(src, /postmortem-2026-08-29-pool-esgotado/);
  assert.match(src, /não é health check/i);
});
