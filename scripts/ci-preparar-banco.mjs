// Constrói o schema num Postgres DESCARTÁVEL, para o portão automático do CI.
//
// Uso (só no CI, ou contra um Postgres local seu):
//   TEST_DATABASE_URL=postgres://...@localhost:5432/nexo_test node scripts/ci-preparar-banco.mjs
//
// ⚠️ POR QUE ISTO EXISTE EM VEZ DE `npm run migrate:local`.
//
// O runner de migration (`migrate-cli.mjs`) exige **plano assinado** com chave
// privada Ed25519 — é o portão que protege staging e produção, e a chave mora
// FORA do repositório de propósito. Pôr essa chave num secret do CI enfraqueceria
// exatamente a proteção que ela existe para dar, e por um banco que vive três
// minutos e é jogado fora.
//
// Então o CI constrói o schema por um caminho próprio: aplica os arquivos de
// `migrations/` em ordem, direto. O fluxo assinado continua intocado para alvo
// real — este script **não é** um atalho para ele, e recusa qualquer alvo que
// não seja descartável.
//
// ⚠️ ELE NUNCA APONTA PARA PRODUÇÃO, E A RECUSA É A PRIMEIRA COISA QUE ELE FAZ.
// Escrever no banco da vendedora para provar que um teste funciona seria a
// ironia mais cara possível. Duas travas independentes abaixo.
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { LOCAL_HOSTS } from "./migration-safety.mjs";

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.error("BLOCKED: TEST_DATABASE_URL ausente. Este script não usa DATABASE_URL de propósito —");
  console.error("         a variável de produção não pode virar alvo por descuido de ambiente.");
  process.exit(1);
}

// TRAVA 1: o host tem de ser local. O Postgres do CI roda como serviço no mesmo
// runner, então ele É localhost; qualquer host remoto aqui é engano ou acidente.
const alvo = new URL(url);
if (!LOCAL_HOSTS.has(alvo.hostname)) {
  console.error(`BLOCKED: host "${alvo.hostname}" não é descartável.`);
  console.error("         Este script só aceita localhost/127.0.0.1/::1 — banco de CI, nunca banco de gente.");
  process.exit(1);
}

// TRAVA 2: se o alvo for, por acaso, o MESMO de `DATABASE_URL`, para. Cobre o
// caso em que alguém aponta as duas variáveis para o mesmo lugar por engano —
// um túnel local para produção passaria pela trava 1 e morre aqui.
if (process.env.DATABASE_URL && process.env.DATABASE_URL === url) {
  console.error("BLOCKED: TEST_DATABASE_URL é idêntica a DATABASE_URL.");
  console.error("         Banco de teste e banco de aplicação não podem ser o mesmo.");
  process.exit(1);
}

// ⚠️ O SCHEMA BASE VEM ANTES DAS MIGRATIONS, E ISSO NÃO É DETALHE.
//
// As tabelas mais antigas (`workspace_marketplace_syncs`, `workspace_integrations`,
// `accounts`…) NÃO são criadas por migration nenhuma: nasceram do bootstrap em
// `src/lib/db.ts`, antes das migrations existirem. A 0002 é um
// `ALTER TABLE workspace_marketplace_syncs` — em banco novo ela falha, porque a
// tabela não existe ainda.
//
// Descoberto montando este portão, em 30/08/2026: **o repositório não conseguia
// reconstruir o próprio schema do zero.** Aqui o bootstrap roda primeiro e as
// migrations empilham por cima, na ordem — que é exatamente a história que
// produção viveu.
process.env.DATABASE_URL = url;
const { criarSchemaBaseParaTesteLocal } = await import("../src/lib/db.ts");
await criarSchemaBaseParaTesteLocal();
console.log("schema base criado (bootstrap pré-migrations).");

const dir = path.resolve("migrations");
const arquivos = (await readdir(dir)).filter((nome) => nome.endsWith(".sql")).sort();
if (!arquivos.length) {
  console.error("BLOCKED: nenhuma migration encontrada em migrations/.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, ssl: false, max: 1 });
try {
  // A tabela de controle é a mesma do runner real: assim o schema do CI fica
  // indistinguível do de um ambiente migrado, e um teste que consulte
  // `schema_migrations` não descobre que está no CI.
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name text PRIMARY KEY,
    migration_hash text,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const jaAplicadas = new Set(
    (await pool.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name),
  );

  let aplicadas = 0;
  for (const nome of arquivos) {
    if (jaAplicadas.has(nome)) continue;
    const sql = await readFile(path.join(dir, nome), "utf8");
    // Uma transação por migration, igual ao runner real: falha no meio não deixa
    // schema pela metade, e o erro aponta o arquivo.
    await pool.query("BEGIN");
    try {
      await pool.query(sql);
      // ⚠️ O HASH VAI JUNTO, no mesmo formato do runner real (`sha256:<hex>`).
      // A 0007 torna `migration_hash` NOT NULL: gravar sem ele quebra o próprio
      // lote algumas migrations adiante — e o banco do CI ficaria com um ledger
      // diferente do de produção, que é o oposto do que este script quer.
      await pool.query(
        "INSERT INTO schema_migrations(name, migration_hash) VALUES($1, $2)",
        [nome, `sha256:${createHash("sha256").update(sql).digest("hex")}`],
      );
      await pool.query("COMMIT");
      aplicadas += 1;
    } catch (erro) {
      await pool.query("ROLLBACK");
      console.error(`FALHOU em ${nome}: ${erro instanceof Error ? erro.message : erro}`);
      process.exit(1);
    }
  }
  console.log(`schema pronto: ${aplicadas} migration(s) aplicada(s) de ${arquivos.length} arquivo(s).`);
} finally {
  await pool.end();
}
