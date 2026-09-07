import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { filtroDeAcessoLiberado } from "../src/lib/integrations/assinaturaPausaSync.ts";

// "Cortou, parou" — ordem da dona do produto em 07/09/2026.
//
// ⚠️ ESTA LISTA CRESCE SOZINHA, de proposito. Ela nao enumera os schedulers:
// varre o diretorio e cobra de TODO arquivo *Scheduler.ts que eleja conexao. A
// guarda de lista fechada ja falhou neste projeto em 04/09/2026 — enumerava os
// produtores de tarifa e nao viu a funcao que apagava, que ficou dois dias sem
// chamador. Scheduler novo nasce coberto por construcao.
//
// O QUE ELA NAO COBRE, escrito porque um dia vai importar: ela prova que o
// filtro esta DENTRO da consulta, nao que o Postgres o aplica. Isso foi medido
// a parte, em 07/09/2026, contra o banco de producao com um CTE sombreando
// workspace_settings (sem escrever nada): eleitos passaram de 3 para 2 ao
// cortar a conta 4f73ae94, e as outras duas ficaram intactas.

const DIR = new URL("../src/lib/integrations/", import.meta.url);

async function schedulers() {
  const nomes = (await readdir(DIR)).filter((n) => n.endsWith("Scheduler.ts"));
  const saida = [];
  for (const nome of nomes) {
    const fonte = await readFile(new URL(nome, DIR), "utf8");
    const consultas = [...fonte.matchAll(/`(\s*SELECT[\s\S]*?)`/g)].map((m) => m[1]);
    const temAwait = fonte.includes("await filtroDeAcessoLiberado(");
    const eleitoras = consultas.filter(
      (q) => q.includes("FROM workspace_marketplace_syncs") || q.includes("FROM workspace_tiktok_shops")
    );
    saida.push({ nome, eleitoras, temAwait });
  }
  return saida;
}

test("todo scheduler que elege conexao filtra assinatura cortada", async () => {
  const encontrados = await schedulers();
  assert.ok(encontrados.length >= 6, `esperava ao menos 6 schedulers, achei ${encontrados.length}`);

  let consultasEleitoras = 0;
  for (const { nome, eleitoras, temAwait } of encontrados) {
    if (eleitoras.length) assert.ok(temAwait, `${nome} nao resolve o filtro com await`);
    for (const consulta of eleitoras) {
      consultasEleitoras += 1;
      // Ancorado DENTRO da consulta, nao no arquivo: importar a funcao e nao
      // chama-la deixaria o arquivo casando e a conexao cortada sincronizando.
      // ⚠️ ANCORADO NA VARIAVEL JA RESOLVIDA, e isso tem motivo medido: o
      // filtro virou assincrono em 07/09/2026 (precisa resolver os ids de
      // admin), e `${filtroDeAcessoLiberado("sync")}` dentro do template
      // passaria a interpolar "[object Promise]". O TypeScript aceita calado —
      // para ele e so uma string. Entao a consulta tem de usar a variavel, e o
      // arquivo tem de conter o await.
      assert.ok(
        consulta.includes("${filtroDeAcesso}"),
        `${nome} elege conexao sem o filtro de acesso`
      );
      assert.ok(
        !consulta.includes("${filtroDeAcessoLiberado("),
        `${nome} interpola a funcao direto: viraria "[object Promise]" na consulta`
      );
    }
  }
  assert.equal(consultasEleitoras, 6, "mudou o numero de consultas eleitoras — confira se a nova esta filtrada");
});

test("o fragmento nao traz conector — quem chama escreve o AND", async () => {
  // O defeito real: a primeira versao comecava com "AND" e produzia
  // `WHERE AND NOT EXISTS (...)` no eleitor do TikTok, cujo WHERE abre com
  // este filtro. SQL invalido que o TypeScript nao ve, porque para ele e string.
  const fragmento = await filtroDeAcessoLiberado("sync", []);
  assert.ok(!fragmento.trimStart().startsWith("AND"), "fragmento nao pode comecar com AND");
});

