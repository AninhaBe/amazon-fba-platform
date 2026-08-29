// Uso: node --env-file=.env.local scripts/backfill-variacao-shopee.mjs
//      (com COMMIT=1 apenas DEPOIS de o cerebro aprovar as contagens)
//
// ADR-029, passo 5. A transacao roda, imprime as contagens e faz ROLLBACK por
// padrao. So commita com COMMIT=1 — a liturgia do A5/R2: contagens ANTES do
// commit, nunca depois.
//
// ⚠️ Uma conexao unica (nao pool): e uma transacao so, e ela precisa viver na
// mesma sessao do comeco ao fim.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire("G:/amazon-fba-platform/package.json");
const { Client } = require("pg");

const SQL = readFileSync(process.env.SQL_PATH ?? "G:/sc-temp/backfill-0029.sql", "utf8")
  // O arquivo traz BEGIN/COMMIT para leitura humana; aqui o controle e do script.
  .replace(/^\s*BEGIN;\s*$/m, "")
  .replace(/^\s*--\s*COMMIT;\s*$/m, "");

const agora = () => new Date().toISOString().slice(11, 19);
const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// As contagens do bloco DO saem como NOTICE — e sao elas que vao para o portao.
const avisos = [];
client.on("notice", (n) => { if (n.message) avisos.push(n.message); });

await client.connect();
console.log(`${agora()} conectado`);
try {
  await client.query("BEGIN");
  console.log(`${agora()} BEGIN`);
  await client.query(SQL);
  console.log(`\n=== CONTAGENS (do RAISE NOTICE, dentro da transacao) ===`);
  for (const a of avisos) console.log("  " + a);
  if (process.env.COMMIT === "1") {
    await client.query("COMMIT");
    console.log(`\n${agora()} COMMIT — autorizado por COMMIT=1`);
  } else {
    await client.query("ROLLBACK");
    console.log(`\n${agora()} ROLLBACK (padrao). Nada foi gravado.`);
    console.log("Para gravar, rode de novo com COMMIT=1 DEPOIS da aprovacao das contagens.");
  }
} catch (erro) {
  await client.query("ROLLBACK").catch(() => {});
  console.log(`\n${agora()} ABORTADO E DESFEITO: ${erro instanceof Error ? erro.message : erro}`);
  if (avisos.length) { console.log("avisos ate a falha:"); for (const a of avisos) console.log("  " + a); }
  await client.end();
  process.exit(2);
}
await client.end();
process.exit(0);
