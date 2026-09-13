import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  CHAVE_DA_JANELA,
  JANELA_DE_SETE_DIAS,
  VIEW_DA_JANELA,
  precisaBuscarAJanela,
  serieDaJanelaDeSeteDias,
  serieDoBlocoDeLucro,
} from "../src/app/components/serieDoLucroPorDia.ts";

/**
 * O DEFEITO QUE ESTE ARQUIVO REPROVA — medido em produção em 13/09/2026, na
 * conta com volume real, no dashboard do Mercado Livre.
 *
 * O cartão "Ritmo dos últimos 7 dias" aparecia VAZIO: zero colunas no DOM, só a
 * legenda, a linha de média e a nota. Medido com um observador de segundo em
 * segundo — 94 segundos com o Top 8 já preenchido (os 8 chips de margem) e o
 * ritmo ainda em zero. Não era demora. E não era falta de dado: a MESMA rota,
 * chamada da própria página, devolvia `dailySales` com 8 dias e lucro por dia
 * (11/09 → R$ 6.156,10 e R$ 982,68; 12/09 → R$ 6.881,30 e R$ 868,83).
 *
 * A CAUSA era uma leitura MEMORIZADA sobre um `Map` que vive fora do React:
 *
 *   return useMemo(() => periodCache.get(chave)?.overview.dailySales ?? null,
 *                  [chave, buscasConcluidas]);
 *
 * Quem abre a página já no filtro de 7 dias faz a chave do hook (`days=7`)
 * coincidir com a chave que a BUSCA DA PRÓPRIA PÁGINA preenche. Aí o efeito do
 * hook encontra a chave no cache, volta cedo, o contador nunca sobe, nenhuma
 * dependência do memo muda — e ele devolve para sempre o `null` do primeiro
 * render.
 *
 * ⚠️ POR QUE ISTO SOBREVIVEU DESDE 09/09: o sintoma dependia do
 * filtro em que a página ABRE. Em Hoje, 15 ou 30 dias as duas chaves são
 * diferentes, o hook busca, o contador sobe e o bloco desenha. Só a
 * aterrissagem direta no filtro de 7 dias caía no buraco — e é justamente o link
 * que se manda para alguém ("olha o ritmo desta semana").
 *
 * ⚠️ O QUE ESTES TESTES ALCANÇAM E O QUE NÃO ALCANÇAM. Este repo
 * não tem jsdom nem testing-library, então NÃO existe aqui uma montagem do
 * componente que conte as colunas no DOM. O que dá para exercitar por
 * comportamento é a DECISÃO, que por isso foi extraída para `.ts` — a mesma
 * disciplina de `serieDoBlocoDeLucro`. A asserção sobre o `.tsx` é segunda
 * linha, declarada como tal no último teste.
 */

const DIA = (data, revenue, profit) => ({ date: data, revenue, orders: 10, units: 12, profit });
const OITO_DIAS = [
  DIA("2026-09-06", 4100.5, 512.3),
  DIA("2026-09-07", 5320.1, 640.2),
  DIA("2026-09-08", 6010.9, 701.4),
  DIA("2026-09-09", 5890.4, 688.1),
  DIA("2026-09-10", 6420.7, 733.9),
  DIA("2026-09-11", 6156.1, 982.68),
  DIA("2026-09-12", 6881.3, 868.83),
  DIA("2026-09-13", 127.7, null),
];

/** A chave que o hook usa, montada como no componente. */
const CHAVE = `dashboard:${JANELA_DE_SETE_DIAS}`;

test("a série que a tela recebe é lida do cache A CADA CHAMADA — não congela no null", () => {
  // ⚠️ ESTA É A SEQUÊNCIA EXATA DE PRODUÇÃO, na ordem em que
  // aconteceu. Se a leitura voltar a ser memorizada, o segundo passo continua
  // devolvendo `null` e o teste fica vermelho.
  const cache = new Map();

  // 1. Primeiro render: a página acabou de carregar, o Map está vazio.
  assert.equal(serieDaJanelaDeSeteDias(cache, CHAVE), null,
    "sem nada no cache, a série é ausência — e ausência não é lista vazia");

  // 2. A BUSCA DA PRÓPRIA PÁGINA preenche a chave. Ninguém avisa o React.
  cache.set(CHAVE, { overview: { dailySales: OITO_DIAS } });

  // 3. Render seguinte (disparado pelo estado da página, não pelo hook): a
  //    leitura TEM de enxergar o que chegou.
  const serie = serieDaJanelaDeSeteDias(cache, CHAVE);
  assert.ok(serie, "a série ficou congelada no null — é o defeito de 13/09/2026 de volta");
  assert.equal(serie.length, 8);

  // 4. E o bloco desenha sete colunas com isso — a ponta que a tela consome.
  assert.equal(serieDoBlocoDeLucro({ janelaDeSeteDias: serie }).length, 7,
    "o bloco do ritmo ficaria sem colunas");
});

test("a decisão de buscar: a aterrissagem no filtro de 7 dias NÃO busca de novo", () => {
  // O early-return continua certo e não é ele o defeito — buscar de novo criaria
  // uma segunda janela de sete dias que poderia discordar da primeira. O defeito
  // era o valor congelar JUNTO com ele.
  assert.equal(precisaBuscarAJanela({ temNoCache: true, connectionId: "ml-1" }), false,
    "com a chave no cache, buscar de novo é uma segunda verdade sobre a mesma janela");
  assert.equal(precisaBuscarAJanela({ temNoCache: false, connectionId: null }), false,
    "sem conexão a página inteira está em branco — não há o que buscar");
  assert.equal(precisaBuscarAJanela({ temNoCache: false, connectionId: "ml-1" }), true,
    "chave ausente e conexão conhecida: é o caso em que o hook busca");
});

