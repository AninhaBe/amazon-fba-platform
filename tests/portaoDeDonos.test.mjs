import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { avaliarCommit, donoDe, lerMapa, mensagemDeBloqueio } from "../scripts/portao-de-donos.mjs";

// ⚠️ HOOK SEM TESTE E A PROXIMA COISA QUE QUEBRA EM SILENCIO. O dia 29/08/2026
// provou tres vezes que instrumento sem verificacao engana: o health que nao
// tocava o banco, o contador que so guardava o ultimo status, e o teste que
// olhava so os leitores enquanto o escritor continuava fabricando zero.

const regras = lerMapa(await readFile(new URL("../docs/donos-da-arvore.md", import.meta.url), "utf8"));

test("o mapa e lido do documento versionado, nao de dentro do script", () => {
  // A outra dona precisa poder abrir, ler e discordar sem mexer em codigo.
  assert.ok(regras.length >= 10, "o mapa nao foi lido do markdown");
  assert.equal(donoDe(regras, "src/lib/db.ts"), "backend");
  assert.equal(donoDe(regras, "src/app/components/Nav.tsx"), "vitrine");
  assert.equal(donoDe(regras, "docs/adr/ADR-033-estoque-desconhecido-nao-e-zero.md"), "compartilhado");
  // Prefixo MAIS LONGO ganha: src/app/api tem que vencer qualquer regra mais curta.
  assert.equal(donoDe(regras, "src/app/api/health/route.ts"), "backend");
  // Caminho sem regra e compartilhado, nao erro.
  assert.equal(donoDe(regras, "README.md"), "compartilhado");
  // Separador do Windows nao pode mudar o dono.
  assert.equal(donoDe(regras, String.raw`src\lib\db.ts`), "backend");
});

test("commit que CRUZA dois donos e barrado", () => {
  const r = avaliarCommit({
    arquivos: ["src/lib/db.ts", "src/app/components/Nav.tsx"],
    mensagem: "fix: qualquer coisa",
    regras,
  });
  assert.equal(r.ok, false);
  assert.deepEqual(r.donos, ["backend", "vitrine"]);
});

test("commit de UM dono so passa, mesmo com doc e teste junto", () => {
  // Documentacao e teste acompanham quem escreveu o codigo. Barrar por causa de
  // um .md seria o atrito que faz a cerca virar coisa que se contorna.
  const r = avaliarCommit({
    arquivos: ["src/lib/db.ts", "tests/db.test.mjs", "docs/adr/ADR-030.md", "migrations/0021.sql"],
    mensagem: "fix: so backend",
    regras,
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.donos, ["backend"]);
});

test("o escape nomeado deixa passar — e so ele", () => {
  const arquivos = ["src/lib/coberturaDeEstoque.ts", "src/app/components/FiltroDeAtividade.tsx"];
  const semEscape = avaliarCommit({ arquivos, mensagem: "feat: lote grande", regras });
  assert.equal(semEscape.ok, false, "sem escape tem que barrar");

  const comEscape = avaliarCommit({
    arquivos,
    mensagem: "feat: estoque desconhecido\n\ncruza-areas: mudanca de contrato exige leitor e tela no mesmo commit",
    regras,
  });
  assert.equal(comEscape.ok, true);
  assert.equal(comEscape.temEscape, true);

  // Escape VAZIO nao vale: a frase e o que torna auditavel.
  const vazio = avaliarCommit({ arquivos, mensagem: "feat: x\n\ncruza-areas:", regras });
  assert.equal(vazio.ok, false, "cruza-areas sem motivo nao pode passar");
});

test("a mensagem de bloqueio diz O QUE FAZER, nao so que barrou", () => {
  const r = avaliarCommit({
    arquivos: ["src/lib/db.ts", "src/app/components/Nav.tsx"],
    mensagem: "fix: x",
    regras,
  });
  const texto = mensagemDeBloqueio(r);
  // Lista os invasores COM o dono de cada um.
  assert.match(texto, /backend:/);
  assert.match(texto, /src\/lib\/db\.ts/);
  assert.match(texto, /vitrine:/);
  assert.match(texto, /src\/app\/components\/Nav\.tsx/);
  // E as duas saidas, com comando pronto.
  assert.match(texto, /DIVIDA em dois commits/);
  assert.match(texto, /git add/);
  assert.match(texto, /cruza-areas: <motivo em uma frase>/);
  assert.match(texto, /docs\/donos-da-arvore\.md/);
});
