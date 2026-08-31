import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// QUEM SABE, GRAVA. QUEM EXIBE, LE.
//
// Duas perguntas que a tela precisa responder sobre uma linha de anuncio:
//   "esta linha e de UM dia?"       -> `janela_em_dias`
//   "este numero ainda vai mudar?"  -> `consolidando`
//
// As duas eram invisiveis no dado, e as duas custaram caro em 30-31/08/2026:
//
// 1) A leitura da aba somava linhas achando que somava dias. Cada linha era o
//    acumulado de OITO dias e nada no dado dizia isso — 17x de erro que so
//    apareceu quando alguem comparou com o console do canal.
//
// 2) O numero do dia recente muda sozinho (as duas visoes do PADS consolidam em
//    velocidades diferentes). Numero que muda sem aviso vira "esta errado",
//    mesmo estando certo — aconteceu duas vezes no mesmo dia, com o ads e com a
//    margem.
//
// ⚠️ POR QUE NA GRAVACAO E NAO NA TELA. Inferir "hoje ou ontem" na renderizacao
// e a tela adivinhando um fato que quem gravou sabia — mesma familia da janela
// que vinha por parametro. E pior: a tela le payload cacheado, entao o "agora"
// dela pode estar horas depois do "agora" da coleta, e a resposta muda com isso.

const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");

test("a gravacao carimba janela e consolidacao em extra_metrics", async () => {
  const src = await fonte("src/lib/integrations/mercadoLivreAdsSync.ts");
  assert.match(src, /janela_em_dias: procedencia\.janelaEmDias/);
  assert.match(src, /consolidando: procedencia\.consolidando/);
});

test("a procedencia e PARAMETRO obrigatorio de quem grava", async () => {
  // Se fosse opcional, a proxima chamada esqueceria — e a ausencia seria lida
  // como `undefined`, que na tela vira "nao esta consolidando". Silencio
  // otimista e o modo de falha que este projeto passa o dia removendo.
  const src = await fonte("src/lib/integrations/mercadoLivreAdsSync.ts");
  assert.match(
    src,
    /procedencia: \{ janelaEmDias: number; consolidando: boolean \}/,
    "sem `?`: quem grava tem que declarar a procedencia",
  );
});

test("`consolidando` sai de EVIDENCIA, nao de suposicao", async () => {
  // A prova e as duas visoes da propria fonte discordarem. Uma regra so de data
  // diria "consolidando" para todo dia recente, inclusive os que ja fecharam.
  const src = await fonte("src/lib/integrations/mercadoLivreAdsSync.ts");
  assert.match(src, /const consolidando = !sanidade\.confere &&/);
});

test("e a janela de recencia impede rotular DEFEITO como consolidacao", async () => {
  // Divergencia em dia ANTIGO significa outra coisa: e problema de verdade, e
  // continua indo para o console.error. Sem esta condicao, um defeito em dado
  // velho viraria "ainda consolidando" e sumiria da vista.
  const src = await fonte("src/lib/integrations/mercadoLivreAdsSync.ts");
  assert.match(src, /\(dia === hoje \|\| dia === ontem\)/);
  assert.match(src, /console\.error\(/, "divergencia em dia antigo continua sendo reportada");
});

test("a janela gravada e sempre 1 — a assinatura nao aceita outra coisa", async () => {
  // O conserto de categoria: enquanto o chamador PUDER informar um intervalo
  // diferente do dia, alguem vai informar. A janela deixou de ser parametro.
  const src = await fonte("src/lib/integrations/mercadoLivreAdsSync.ts");
  assert.match(src, /const janela = \{ de: dia, ate: dia \};/);
  assert.doesNotMatch(
    src,
    /coletarAdsDoMercadoLivre\(\s*\n?\s*connection: IntegrationConnection,\s*\n?\s*dia: string,\s*\n?\s*janela:/,
    "a janela nao pode voltar a ser parametro",
  );
  assert.match(src, /janelaEmDias: 1/);
});
