import pg from "pg";
import { runScheduledTiktokSync } from "../src/lib/integrations/tiktokScheduler.ts";

const ORCAMENTO_MS = Number(process.env.ORCAMENTO_MS ?? 420_000);
const VOLTAS = Number(process.env.VOLTAS ?? 1);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const d = (x) => (x ? new Date(x).toISOString().slice(0, 16) : "null");

async function foto(rotulo) {
  const { rows } = await pool.query(
    `SELECT status, cursor_from, cursor_to, covered_to, target_to, processed_orders,
            (SELECT count(*)::int FROM workspace_channel_orders
              WHERE provider='tiktok_shop' AND connection_id NOT LIKE '%demo%') AS pedidos_banco
       FROM workspace_marketplace_syncs
      WHERE provider='tiktok_shop' AND connection_id NOT LIKE '%demo%'`
  );
  const r = rows[0];
  console.log(`[${rotulo}] status=${r.status} cursor=${d(r.cursor_from)}->${d(r.cursor_to)} processados=${r.processed_orders} PEDIDOS_NO_BANCO=${r.pedidos_banco} covered_to=${d(r.covered_to)} target_to=${d(r.target_to)}`);
  return r;
}

const inicio = await foto("INICIO");
for (let v = 1; v <= VOLTAS; v++) {
  console.log(`\n--- volta ${v}/${VOLTAS} (${Math.round(ORCAMENTO_MS / 1000)}s) ---`);
  const t0 = Date.now();
  try {
    const res = await runScheduledTiktokSync(3, ORCAMENTO_MS);
    console.log(`volta ${v} terminou em ${((Date.now() - t0) / 1000).toFixed(0)}s:`, JSON.stringify(res)?.slice(0, 300));
  } catch (e) {
    console.log(`volta ${v} EXCECAO:`, e?.message ?? String(e));
  }
  await foto(`APOS VOLTA ${v}`);
}
const fim = await foto("FIM");
console.log(`\n=== SALDO ===`);
console.log(`cursor  ${d(inicio.cursor_to)} -> ${d(fim.cursor_to)}`);
console.log(`pedidos no banco ${inicio.pedidos_banco} -> ${fim.pedidos_banco} (+${fim.pedidos_banco - inicio.pedidos_banco})`);
console.log(`status  ${inicio.status} -> ${fim.status}`);
await pool.end();
