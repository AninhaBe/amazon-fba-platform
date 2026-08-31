// Cura das 128 linhas de estorno da Shopee gravadas com sinal negativo.
// Liturgia: mede, transacao, rowCount conferido, rollback se divergir, releitura.
import { Client } from "pg";
const EXECUTAR = process.argv.includes("--executar");
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const antes = (await c.query(
 `SELECT COUNT(*)::int n, SUM(amount)::numeric total FROM workspace_channel_order_fees
   WHERE provider='shopee' AND fee_type='refund' AND amount < 0`)).rows[0];
console.log(`ANTES: ${antes.n} linha(s) negativa(s), soma ${antes.total}`);
if (Number(antes.n) === 0) { console.log("nada a curar."); await c.end(); process.exit(0); }
if (!EXECUTAR) { console.log("medicao apenas. --executar para aplicar."); await c.end(); process.exit(0); }
try {
  await c.query("BEGIN");
  const r = await c.query(
   `UPDATE workspace_channel_order_fees SET amount = ABS(amount)
     WHERE provider='shopee' AND fee_type='refund' AND amount < 0`);
  if (r.rowCount !== Number(antes.n)) {
    await c.query("ROLLBACK");
    console.error(`ABORTADO: atualizaria ${r.rowCount}, medi ${antes.n}.`); process.exit(1);
  }
  await c.query("COMMIT");
  console.log(`curadas: ${r.rowCount} linha(s) (rowCount == medido).`);
} catch (e) { await c.query("ROLLBACK").catch(()=>{}); throw e; }
await c.end();
const c2 = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c2.connect();
console.log("DEPOIS (conexao nova):", (await c2.query(
 `SELECT COUNT(*) FILTER (WHERE amount<0)::int negativas, COUNT(*)::int total, SUM(amount)::numeric soma
    FROM workspace_channel_order_fees WHERE provider='shopee' AND fee_type='refund'`)).rows[0]);
await c2.end();
