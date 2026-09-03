import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { FILTRO_DE_HOJE, JANELA_DE_SETE_DIAS, serieDoBlocoDeLucro } from "../src/app/components/serieDoLucroPorDia.ts";

const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
const semComentarios = (codigo) =>
  codigo.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const ML = "src/app/components/MercadoLivreWorkspace.tsx";
const dias = (n) => Array.from({ length: n }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}` }));

/**
 * ⚠️ O DEFEITO QUE ESTE ARQUIVO REPROVA (v262, dois prints da dona,
 * 03/09/2026): com o filtro "Hoje", o bloco "LUCRO POR DIA — ÚLTIMOS 7" recebia
 * a série do período selecionado — UM ponto — e virava uma coluna gigante verde
 * ocupando a régua inteira. O título prometia sete e a tela mostrava uma.
 *
 * Verbatim: *"no filtro de hoje (mercadolivre), o layout mostre o lucro por dia
 * nos últimos 7 dias, e não só hoje. Tem que ser o mesmo layout que mostra os
 * últimos 7 dias do filtro 7 dias."*
 *
 * A escolha da fonte foi extraída para `.ts` justamente para estes testes
 * poderem CHAMAR a função e conferir a saída, em vez de casar texto no `.tsx`.
 */

test("com o filtro Hoje, o bloco exibe os SETE dias da janela — nao o unico do periodo", () => {
  const resultado = serieDoBlocoDeLucro({
    filtro: FILTRO_DE_HOJE,
    serieDoPeriodo: dias(1),          // o que o filtro "Hoje" traz: um ponto
    janelaDeSeteDias: dias(7),
  });
  assert.equal(resultado.length, 7, "o bloco voltou a seguir a série do período no filtro Hoje");
  assert.deepEqual(resultado, dias(7), "as colunas não são as da janela de sete dias");
});

test("enquanto a janela nao chegou, o bloco fica VAZIO — nunca com a coluna unica", () => {
  // ⚠️ Este é o estado intermediário, e ele é visível: melhor o bloco não
  // existir por um instante do que aparecer com uma coluna sob um título que
  // promete sete. Devolver `serieDoPeriodo` aqui reintroduziria o defeito
  // exatamente como a dona o fotografou.
  const resultado = serieDoBlocoDeLucro({
    filtro: FILTRO_DE_HOJE,
    serieDoPeriodo: dias(1),
    janelaDeSeteDias: null,
  });
  assert.deepEqual(resultado, [], "a coluna gigante do período voltou a aparecer enquanto a janela carrega");
});

test("nos OUTROS filtros a serie continua sendo a do periodo", () => {
  // ⚠️ A dona pediu só o Hoje. A janela de sete dias fica em memória depois
  // que ela passa pelo filtro de 7 dias — se vazasse, o filtro de 30 mostraria
  // sete colunas de outra janela, e ninguém teria pedido isso.
  for (const filtro of ["days=7", "days=15", "days=30", "from=2026-08-01&to=2026-08-20"]) {
    const resultado = serieDoBlocoDeLucro({
      filtro,
      serieDoPeriodo: dias(30),
      janelaDeSeteDias: dias(7),      // carregada, e mesmo assim ignorada
    });
    assert.equal(resultado.length, 7, `${filtro}: o corte deixou de ser de sete`);
    assert.equal(resultado[6].date, "2026-09-30", `${filtro}: a série deixou de ser a do período`);
  }
});

test("a janela e a MESMA chave do filtro de 7 dias — nao uma busca paralela", () => {
  // ⚠️ Se a janela fosse buscada com outra query, ela cairia em outra chave
  // de cache e poderia DISCORDAR do que o filtro "7 dias" mostra: duas janelas
  // de sete dias no mesmo dia, uma em cada aba. É o "dois consumidores, dois
  // universos" aplicado ao tempo.
  assert.equal(JANELA_DE_SETE_DIAS, "days=7", "a janela deixou de ser a query do filtro de 7 dias");
  assert.equal(FILTRO_DE_HOJE, "days=today", "o filtro Hoje deixou de ser a query da URL");
});

test("o componente consome a funcao — e nao voltou a ler a serie do periodo direto", async () => {
  const codigo = semComentarios(await fonte(ML));
  assert.match(
    codigo,
    /const serieDoBloco = serieDoBlocoDeLucro\(\{\s*filtro: periodoQuery,\s*serieDoPeriodo: overview\.dailySales,\s*janelaDeSeteDias: serieDeSeteDias,\s*\}\);/,
    "o bloco parou de passar pela escolha testada — e a regra do filtro Hoje volta a ser texto solto no componente",
  );
  // E o destaque verde acompanha a série EXIBIDA, não a do período: com o filtro
  // Hoje as duas têm últimos dias diferentes, e o verde cairia na coluna errada.
  assert.match(
    codigo,
    /destaque: ponto\.date === serieDoBloco\[serieDoBloco\.length - 1\]\?\.date,/,
    "o destaque voltou a sair da série do período e pode pintar a coluna errada",
  );
  // A busca da janela usa o MESMO escritor do cache que o aquecimento.
  assert.match(
    codigo,
    /void buscarEGuardarPeriodo\(view, JANELA_DE_SETE_DIAS, controller\.signal\)/,
    "a janela passou a ser buscada por fora do escritor único do cache",
  );
});
