import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { registrarDesistencia } from "../src/lib/integrations/amazonSync.ts";
import { SpApiError } from "../src/lib/spapi.ts";

// ⚠️ POR QUE ESTE TESTE EXISTE (29/08/2026)
//
// Os tres `catch` de amazonSync.ts engoliam o erro em silencio. Medido em
// producao: /finances/2024-06-19/transactions recusa ~20% das chamadas (62, 57 e
// 64 erros em tres horas seguidas), TODAS 429, e a mesma chamada chega a
// `tentativa: 4` — com maxRetries=3 a quarta lanca. O resultado no banco:
// 22.347 pedidos da Amazon, 22.347 sem carimbo de tentativa, 0 liquidados.
//
// Silencio nao e ausencia de erro; e ausencia de registro. Foi assim que o
// escrow da Shopee morreu depois de meses funcionando.

function capturarWarn(fn) {
  const original = console.warn;
  const linhas = [];
  console.warn = (...args) => linhas.push(args);
  try { fn(); } finally { console.warn = original; }
  return linhas;
}

test("a desistencia por 429 registra motivo, status, endpoint e o id do pedido a Amazon", () => {
  const erro = new SpApiError(
    "AMAZON_RATE_LIMIT", 429, true, "Limite de chamadas atingido",
    "/finances/2024-06-19/transactions", "TooManyRequests", "abc-123-req"
  );
  const [[titulo, dados]] = capturarWarn(() =>
    registrarDesistencia("tarifas-pela-transactions", erro, { connectionId: "amazon:X", pedidosSemTarifa: 40 })
  );
  assert.match(titulo, /amazon-sync/);
  assert.equal(dados.etapa, "tarifas-pela-transactions");
  assert.equal(dados.motivo, "AMAZON_RATE_LIMIT");
  assert.equal(dados.status, 429);
  assert.equal(dados.endpoint, "/finances/2024-06-19/transactions");
  // Sem o requestId a recusa e irrespondivel: e o que a Amazon pede no suporte.
  assert.equal(dados.amazonRequestId, "abc-123-req");
  // O contexto do chamador precisa sobreviver: sem "40 pedidos" nao da para
  // dimensionar o buraco lendo o log.
  assert.equal(dados.pedidosSemTarifa, 40);
  assert.equal(dados.connectionId, "amazon:X");
});

test("erro que nao e da SP-API tambem deixa rastro, sem quebrar", () => {
  const [[, dados]] = capturarWarn(() =>
    registrarDesistencia("itens-do-pedido", new TypeError("fetch failed"), { pedido: "701-1" })
  );
  assert.equal(dados.motivo, "TypeError");
  assert.equal(dados.status, null);
  assert.match(dados.detalhe, /fetch failed/);
  assert.equal(dados.pedido, "701-1");
});

test("nao sobra nenhum catch mudo em amazonSync", async () => {
  const fonte = await readFile(new URL("../src/lib/integrations/amazonSync.ts", import.meta.url), "utf8");
  assert.ok(!/\}\s*catch\s*\{/.test(fonte), "catch sem variavel de erro nao consegue registrar nada");
  assert.equal((fonte.match(/registrarDesistencia\(/g) ?? []).length, 4, "os 3 catch chamam, mais a declaracao");
});

test("REGISTRAR NAO E MUDAR: o return e os dois break continuam onde estavam", async () => {
  const fonte = await readFile(new URL("../src/lib/integrations/amazonSync.ts", import.meta.url), "utf8");
  // O pedido do cerebro foi explicito: nao muda quando chama, nem quantas vezes,
  // nem o que grava. Se alguem "melhorar" isso trocando o break por continue, o
  // lote passa a queimar cota contra um 429 — e ai vira mudanca de comportamento
  // sem ADR.
  for (const [etapa, saida] of [
    ["tarifas-pela-transactions", "return;"],
    ["itens-do-pedido", "break;"],
    ["reverificacao-de-pedido", "break;"],
  ]) {
    const i = fonte.indexOf(`registrarDesistencia("${etapa}"`);
    assert.ok(i > 0, `${etapa}: chamada nao encontrada`);
    const depois = fonte.slice(i, i + 400);
    assert.ok(depois.includes(saida), `${etapa}: a saida do catch precisa continuar sendo ${saida}`);
  }
});
