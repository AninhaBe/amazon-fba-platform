import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Regra do produto: tela sem dado mostra o ESTADO REAL — e enquanto a resposta
// não chegou, o estado real é "carregando", nunca "ainda sem dados". A race foi
// vista em 27/08/2026: o dashboard da Shopee afirmava "Ainda sem dados
// sincronizados" por um instante numa loja com 10 mil pedidos, porque o bloco
// de estado vazio renderizava entre o status das integrações e o overview.

test("Shopee: alerta de captura só dispara com contagem real, nunca por cobertura de data com zero", async () => {
  const tela = await readFile(new URL("../src/app/components/ShopeeWorkspace.tsx", import.meta.url), "utf8");
  // O alerta vermelho é armado pela contagem (> 0), não pelo flag de cobertura
  // por data — capturedOrders == totalOrders por construção fazia a subtração
  // ser sempre zero e a faixa virar alarme falso.
  assert.match(tela, /\{ordersAwaitingCapture > 0 && \([\s\S]{0,200}integration-message is-error/);
  assert.doesNotMatch(tela, /revenueCoverage\.complete && \([\s\S]{0,200}integration-message is-error/);
});

test("Shopee: sem resposta do overview renderiza carregamento antes de qualquer afirmação de vazio", async () => {
  const tela = await readFile(new URL("../src/app/components/ShopeeWorkspace.tsx", import.meta.url), "utf8");
  const gateCarregando = tela.indexOf("if (!sync && !overview && !pending) {");
  const estadoVazio = tela.indexOf("Ainda sem dados sincronizados");
  assert.ok(gateCarregando > -1, "o gate de carregamento precisa existir");
  assert.ok(estadoVazio > -1, "o estado vazio legítimo (resposta pending) continua existindo");
  assert.ok(gateCarregando < estadoVazio, "o gate de carregamento vem ANTES da afirmação de vazio");
  // O gate mostra esqueleto, não texto afirmativo.
  const trechoDoGate = tela.slice(gateCarregando, gateCarregando + 300);
  assert.match(trechoDoGate, /DashboardSkeleton/);
});
