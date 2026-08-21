// Bootstrap do ledger de migrations — ver ADR-021 e migrations/0007.
//
// Cria `schema_migrations.migration_hash` e estabelece a linha de base das
// migrations já aplicadas. Roda FORA do runner por necessidade, não por
// conveniência: `inspectTarget` recusa um ledger sem essa coluna, então o runner
// não consegue nem montar um plano enquanto ela não existir. É exatamente o
// "procedimento de bootstrap separado" que o próprio código cita ao recusar.
//
// ⚠️ O QUE O BACKFILL AFIRMA, E O QUE NÃO AFIRMA.
// Ele grava o hash do arquivo COMO ELE ESTÁ HOJE. Isso é uma LINHA DE BASE, não
// prova de que foi esse conteúdo que rodou lá atrás — 0001..0004 foram aplicadas
// por um processo que o próprio repo declara não validado, e 0005/0006 fora do
// runner. O valor da deteccao de drift é daqui para frente: a partir deste ponto,
// editar uma migration já aplicada passa a acusar. Ler isso como certificação
// retroativa seria repetir o erro que a tabela morta de custos causou — dado
// plausível que ninguém conferiu.
//
// Uso: node --env-file-if-exists=.env.local scripts/bootstrap-ledger-hash.mjs [--apply]
// Sem --apply, só mostra o que faria.

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const aplicar = process.argv.includes("--apply");
if (!process.env.DATABASE_URL) throw new Error("BLOCKED: DATABASE_URL ausente.");

const dir = path.resolve("migrations");
const hashes = new Map();
for (const nome of (await readdir(dir)).filter((n) => n.endsWith(".sql"))) {
  const sql = await readFile(path.join(dir, nome), "utf8");
  hashes.set(nome, `sha256:${createHash("sha256").update(sql).digest("hex")}`);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 1 });
const c = await pool.connect();
try {
  await c.query("BEGIN");
  await c.query("ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS migration_hash text");

  const { rows } = await c.query("SELECT name, migration_hash FROM schema_migrations ORDER BY name");

  // Uma linha aplicada sem arquivo correspondente não tem linha de base possível.
  // Parar aqui é melhor que deixar NULL e ver a 0007 falhar depois sem explicar.
  const orfas = rows.filter((r) => !r.migration_hash && !hashes.has(r.name)).map((r) => r.name);
  if (orfas.length) throw new Error(`BLOCKED: aplicadas sem arquivo em migrations/: ${orfas.join(", ")}`);

  for (const r of rows) {
    const alvo = hashes.get(r.name);
    if (r.migration_hash) {
      // Já tem base; divergência aqui é drift real e não é este script que resolve.
      if (r.migration_hash !== alvo) console.log(`  ! ${r.name}: ledger ${r.migration_hash.slice(0, 20)}… ≠ arquivo ${alvo.slice(0, 20)}… (drift — NÃO tocado)`);
      else console.log(`  = ${r.name}: já tinha base`);
      continue;
    }
    console.log(`  + ${r.name}: base ${alvo}`);
    if (aplicar) await c.query("UPDATE schema_migrations SET migration_hash=$1 WHERE name=$2 AND migration_hash IS NULL", [alvo, r.name]);
  }

  if (aplicar) {
    await c.query("COMMIT");
    console.log("\nCOMMIT — linha de base estabelecida.");
  } else {
    await c.query("ROLLBACK");
    console.log("\nsimulação (ROLLBACK). Rode com --apply para gravar.");
  }
} catch (e) {
  await c.query("ROLLBACK");
  console.error("ROLLBACK ·", e.message);
  process.exitCode = 1;
} finally {
  c.release();
  await pool.end();
}
