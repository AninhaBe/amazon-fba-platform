// Uso: node --env-file=.env.local scripts/pooler-mode-probe.mjs
//
// SOMENTE LEITURA. Prova, em vez de supor, se o codigo do NEXO roda no pooler do
// Supabase em modo TRANSACTION (porta 6543) alem do modo SESSION (5432) que
// usamos hoje.
//
// ⚠️ Por que isso importa (28/08/2026): o modo session prende uma conexao de
// servidor por conexao de cliente, e o pool_size do projeto e 15. O app sozinho
// pede ate 10 (`db.ts` max). Qualquer script local somando mais 10 estoura —
// aconteceu comigo, com EMAXCONNSESSION.
//
// O que o modo transaction quebraria, se usassemos: prepared statements
// nomeados, LISTEN/NOTIFY, tabelas temporarias, cursores entre transacoes,
// `SET` de sessao e `pg_advisory_lock` (o de SESSAO). Este script exercita o
// que o NEXO realmente faz.
import { createRequire } from "node:module";

const require = createRequire("G:/amazon-fba-platform/package.json");
const { Pool } = require("pg");

const base = process.env.DATABASE_URL;
if (!base) throw new Error("DATABASE_URL ausente.");

function comPorta(url, porta) {
  const u = new URL(url);
  u.port = String(porta);
  return u.toString();
}

const MODOS = [
  { nome: "session (5432, o de hoje)", url: comPorta(base, 5432) },
  { nome: "transaction (6543)", url: comPorta(base, 6543) },
];

function ms(inicio) {
  return Number(process.hrtime.bigint() - inicio) / 1e6;
}

for (const modo of MODOS) {
  console.log(`\n=== ${modo.nome} ===`);
  const pool = new Pool({
    connectionString: modo.url,
    ssl: { rejectUnauthorized: false },
    max: 10,
    connectionTimeoutMillis: 10_000,
  });

  const checar = async (rotulo, fn) => {
    const inicio = process.hrtime.bigint();
    try {
      const extra = await fn();
      console.log(`  ok   ${rotulo.padEnd(46)} ${ms(inicio).toFixed(0).padStart(5)}ms${extra ? `  ${extra}` : ""}`);
      return true;
    } catch (err) {
      console.log(`  FALHA ${rotulo.padEnd(45)} ${err.message}`);
      return false;
    }
  };

  await checar("conecta e responde", async () => {
    const r = await pool.query("SELECT 1 AS um");
    return `um=${r.rows[0].um}`;
  });

  // O NEXO usa parametros ($1) em praticamente toda consulta. No protocolo
  // estendido isso vira portal sem nome — o que o modo transaction aceita.
  await checar("consulta parametrizada (protocolo estendido)", async () => {
    const r = await pool.query("SELECT count(*)::int n FROM workspace_integrations WHERE provider = $1", ["shopee"]);
    return `n=${r.rows[0].n}`;
  });

  // Transacao explicita com advisory lock DE TRANSACAO — o unico tipo de lock
  // que o NEXO usa (db.ts:433 e tiktokOwnership.ts:23). O de sessao seria o
  // problema; o de transacao vive dentro do BEGIN/COMMIT.
  await checar("BEGIN + pg_advisory_xact_lock + COMMIT", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", ["sonda-pooler"]);
      await client.query("SELECT 1");
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    return "lock de transacao liberado no commit";
  });

  // Consulta pesada de verdade, para comparar custo entre os modos.
  await checar("consulta agregada real (pedidos por canal)", async () => {
    const r = await pool.query(
      `SELECT provider, count(*)::int n FROM workspace_channel_orders
        WHERE workspace_id = $1 GROUP BY 1 ORDER BY n DESC`,
      ["22ae3d9d-6f28-4ec2-96dd-a106b2b3e40d"]
    );
    return r.rows.map((x) => `${x.provider}=${x.n}`).join(" ");
  });

  // O teste que importa: 10 conexoes SIMULTANEAS, que e o `max` do db.ts.
  await checar("10 conexoes simultaneas (o max do db.ts)", async () => {
    const inicio = process.hrtime.bigint();
    await Promise.all(Array.from({ length: 10 }, () => pool.query("SELECT pg_sleep(0.2)")));
    return `todas responderam em ${ms(inicio).toFixed(0)}ms`;
  });

  await pool.end();
}

console.log("\nNada foi alterado: so leitura e um lock de transacao que morre no commit.");
process.exit(0);
