import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import "../scripts/ts-resolver.mjs";

const { cronAutorizado } = await import("../src/lib/portaoDoCron.ts");

// O PORTAO DAS ROTAS DE CRON — auditoria de superficie de 07/09/2026.
//
// A mesma conferencia estava copiada em cinco arquivos, com as duas MESMAS
// fraquezas em todos: comparacao com !== e recusa em 401. Copiar cinco vezes e
// garantir que a sexta copia nasca diferente.

const semComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

test("segredo certo passa; errado, ausente e sem prefixo NAO passam", () => {
  assert.equal(cronAutorizado("Bearer abc123", "abc123"), true, "o segredo certo foi recusado");
  assert.equal(cronAutorizado("Bearer errado", "abc123"), false);
  assert.equal(cronAutorizado(null, "abc123"), false);
  assert.equal(cronAutorizado("abc123", "abc123"), false, "aceitou sem o prefixo Bearer");
});

test("SEM CRON_SECRET configurado, ninguem entra — falha fechada e SEM janela", () => {
  // O cron e disparado por infraestrutura nossa, que sempre pode carregar o
  // cabecalho: nao ha chamador legado a proteger, entao nao ha convivencia a
  // declarar. No webhook do ML havia, e por isso la a janela existe e tem data.
  for (const vazio of [undefined, ""]) {
    assert.equal(cronAutorizado(null, vazio), false);
    assert.equal(cronAutorizado("Bearer qualquer", vazio), false, "sem segredo, qualquer cabecalho entrou");
  }
});

test("prefixo correto NAO passa — a comparacao e do valor inteiro", () => {
  // Sem tempo constante, o tempo de resposta entrega o tamanho do prefixo certo.
  for (const chute of ["Bearer abc12", "Bearer abc1234", "Bearer ", "Bearer abc123 ", " Bearer abc123"]) {
    assert.equal(cronAutorizado(chute, "abc123"), false, `"${chute}" passou`);
  }
});

test("a decisao nao importa next/server — senao nao daria para testar comportamento", async () => {
  // ⚠️ A primeira versao juntava decisao e resposta HTTP num arquivo so, e o
  // teste MORRIA no import (`Cannot find module next/server`). A unica prova
  // possivel viraria olhar o texto do arquivo, que nao prova comportamento.
  const fonte = await readFile(new URL("../src/lib/portaoDoCron.ts", import.meta.url), "utf8");
  assert.ok(!semComentarios(fonte).includes("next/server"), "a decisao voltou a depender do Next");
});

test("a recusa e 404 SECO — 401 confirma que a rota existe", async () => {
  const codigo = semComentarios(await readFile(new URL("../src/lib/portaoDoCronHttp.ts", import.meta.url), "utf8"));
  assert.ok(codigo.includes('new NextResponse("Not Found", { status: 404 })'), "a recusa nao e 404 seco");
  assert.ok(!codigo.includes("401"), "voltou a devolver 401");
});

test("TODA rota de cron usa o portao — e nenhuma tem a copia antiga", async () => {
  // ⚠️ Lista que CRESCE SOZINHA: varre o diretorio em vez de enumerar. Cron novo
  // nasce coberto, que e o contrario do que aconteceu com a copia manual.
  const dirs = await readdir(new URL("../src/app/api/cron/", import.meta.url));
  assert.ok(dirs.length >= 5, `esperava ao menos 5 rotas de cron, achei ${dirs.length}`);
  for (const dir of dirs) {
    const codigo = semComentarios(
      await readFile(new URL(`../src/app/api/cron/${dir}/route.ts`, import.meta.url), "utf8")
    );
    assert.ok(codigo.includes("const recusa = portaoDoCron(req);"), `${dir} nao usa o portao`);
    assert.ok(codigo.includes("if (recusa) return recusa;"), `${dir} chama o portao e ignora a resposta`);
    assert.ok(!codigo.includes("status: 401"), `${dir} ainda devolve 401`);
    assert.ok(!codigo.includes("process.env.CRON_SECRET"), `${dir} voltou a ler o segredo por conta propria`);
  }
});
