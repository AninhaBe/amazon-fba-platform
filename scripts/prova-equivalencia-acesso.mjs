// Roda a equivalencia contra o banco apontado por DATABASE_URL. SO LE: os casos
// vivem num CTE que sombreia workspace_settings dentro da propria consulta, e
// nada e gravado nem revertido, porque nada e escrito.
//
//   node --experimental-strip-types --import ./scripts/ts-resolver.mjs \
//        --env-file=.env.local scripts/prova-equivalencia-acesso.mjs
import pg from "pg";
import { conferirEquivalencia, casosDaFronteira } from "./equivalenciaDoAcesso.mjs";

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const divergencias = await conferirEquivalencia((sql) => c.query(sql));
await c.end();

console.log(`casos conferidos: ${casosDaFronteira().length}`);
if (!divergencias.length) {
  console.log("divergencias: 0 — o SQL do scheduler decide igual a tranca.");
  process.exit(0);
}
for (const d of divergencias) console.log(`  DIVERGE em "${d.caso}": sql=${d.noSql} ts=${d.noTs} esperado=${d.esperado}`);
process.exit(1);