test("o caso que FUNCIONAVA continua funcionando — abrir em Hoje, 15 ou 30 dias", () => {
  // Aqui a chave da página é outra, o hook busca, e a busca dele preenche a
  // chave da janela. A leitura no render tem de enxergar as duas.
  const cache = new Map();
  cache.set("dashboard:days=30", { overview: { dailySales: OITO_DIAS.slice(0, 4) } });
  assert.equal(serieDaJanelaDeSeteDias(cache, CHAVE), null, "a janela ainda não chegou");
  cache.set(CHAVE, { overview: { dailySales: OITO_DIAS } });
  assert.equal(serieDaJanelaDeSeteDias(cache, CHAVE).length, 8,
    "a busca do próprio hook preencheu a chave e a tela continuou cega");
});

test("o dia sem apuração continua chegando como ausência, não como zero", () => {
  // A regra da casa atravessa o conserto: `null` não é `0`. O último dia da
  // amostra é o dia corrente, com lucro ainda desconhecido.
  const cache = new Map([[CHAVE, { overview: { dailySales: OITO_DIAS } }]]);
  const sete = serieDoBlocoDeLucro({ janelaDeSeteDias: serieDaJanelaDeSeteDias(cache, CHAVE) });
  assert.equal(sete[sete.length - 1].profit, null,
    "o dia corrente virou zero — no gráfico isso vira notícia ruim, não ausência");
});

test("SEGUNDA LINHA: o hook não volta a memorizar a leitura", async () => {
  // ⚠️ ASSERÇÃO SOBRE O FONTE, E ELA SABE QUE É FRACA. O defeito
  // mora na composição React (um `useMemo` cujas dependências não mudam quando o
  // `Map` é escrito), e sem jsdom não há como montar o componente aqui. Então
  // esta guarda cobra as duas pontas que o teste de comportamento não alcança:
  // que o hook CHAME a leitura pura, e que não a embrulhe num memo.
  //
  // O fonte vem SEM COMENTÁRIOS: a nota que explica o conserto cita
  // `useMemo` — casar o texto cru aprovaria a própria documentação da remoção.
  const fonte = await readFile(new URL("../src/app/components/MercadoLivreWorkspace.tsx", import.meta.url), "utf8");
  const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  const hook = codigo.slice(codigo.indexOf("function useJanelaDeSeteDias"));
  const corpoDoHook = hook.slice(0, hook.indexOf("\n}"));
  assert.ok(
    corpoDoHook.includes("return serieDaJanelaDeSeteDias<DailyPoint>(periodCache, chave);"),
    "o hook parou de ler o cache pela função pura — a decisão voltou para dentro do .tsx",
  );
  assert.ok(!/useMemo/.test(corpoDoHook),
    "a leitura da janela voltou a ser memorizada: é exatamente o defeito de 13/09/2026");
});

test("a janela de sete dias e buscada e guardada SEMPRE na view do dashboard", async () => {
  // ⚠️ QUAL DEFEITO ESTE TESTE REPROVA — o custo medido em
  // 13/09/2026: o hook rodava no nivel do workspace e seguia a view ATUAL,
  // entao abrir /mercado-livre/monitor disparava um segundo `days=7` com
  // `view=monitor` (595 KB na conta real) para desenhar um ritmo que so existe
  // no dashboard. Com a view fixa, o mesmo pedido custa ~28 KB desde o corte do
  // servidor — e some quando a pessoa ja passou pelo dashboard, porque a chave
  // passa a ser a MESMA.
  assert.equal(VIEW_DA_JANELA, "dashboard");
  assert.equal(CHAVE_DA_JANELA, `${VIEW_DA_JANELA}:${JANELA_DE_SETE_DIAS}`,
    "a chave da janela deixou de nascer da view da janela");

  // ⚠️ E ESTA E A PARTE PERIGOSA, por isso ela e asercao e nao
  // comentario: quem busca grava em `${view}:${query}`. Buscar como dashboard e
  // gravar sob `monitor:days=7` escreveria a PREVIA DE 5 LINHAS na chave que o
  // monitor le para montar a tabela cheia — a tabela apareceria com 5 linhas e
  // nada ficaria vermelho. A chave da janela nao pode ser a de nenhuma outra
  // view.
  for (const outraView of ["monitor", "estoque"]) {
    assert.notEqual(CHAVE_DA_JANELA, `${outraView}:${JANELA_DE_SETE_DIAS}`,
      `a janela passou a escrever na chave de ${outraView} — o payload enxuto vazaria para a tabela cheia`);
  }
});

test("SEGUNDA LINHA: o hook nao volta a seguir a view da tela", async () => {
  // Asercao sobre o fonte pelo mesmo motivo do teste acima dela: a composicao
  // mora no .tsx e nao ha jsdom aqui. Sem comentarios — as notas do conserto
  // citam `view` e `monitor` pelo nome.
  const fonte = await readFile(new URL("../src/app/components/MercadoLivreWorkspace.tsx", import.meta.url), "utf8");
  const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const hook = codigo.slice(codigo.indexOf("function useJanelaDeSeteDias"));
  const corpoDoHook = hook.slice(0, hook.indexOf(String.fromCharCode(10) + "}"));
  assert.ok(corpoDoHook.includes("const chave = CHAVE_DA_JANELA;"),
    "a chave da janela voltou a ser montada com a view da tela");
  assert.ok(corpoDoHook.includes("buscarEGuardarPeriodo(VIEW_DA_JANELA, JANELA_DE_SETE_DIAS"),
    "a busca da janela voltou a usar a view da tela");
  assert.ok(!/view/.test(corpoDoHook),
    "a view da tela voltou para dentro do hook — ela e justamente o que fazia o monitor pagar 595 KB");
});
