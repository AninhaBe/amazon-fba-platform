import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { acoesDeSaude, rotuloDeCodigo, situacaoDaMetrica, NOTA_GERAL, GRUPO_DA_METRICA } from "../src/lib/integrations/shopeeAccountHealthMapa.ts";

// Saúde da conta Shopee (desenho aprovado em 28/08/2026, sondado na loja real
// antes de codar). As regras duras desta tela, travadas aqui:
// 1. situação calculada pelo comparador da PRÓPRIA API, nunca alvo chutado;
// 2. valor null vira "—" sem julgamento;
// 3. código sem fonte vira "código N da Shopee", nunca texto inventado;
// 4. NENHUM total de pontos vigentes (shop_penalty responde api_suspended);
// 5. a página diz há quanto tempo os dados foram lidos (cache honesto).

test("a situação vem do comparador da própria API — e null nunca é julgado", () => {
  // O caso real da UTILEIRA: response_rate 8,59 contra alvo >= 60 reprova.
  assert.equal(situacaoDaMetrica({ valorAtual: 8.59, alvo: 60, comparador: ">=" }), "reprovada");
  assert.equal(situacaoDaMetrica({ valorAtual: 4.83, alvo: 4.5, comparador: ">=" }), "ok");
  assert.equal(situacaoDaMetrica({ valorAtual: 0.51, alvo: 5, comparador: "<" }), "ok");
  assert.equal(situacaoDaMetrica({ valorAtual: 1.13, alvo: 1, comparador: "<" }), "reprovada");
  assert.equal(situacaoDaMetrica({ valorAtual: 0, alvo: 0, comparador: "<=" }), "ok");
  // Valor ausente = sem julgamento; comparador desconhecido idem.
  assert.equal(situacaoDaMetrica({ valorAtual: null, alvo: 5, comparador: "<" }), null);
  assert.equal(situacaoDaMetrica({ valorAtual: 3, alvo: 5, comparador: "~" }), null);
});

test("código sem fonte vira 'código N da Shopee' — nunca rótulo inventado", () => {
  assert.equal(rotuloDeCodigo({}, 2008), "código 2008 da Shopee");
  assert.equal(rotuloDeCodigo({ 1: "Mapeado" }, 1), "Mapeado");
  // Os mapas COM fonte existem e cobrem o observado.
  assert.equal(NOTA_GERAL[2], "Precisa melhorar");
  assert.deepEqual(Object.keys(GRUPO_DA_METRICA), ["1", "2", "3"]);
});

test("a leitura é cacheada 30 min e carimba lidoEm — o instante REAL da leitura", async () => {
  const fonte = await readFile(new URL("../src/lib/integrations/shopeeAccountHealth.ts", import.meta.url), "utf8");
  assert.match(fonte, /CACHE_TTL_MS = 30 \* 60_000/);
  assert.match(fonte, /lidoEm: new Date\(\)\.toISOString\(\)/);
  assert.match(fonte, /cached\(`shopee-saude:\$\{connection\.id\}`, CACHE_TTL_MS/);
  // O parâmetro obrigatório descoberto na sonda está nas duas chamadas.
  assert.equal((fonte.match(/punishment_status: String\(/g) ?? []).length, 2);
});

test("a página mostra 'lido há X min', não afirma total de pontos e degrada limpo", async () => {
  const fonte = await readFile(new URL("../src/app/components/ShopeeSaudePage.tsx", import.meta.url), "utf8");
  assert.match(fonte, /Lido da Shopee há/, "cache de 30 min precisa ser honesto na tela");
  assert.match(fonte, /não informa ao NEXO o total vigente de pontos/, "api_suspended: total não afirmável");
  assert.match(fonte, /Não foi possível ler a saúde da conta/, "falha de leitura diz isso, nunca zeros");
  assert.match(fonte, /Indisponível na demonstração/);
  // Código numérico passa pelo mapa único, nunca texto local.
  assert.match(fonte, /rotuloDeCodigo/);
  assert.doesNotMatch(fonte, /parcial/i);
});

test("a rota é a shopeeGet padrão e a demo nunca ganha número inventado", async () => {
  const rota = await readFile(new URL("../src/app/api/integrations/shopee/saude/route.ts", import.meta.url), "utf8");
  assert.match(rota, /shopeeGet\(request/);
  assert.match(rota, /isShopeeDemoConnection\(connection\)\) return \{ availability: "NOT_AVAILABLE" \}/);
});

test("a ação do briefing carrega número e o-que-fazer — o caso real da UTILEIRA", () => {
  const saude = {
    metricas: [
      { nome: "response_rate", valorAtual: 8.59, alvo: 60, comparador: ">=", unidade: 2, situacao: "reprovada" },
      { nome: "avg_preparation_time_ps", valorAtual: 1.13, alvo: 1, comparador: "<", unidade: 4, situacao: "reprovada" },
      { nome: "shop_rating", valorAtual: 4.83, alvo: 4.5, comparador: ">=", unidade: 1, situacao: "ok" },
    ],
    punicoesVigentes: [],
    anunciosComProblema: [{}, {}, {}, {}],
  };
  const acoes = acoesDeSaude(saude);
  // A métrica mais distante do alvo dá o texto: 8,59% contra 60%.
  assert.equal(acoes[0].label, "2 métrica(s) reprovada(s) na Shopee — Taxa de resposta ao comprador está em 8.59% (alvo 60%)");
  assert.equal(acoes[0].href, "/shopee/saude");
  assert.equal(acoes[1].label, "4 anúncio(s) com problema na Shopee");
  // Sem dado de saúde (fetch falhou, demo): nenhuma ação — nada inventado.
  assert.deepEqual(acoesDeSaude(null), []);
  assert.deepEqual(acoesDeSaude(undefined), []);
});

test("o dashboard usa as ações de saúde e a nav aponta para a página", async () => {
  const workspace = await readFile(new URL("../src/app/components/ShopeeWorkspace.tsx", import.meta.url), "utf8");
  assert.match(workspace, /\.\.\.acoesDeSaude\(saude\)/);
  const nav = await readFile(new URL("../src/app/components/Nav.tsx", import.meta.url), "utf8");
  assert.match(nav, /href: "\/shopee\/saude", label: "Saúde da conta"/);
});

test("o mapa de códigos tem espelho documentado com fonte", async () => {
  const doc = await readFile(new URL("../docs/api-shopee.md", import.meta.url), "utf8");
  assert.match(doc, /Account Health: códigos observados/);
  assert.match(doc, /shopeeAccountHealthMapa\.ts/);
  assert.match(doc, /api_suspended/);
});