test("o filtro nao usa RegExp nem cast — as duas armadilhas medidas em 07/09/2026", async () => {
  const fragmento = await filtroDeAcessoLiberado("sync", []);
  // 1) RegExp em template literal: a versao que comparava datas de trial
  //    escrevia "\d" e o filtro nascia casando "^d{4}-d{2}-d{2}T". Verde na
  //    leitura, errado na execucao. O modelo v3 tirou a data do filtro, mas a
  //    guarda fica: e o tipo de coisa que volta na proxima condicao com data.
  assert.ok(!fragmento.includes(" ~ "), "operador de RegExp no filtro: escape em template literal ja falhou aqui");
  // 2) Cast: uma unica linha com valor malformado derrubaria a consulta e
  //    pararia o canal para TODOS os inquilinos.
  assert.ok(!fragmento.includes("::timestamptz"), "cast no filtro: dado torto de um inquilino pararia o canal inteiro");
});

test("o filtro cobre a regra v3 — admin ou assinatura ATIVA, e nada mais", async () => {
  // ⚠️ O trial saiu da decisao em 07/09/2026 e as linhas ficaram DORMENTES no
  // banco. Se alguem religar a leitura "porque estava la", contas antigas
  // voltam a sincronizar sem pagar — por isso a proibicao e explicita.
  const fragmento = await filtroDeAcessoLiberado("sync", ["id-de-admin"]);
  const semComentarios = fragmento.replace(/--.*$/gm, "");
  assert.match(semComentarios, /'ativa'/);
  assert.match(semComentarios, /'id-de-admin'/, "os ids de admin nao entraram no filtro");
  assert.ok(!semComentarios.includes("'trial'"), "o filtro voltou a ler trial: conta antiga sincronizaria sem pagar");
  assert.ok(!semComentarios.includes("endsAt"), "o filtro voltou a olhar data de avaliacao");
});

test("o filtro olha a assinatura, nunca o status do sync", async () => {
  // Reusar sync.status daria dois significados a uma coluna so — a familia que
  // custou 11 horas de varredura parada em 03/09/2026 (updated_at do webhook).
  const fragmento = await filtroDeAcessoLiberado("sync", []);
  assert.match(fragmento, /workspace_settings/);
  assert.match(fragmento, /'assinatura'/);
  assert.ok(!fragmento.includes("sync.status"), "o filtro nao pode depender do status do sync");
});

test("alias invalido explode em vez de virar SQL", async () => {
  // O alias entra por interpolacao de string: sem esta trava, um dia alguem
  // passa algo vindo de fora e ganha injecao.
  //
  // ⚠️ `assert.throws` NAO serve aqui desde que a funcao virou assincrona: ela
  // devolve promessa rejeitada em vez de lancar na hora, e o teste passaria a
  // reprovar por "Missing expected exception" mesmo com a trava funcionando.
  await assert.rejects(() => filtroDeAcessoLiberado("sync; DROP TABLE workspace_settings; --", []));
  await assert.rejects(() => filtroDeAcessoLiberado("", []));
  await assert.doesNotReject(() => filtroDeAcessoLiberado("shop", []));
});

test("sem allowlist, NINGUEM e admin — falha fechada", async () => {
  // O contrario ("sem lista, todo mundo entra") e como uma chave-mestra abre
  // por acidente de deploy. Mesma escolha de adminAllowlist.ts.
  const fragmento = await filtroDeAcessoLiberado("sync", []);
  assert.ok(fragmento.includes("false"), "sem ids de admin o filtro tem de fechar, nao abrir");
});

test("id de admin com aspas nao vira injecao", async () => {
  const fragmento = await filtroDeAcessoLiberado("sync", ["a'b"]);
  assert.ok(fragmento.includes("'a''b'"), "aspas simples tem de ser dobrada");
});
