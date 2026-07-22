// Aplica as migrações versionadas de migrations/*.sql, em ordem, uma única vez
// cada (controle em schema_migrations). Rodar no deploy ou manualmente — o DDL
// destas tabelas NÃO passa pelo ensureSchema do app.
//
// Uso:  npm run migrate

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("Defina DATABASE_URL no .env.local para rodar as migrações.");
  process.exit(1);
}

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const files = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();

const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
});

const client = await pool.connect();
try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  const { rows } = await client.query("SELECT name FROM schema_migrations");
  const applied = new Set(rows.map((row) => row.name));

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`= ${file} (já aplicada)`);
      continue;
    }
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      console.error(`✗ ${file} falhou: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    }
    console.log(`✓ ${file}`);
    ran += 1;
  }
  console.log(ran ? `\n${ran} migração(ões) aplicada(s).` : "\nNada novo a aplicar.");
} finally {
  client.release();
  await pool.end();
}
