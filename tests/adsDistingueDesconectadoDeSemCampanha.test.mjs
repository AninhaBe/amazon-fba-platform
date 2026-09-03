import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import "../scripts/ts-resolver.mjs";

// ⚠️ DOIS SILÊNCIOS QUE NÃO PODEM TER A MESMA FRASE.
//
// 🔴 O DEFEITO, medido em 02/09/2026: quem nunca autorizou o Ads via *"Nenhum
// produto anunciado neste período"* — a mensagem do caso **conectado e sem
// campanha**. Para quem não conectou, ela é FALSA: diz que a pessoa não
// anunciou, quando o que falta é a autorização. E `/ads/como-ligar` existia sem
// nenhum caminho até ela.
//
// 📌 É a doutrina da casa invertida — *"tela sem dado mostra o estado real,
// nunca zeros que pareçam 'não vendeu nada'"*. Aqui o estado real é "você ainda
// não conectou seus anúncios", e a tela dizia "você não anunciou".
//
// 📌 E o efeito colateral disso durou meses: a aba parecia "só da dona do
// produto". O OAuth, o cron e a rota SEMPRE foram por workspace — só ela tinha
// autorizado porque ninguém mais conseguia achar o botão.

// ⚠️ O caso de COMPORTAMENTO (workspace sem credencial responde `false`) vive em
// `tests-integracao/adsEstadoDaCredencial` — ele precisa de banco, e um teste da
// suíte unitária que abre conexão acabaria batendo no banco de produção.
test("o contrato do /ads diz se o workspace CONECTOU, por canal", async () => {
  const fonte = await readFile(new URL("../src/lib/adsMultiCanal.ts", import.meta.url), "utf8");
  // Ancorado na DEFINIÇÃO de onde o estado nasce, não no nome do campo: casar
  // `credenciais` continuaria verde se alguém trocasse a fonte uma linha acima.
  assert.ok(fonte.includes("  const credenciais = await lerEstadoDasCredenciais(workspaceId);"),
    "o estado tem de sair de uma leitura por workspace");
  assert.ok(fonte.includes("WHERE workspace_id = $1 AND key = 'amazon_ads_oauth'"),
    "a credencial da Amazon e por workspace — nunca global");
  assert.ok(fonte.includes("return { period: { from: deISO, to: ateISO }, canais, produtos, campanhas, credenciais };"),
    "e tem de SAIR no payload, senao a tela nao consegue distinguir os dois silencios");
});

test("é POR CANAL, e não um booleano só", () => {
  // A Amazon pode estar conectada e o ML não. Um "conectado" global responderia
  // certo para um e errado para o outro — e a tela precisa oferecer o botão do
  // canal que falta, não um genérico.
  return readFile(new URL("../src/lib/adsMultiCanal.ts", import.meta.url), "utf8").then((fonte) => {
    assert.ok(fonte.includes("  credenciais: EstadoDaCredencial[];"), "uma entrada por canal");
    assert.ok(fonte.includes('{ provider: "amazon", conectado: Number(amazon[0]?.n ?? 0) > 0, conectarEm: "/api/ads/connect" },'),
      "e cada canal leva PARA ONDE conectar — sem isso a tela sabe o problema e nao a saida");
  });
});

test("a leitura da credencial é do INQUILINO, e não do banco inteiro", async () => {
  const fonte = await readFile(new URL("../src/lib/adsMultiCanal.ts", import.meta.url), "utf8");
  const funcao = fonte.slice(fonte.indexOf("async function lerEstadoDasCredenciais"));
  // ⚠️ A leitura da Amazon é SQL daqui e filtra por workspace_id. Sem o filtro,
  // ela responderia "conectado" para todo mundo assim que UM cliente
  // autorizasse — e a tela ofereceria dado que o workspace não tem.
  assert.match(funcao, /WHERE workspace_id = \$1 AND key = 'amazon_ads_oauth'/,
    "a credencial da Amazon e por inquilino");
  // ⚠️ E a do ML NÃO é SQL aqui, de propósito: `providerIsolation` proíbe módulo
  // fora de `integrations/` de consultar canal por nome, e a guarda está certa —
  // conhecimento de canal espalhado é como trocar o vocabulário de um provider
  // vira caça a string pelo repo. O escopo vem do `integrationStore`.
  assert.match(funcao, /getIntegrations\("mercado_livre"\)/,
    "o ML passa pela camada de integracoes, nao por SQL solto");
  const codigo = funcao.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(codigo, /provider = 'mercado_livre'/,
    "canal por nome fora de integrations/ e a regra de arquitetura sendo quebrada");
});
