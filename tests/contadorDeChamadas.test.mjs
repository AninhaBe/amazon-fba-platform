import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { acumuladoAtual, registrarChamada } from "../src/lib/integrations/contadorDeChamadas.ts";

// 29/08/2026 — a Shopee abriu alerta de comportamento anormal contra o app e a
// pergunta "quantas chamadas por endpoint e por hora?" NAO TINHA COMO SER
// RESPONDIDA: nao existia contador em canal nenhum. A resposta teve que ser
// derivada de codigo e configuracao. Chegar sem dado numa segunda vez seria
// escolha, nao fatalidade.

test("soma por endpoint e por hora, e separa por conexao", () => {
  registrarChamada("shopee", "/api/v2/payment/get_escrow_detail", { status: 200, connectionId: "shopee:275804987" });
  registrarChamada("shopee", "/api/v2/payment/get_escrow_detail", { status: 200, connectionId: "shopee:275804987" });
  registrarChamada("shopee", "/api/v2/order/get_order_detail", { status: 200, connectionId: "shopee:275804987" });
  registrarChamada("shopee", "/api/v2/payment/get_escrow_detail", { status: 200, connectionId: "shopee:outra" });

  const linhas = acumuladoAtual();
  const escrow = linhas.find(
    (l) => l.endpoint === "/api/v2/payment/get_escrow_detail" && l.connectionId === "shopee:275804987"
  );
  assert.equal(escrow?.chamadas, 2, "duas chamadas ao mesmo endpoint viram uma linha com contagem 2");
  const detalhe = linhas.find((l) => l.endpoint === "/api/v2/order/get_order_detail");
  assert.equal(detalhe?.chamadas, 1);
  const outra = linhas.find(
    (l) => l.endpoint === "/api/v2/payment/get_escrow_detail" && l.connectionId === "shopee:outra"
  );
  assert.equal(outra?.chamadas, 1, "o limite da Shopee e POR LOJA: somar lojas diferentes esconderia a origem");
});

test("erro conta como chamada E como erro — a plataforma ve as duas", () => {
  registrarChamada("mercado_livre", "/orders/:id", { status: 429, erro: true, connectionId: "ml:1" });
  const linha = acumuladoAtual().find((l) => l.provider === "mercado_livre" && l.endpoint === "/orders/:id");
  assert.equal(linha?.chamadas, 1);
  assert.equal(linha?.erros, 1);
  assert.equal(linha?.ultimoStatus, 429);
});

test("registrar nunca lanca — instrumentacao nao derruba o que observa", () => {
  assert.doesNotThrow(() => registrarChamada("amazon", "/orders/v0/orders", undefined));
  // @ts-expect-error entrada torta de proposito
  assert.doesNotThrow(() => registrarChamada("amazon", null, { status: "nao e numero" }));
});

test("OS QUATRO canais contam — um de fora deixa o buraco onde o proximo alerta cai", async () => {
  const funis = [
    // A Shopee conta na camada HTTP, nao em shopeeFetch: aquele laco tenta ate
    // TRES vezes e a plataforma conta cada tentativa. Contar acima esconderia
    // justamente as repeticoes, que e o que um alerta enxerga.
    ["../src/lib/integrations/shopeeHttp.ts", /registrarChamada\("shopee"/],
    ["../src/lib/integrations/mercadoLivre.ts", /registrarChamada\("mercado_livre"/],
    ["../src/lib/spapi.ts", /registrarChamada\("amazon"/],
    ["../src/lib/tiktok.ts", /registrarChamada\("tiktok_shop"/],
  ];
  for (const [caminho, padrao] of funis) {
    const fonte = await readFile(new URL(caminho, import.meta.url), "utf8");
    assert.match(fonte, padrao, `${caminho} nao conta as chamadas que faz`);
  }
});

test("o endpoint entra pelo FORMATO, nunca pelo valor", async () => {
  // Contador por valor responderia "quantas vezes chamei ESTE pedido" em vez de
  // "quantas vezes chamei este endpoint" — e criaria uma linha por pedido.
  const ml = await readFile(new URL("../src/lib/integrations/mercadoLivre.ts", import.meta.url), "utf8");
  assert.match(ml, /function caminhoDoRecurso/);
  const amazon = await readFile(new URL("../src/lib/spapi.ts", import.meta.url), "utf8");
  assert.match(amazon, /function caminhoDoEndpoint/);
});

test("a tabela tem prazo de validade — ADR-016", async () => {
  const retencao = await readFile(new URL("../src/lib/retencao.ts", import.meta.url), "utf8");
  assert.match(retencao, /RETENCAO_CHAMADAS_DIAS = 90/);
  assert.match(retencao, /DELETE FROM marketplace_api_calls/);
  const cron = await readFile(new URL("../src/app/api/cron/retencao/route.ts", import.meta.url), "utf8");
  assert.match(cron, /expurgarChamadasAntigas\(\)/, "expurgo que ninguem chama nao e retencao, e intencao");
});
