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
  // O alerta é armado pela CONTAGEM (> 0), não pelo flag de cobertura por data —
  // capturedOrders == totalOrders por construção fazia a subtração ser sempre
  // zero e a faixa virar alarme falso.
  //
  // A classe deixou de ser `integration-message is-error` em 28/08/2026: a
  // pendência saiu de bloco solto e entrou no agrupador de pendências
  // (hierarquia de avisos). O que este teste protege nunca foi a classe — é
  // QUEM arma o alerta. A asserção passou a olhar a condição, que é a regra.
  assert.match(tela, /\{ordersAwaitingCapture > 0 && \([\s\S]{0,200}channel-module-notice/);
  assert.doesNotMatch(tela, /revenueCoverage\.complete && \([\s\S]{0,200}(integration-message is-error|channel-module-notice)/);
  // E a contagem continua sendo a única coisa que decide se a pendência existe.
  assert.match(tela, /ordersAwaitingCapture > 0 \|\| \(overview\.notasPendentes\?\.pedidos \?\? 0\) > 0/);
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
