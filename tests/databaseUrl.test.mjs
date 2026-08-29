import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { urlDoPoolDaAplicacao, urlDeMigracaoDireta } from "../src/lib/databaseUrl.ts";

// ADR-028: o pooler do Supabase em modo `session` (5432) tem pool_size 15 como
// teto de CLIENTES, e ele já mordia — abrir o `max: 10` do db.ts falhava com
// EMAXCONNSESSION. A aplicação passa a usar o modo `transaction` (6543).

const SENHA_COM_CARACTERE_ESPECIAL = "p%40ss%3Aw%2Frd";
const POOLER = `postgres://postgres.abc123:${SENHA_COM_CARACTERE_ESPECIAL}@aws-1-sa-east-1.pooler.supabase.com:5432/postgres`;

test("no pooler, a aplicação sai da 5432 para a 6543", () => {
  assert.equal(
    urlDoPoolDaAplicacao(POOLER),
    `postgres://postgres.abc123:${SENHA_COM_CARACTERE_ESPECIAL}@aws-1-sa-east-1.pooler.supabase.com:6543/postgres`
  );
});

test("a senha não é re-codificada — reconstruir a URL quebraria a autenticação", async () => {
  // O bug que este teste impede: `new URL(x).toString()` mexe no encoding da
  // senha, e o Postgres recusa uma senha diferente da cadastrada.
  assert.match(urlDoPoolDaAplicacao(POOLER), new RegExp(SENHA_COM_CARACTERE_ESPECIAL));
  const fonte = await readFile(new URL("../src/lib/databaseUrl.ts", import.meta.url), "utf8");
  assert.doesNotMatch(fonte, /url\.toString\(\)/, "a troca é por substituição de texto, nunca reconstruindo a URL");
});

test("porta implícita também é modo session — e vira 6543", () => {
  assert.equal(
    urlDoPoolDaAplicacao("postgres://postgres.abc123:s@aws-1-sa-east-1.pooler.supabase.com/postgres"),
    "postgres://postgres.abc123:s@aws-1-sa-east-1.pooler.supabase.com:6543/postgres"
  );
});

test("o que não é pooler passa intacto — Postgres local, conexão direta, outro provedor", () => {
  const local = "postgres://postgres:postgres@localhost:5432/nexo";
  const direta = "postgres://postgres:s@db.abc123.supabase.co:5432/postgres";
  const outro = "postgres://u:s@meu-banco.exemplo.com:5432/nexo";
  for (const url of [local, direta, outro]) assert.equal(urlDoPoolDaAplicacao(url), url);
  assert.equal(urlDoPoolDaAplicacao(undefined), undefined);
  assert.equal(urlDoPoolDaAplicacao(""), "");
});

test("já na 6543, ou em porta incomum, não se adivinha nada", () => {
  const jaCerta = "postgres://postgres.abc123:s@aws-1-sa-east-1.pooler.supabase.com:6543/postgres";
  assert.equal(urlDoPoolDaAplicacao(jaCerta), jaCerta);
  const incomum = "postgres://postgres.abc123:s@aws-1-sa-east-1.pooler.supabase.com:7777/postgres";
  assert.equal(urlDoPoolDaAplicacao(incomum), incomum);
});

test("URL inválida não derruba a aplicação — devolve o que veio", () => {
  assert.equal(urlDoPoolDaAplicacao("isto não é uma url"), "isto não é uma url");
});

test("a conexão direta troca host E usuário — no pooler o usuário carrega o ref do projeto", () => {
  assert.equal(
    urlDeMigracaoDireta(POOLER),
    `postgres://postgres:${SENHA_COM_CARACTERE_ESPECIAL}@db.abc123.supabase.co:5432/postgres`
  );
  // Sem o sufixo do projeto não há como derivar o host direto: não inventa.
  const semRef = "postgres://postgres:s@aws-1-sa-east-1.pooler.supabase.com:5432/postgres";
  assert.equal(urlDeMigracaoDireta(semRef), semRef);
});

test("o pool honra DB_POOL_MAX só para BAIXO — script não pode pedir mais que a aplicação", async () => {
  const fonte = await readFile(new URL("../src/lib/db.ts", import.meta.url), "utf8");
  assert.match(fonte, /pedido < 1 \|\| pedido > padrao\) return padrao/,
    "valor acima do padrão é ignorado: erro de digitação num script não vira autorização");
  assert.match(fonte, /connectionString: urlDoPoolDaAplicacao\(process\.env\.DATABASE_URL\)/);
});

test("a regra de higiene está escrita no próprio script, não só no ADR", async () => {
  const sonda = await readFile(new URL("../scripts/overview-timing-probe.mjs", import.meta.url), "utf8");
  assert.match(sonda, /SCRIPT LOCAL CONTRA PRODUCAO NAO ABRE POOL/);
  assert.match(sonda, /process\.env\.DB_POOL_MAX = "3"/);
});
