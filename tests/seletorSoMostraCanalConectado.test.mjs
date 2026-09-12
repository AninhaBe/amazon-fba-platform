import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { canaisDoCorpo, canalEntraNoSeletor } from "../src/app/components/useCanaisConectados.ts";

const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");

/**
 * O PEDIDO QUE ESTE ARQUIVO GUARDA — dona do produto, 12/09/2026:
 * *"só vai aparecer as integrações no menu que a pessoa esteja conectada (para
 * os admins aparecem todas)"*.
 *
 * ⚠️ TODO DADO AQUI E FABRICADO, e nos DOIS lados de cada
 * fronteira. A conta dela tem os quatro canais conectados: um teste que só
 * usasse o estado dela nunca exercitaria o caso "provedor listado com ZERO
 * conexões", que é exatamente onde o filtro nasce errado sem ficar vermelho.
 */

test("conectado e ter CONEXAO, nao aparecer na lista de provedores", () => {
  // ⚠️ A ROTA DEVOLVE OS QUATRO PROVEDORES SEMPRE. Ler
  // `providers.map(id)` daria "os quatro conectados" em todo workspace e o
  // filtro inteiro viraria enfeite — a tela seguiria mostrando os quatro.
  const canais = canaisDoCorpo({
    providers: [
      { id: "amazon", connections: [{ id: "amazon:AO62" }] },
      { id: "mercado_livre", connections: [] },
      { id: "shopee" },
      { id: "tiktok_shop", connections: [{ id: "tiktok_shop:1" }, { id: "tiktok_shop:2" }] },
    ],
  });
  assert.deepEqual([...canais].sort(), ["amazon", "tiktok_shop"]);
  assert.equal(canais.has("mercado_livre"), false, "provedor com lista VAZIA entrou como conectado");
  assert.equal(canais.has("shopee"), false, "provedor SEM o campo entrou como conectado");
});

test("corpo vazio nao inventa canal", () => {
  assert.equal(canaisDoCorpo({}).size, 0);
  assert.equal(canaisDoCorpo({ providers: [] }).size, 0);
});

test("a REGRA da listagem, ramo a ramo", () => {
  const so_amazon = new Set(["amazon"]);
  const base = { canais: so_amazon, ehAdmin: false, atual: "overview" };

  // A central nunca sai: ela nao e canal, e e para onde o seletor volta.
  assert.equal(canalEntraNoSeletor("overview", { ...base, canais: new Set() }), true);

  // O pedido em si.
  assert.equal(canalEntraNoSeletor("amazon", base), true, "canal conectado sumiu do menu");
  assert.equal(canalEntraNoSeletor("shopee", base), false, "canal NAO conectado continua no menu");

  // "para os admins aparecem todas" — inclusive com zero conexoes.
  const admin = { canais: new Set(), ehAdmin: true, atual: "overview" };
  for (const canal of ["amazon", "mercado_livre", "shopee", "tiktok_shop"]) {
    assert.equal(canalEntraNoSeletor(canal, admin), true, `admin deixou de ver ${canal}`);
  }

  // Onde a pessoa ESTA entra sempre: um seletor que nao lista a tela atual
  // perde o destaque do item corrente e mente sobre para onde voltar.
  assert.equal(canalEntraNoSeletor("shopee", { ...base, atual: "shopee" }), true,
    "o canal aberto sumiu do proprio seletor");
});

test("enquanto NAO SE SABE, o menu nao pisca a lista cheia", () => {
  // ⚠️ ESTE E O RAMO QUE UMA IMPLEMENTACAO INGENUA ERRA: com
  // `canais` ainda desconhecido, mostrar os quatro e cortar depois faz piscar
  // na tela exatamente o que ela pediu para esconder. Mesma disciplina do
  // `useEhAdmin`, que so libera o link DEPOIS da confirmacao do servidor.
  const carregando = { canais: null, ehAdmin: false, atual: "amazon" };
  assert.equal(canalEntraNoSeletor("overview", carregando), true);
  assert.equal(canalEntraNoSeletor("amazon", carregando), true, "o canal atual sumiu enquanto carregava");
  for (const canal of ["mercado_livre", "shopee", "tiktok_shop"]) {
    assert.equal(canalEntraNoSeletor(canal, carregando), false,
      `${canal} apareceu antes de o servidor confirmar que existe conexao`);
  }
});

test("se a rota falhar, degrada para o comportamento de HOJE — nao para um menu vazio", () => {
  // Um 500 passageiro nao pode fazer os canais da pessoa desaparecerem: quem
  // tem quatro canais e ve um menu de um item acha que perdeu as contas.
  const semResposta = { canais: "indisponivel", ehAdmin: false, atual: "overview" };
  for (const canal of ["amazon", "mercado_livre", "shopee", "tiktok_shop"]) {
    assert.equal(canalEntraNoSeletor(canal, semResposta), true, `${canal} sumiu quando a rota falhou`);
  }
});

test("as DUAS telas com seletor usam a MESMA regra — e a de Integracoes esquece o cache", async () => {
  // ⚠️ O RISCO E APLICAR EM UMA E ESQUECER A OUTRA: o menu do
  // desktop e a tira do celular sao componentes diferentes, e um defeito que so
  // aparece num tamanho de tela e do tipo que ninguem ve ate um cliente ver.
  // ⚠️ CASAR `canalEntraNoSeletor(` NAO PROVA NADA, e esta guarda
  // ficou VERDE com o defeito posto na primeira versao: apaguei o filtro do
  // `map` do mobile e o nome continuou no arquivo, na linha que calcula a lista
  // e ninguem mais usa. So apareceu porque a quebra foi RODADA. O que prova e a
  // CHAMADA DE RENDER — e a ausencia da lista crua.
  const LISTAGEM = [
    ["src/app/components/SidebarNexo.tsx",
     "CANAIS.filter((canal) => canalEntraNoSeletor(canal.id, { canais: canaisConectados, ehAdmin, atual: workspace })).map((canal) => (",
     "CANAIS.map("],
    ["src/app/components/ChannelSwitcher.tsx",
     "{visiveis.map((channel) => (",
     "channels.map("],
  ];
  for (const [arquivo, renderFiltrado, listaCrua] of LISTAGEM) {
    const tsx = await fonte(arquivo);
    const codigo = tsx.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.ok(codigo.includes(renderFiltrado),
      `${arquivo}: o seletor parou de desenhar a lista FILTRADA`);
    assert.ok(!codigo.includes(listaCrua),
      `${arquivo}: a lista crua voltou para o render — o menu mostra canal nao conectado de novo`);
    assert.match(tsx, /useCanaisConectados\(\)/, `${arquivo}: parou de perguntar o que esta conectado`);
    assert.match(tsx, /useEhAdmin\(\)/, `${arquivo}: perdeu a excecao do admin`);
  }
  // Conectar volta de um redirect (pagina nova); desconectar acontece aqui
  // dentro, sem recarregar — sem esta chamada o canal removido fica no menu.
  const integracoes = await fonte("src/app/(app)/integracoes/page.tsx");
  assert.match(integracoes, /esquecerCanaisConectados\(\);/,
    "a tela de Integracoes parou de invalidar o cache do seletor");
});
