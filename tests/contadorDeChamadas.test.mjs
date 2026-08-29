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

test("falha no expurgo do contador NAO derruba o expurgo de eventos", async () => {
  // A diferenca entre um erro pequeno e voltar aos 172 MB que a tabela de
  // eventos alcancou em 29 dias (ADR-016). A retencao de eventos e a que
  // segurava o crescimento; a do contador e acessoria e nova.
  const cron = await readFile(new URL("../src/app/api/cron/retencao/route.ts", import.meta.url), "utf8");
  const expurgoEventos = cron.indexOf("expurgarEventosProcessados(dias)");
  const expurgoChamadas = cron.indexOf("expurgarChamadasAntigas()");
  assert.ok(expurgoEventos > -1 && expurgoChamadas > -1);
  assert.ok(
    expurgoEventos < expurgoChamadas,
    "o expurgo que segura o crescimento roda PRIMEIRO — o acessorio nunca na frente do essencial"
  );
  // O `.catch` tem que estar preso a chamada do contador, nao ao bloco inteiro.
  const trecho = cron.slice(expurgoChamadas, expurgoChamadas + 260);
  assert.match(
    trecho,
    /expurgarChamadasAntigas\(\)\.catch\(/,
    "sem catch proprio, uma falha do contador aborta o expurgo de eventos junto"
  );
  assert.match(trecho, /console\.error\("\[retencao\] expurgo do contador/);
});

test("a descarga NUNCA corre no pool de usuario, nem por acidente", async () => {
  const fonte = await readFile(new URL("../src/lib/integrations/contadorDeChamadas.ts", import.meta.url), "utf8");
  // Duas garantias, e as duas importam:
  // 1. `registrarChamada` roda DENTRO de requisicao de usuario, e nao toca o
  //    banco — so soma num Map e agenda um timer.
  const registrar = fonte.slice(fonte.indexOf("export function registrarChamada"), fonte.indexOf("function agendarDescarga"));
  assert.doesNotMatch(registrar, /dbQuery|await /, "registrar chamada nao pode tocar o banco: ela roda no caminho da tela");
  // 2. A gravacao acontece so no timer, e envolvida em runComoFundo — entao
  //    mesmo que alguem a chame de dentro de um handler, ela sai pelo pool de
  //    fundo. A cerca e estrutural, nao depende de quem chama.
  const descarga = fonte.slice(fonte.indexOf("export async function descarregar"));
  assert.match(descarga, /await runComoFundo\(/, "a gravacao precisa estar dentro de runComoFundo");
  const indiceQuery = descarga.indexOf("dbQuery");
  const indiceFundo = descarga.indexOf("runComoFundo");
  assert.ok(indiceFundo < indiceQuery, "nenhuma consulta pode ficar fora do runComoFundo");
});

test("o agrupador preserva versao de API — relatorio com nome errado se le errado", async () => {
  const { caminhoAgrupado } = await import("../src/lib/integrations/contadorDeChamadas.ts");
  // A primeira versao comia `v0` e `2024-06-19` e o relatorio saia com
  // "/finances/:id/transactions". Nao atrapalha a contagem, mas nome feio e
  // nome que alguem le errado depois — e ler errado um relatorio de chamadas e
  // como se chega em conclusao errada sobre um alerta de plataforma.
  assert.equal(caminhoAgrupado("/finances/2024-06-19/transactions"), "/finances/2024-06-19/transactions");
  assert.equal(caminhoAgrupado("/finances/v0/financialEvents"), "/finances/v0/financialEvents");
  assert.equal(caminhoAgrupado("/reports/2021-06-30/reports"), "/reports/2021-06-30/reports");
  // E continua trocando o que E identificador.
  assert.equal(caminhoAgrupado("/orders/v0/orders/701-1234567-1234567"), "/orders/v0/orders/:id");
  assert.equal(caminhoAgrupado("/orders/v0/orders/701-1234567-1234567/orderItems"), "/orders/v0/orders/:id/orderItems");
  assert.equal(caminhoAgrupado("/items/123456789"), "/items/:id");
  // Query fora: ela carrega assinatura e token.
  assert.equal(caminhoAgrupado("/api/v2/order/get_order_list?sign=abc"), "/api/v2/order/get_order_list");
});

test("chamada recusada pela SP-API vira log, nao silencio", async () => {
  const spapi = await readFile(new URL("../src/lib/spapi.ts", import.meta.url), "utf8");
  assert.match(spapi, /console\.warn\("\[spapi\] chamada recusada"/);
  // Sem credencial no log: nem token, nem assinatura, nem corpo.
  const bloco = spapi.slice(spapi.indexOf('console.warn("[spapi] chamada recusada"'), spapi.indexOf('console.warn("[spapi] chamada recusada"') + 400);
  assert.doesNotMatch(bloco, /token|sign|Authorization|body/i);
});
