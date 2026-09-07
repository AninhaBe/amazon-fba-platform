import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { filtroDeAssinaturaAtiva } from "../src/lib/integrations/assinaturaPausaSync.ts";

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
    const eleitoras = consultas.filter(
      (q) => q.includes("FROM workspace_marketplace_syncs") || q.includes("FROM workspace_tiktok_shops")
    );
    saida.push({ nome, eleitoras });
  }
  return saida;
}

test("todo scheduler que elege conexao filtra assinatura cortada", async () => {
  const encontrados = await schedulers();
  assert.ok(encontrados.length >= 6, `esperava ao menos 6 schedulers, achei ${encontrados.length}`);

  let consultasEleitoras = 0;
  for (const { nome, eleitoras } of encontrados) {
    for (const consulta of eleitoras) {
      consultasEleitoras += 1;
      // Ancorado DENTRO da consulta, nao no arquivo: importar a funcao e nao
      // chama-la deixaria o arquivo casando e a conexao cortada sincronizando.
      assert.ok(
        consulta.includes("${filtroDeAssinaturaAtiva("),
        `${nome} elege conexao sem o filtro de assinatura cortada`
      );
    }
  }
  assert.equal(consultasEleitoras, 6, "mudou o numero de consultas eleitoras — confira se a nova esta filtrada");
});

test("o fragmento nao traz conector — quem chama escreve o AND", () => {
  // O defeito real: a primeira versao comecava com "AND" e produzia
  // `WHERE AND NOT EXISTS (...)` no eleitor do TikTok, cujo WHERE abre com
  // este filtro. SQL invalido que o TypeScript nao ve, porque para ele e string.
  const fragmento = filtroDeAssinaturaAtiva("sync");
  assert.ok(!fragmento.trimStart().startsWith("AND"), "fragmento nao pode comecar com AND");
  assert.ok(fragmento.trimStart().startsWith("NOT EXISTS"), "fragmento deve comecar com NOT EXISTS");
});

test("o filtro olha a assinatura, nunca o status do sync", () => {
  // Reusar sync.status daria dois significados a uma coluna so — a familia que
  // custou 11 horas de varredura parada em 03/09/2026 (updated_at do webhook).
  const fragmento = filtroDeAssinaturaAtiva("sync");
  assert.match(fragmento, /workspace_settings/);
  assert.match(fragmento, /'assinatura'/);
  assert.match(fragmento, /'cortada'/);
  assert.ok(!fragmento.includes("sync.status"), "o filtro nao pode depender do status do sync");
});

test("alias invalido explode em vez de virar SQL", () => {
  // O alias entra por interpolacao de string: sem esta trava, um dia alguem
  // passa algo vindo de fora e ganha injecao.
  assert.throws(() => filtroDeAssinaturaAtiva("sync; DROP TABLE workspace_settings; --"));
  assert.throws(() => filtroDeAssinaturaAtiva(""));
  assert.doesNotThrow(() => filtroDeAssinaturaAtiva("shop"));
});
