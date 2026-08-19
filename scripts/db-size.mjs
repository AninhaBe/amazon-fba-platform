// Fotografia do tamanho do banco — ver docs/adr/ADR-016 (regra 6: medir sempre,
// nao quando doi). Este levantamento foi feito a mao em 19/08/2026 e achou o banco
// 59 MB acima do limite do plano; virou comando para nao depender de acaso.
//
//   node --env-file=.env.local scripts/db-size.mjs
//
// Somente leitura: consulta catalogo e estatisticas, nao toca em dado de negocio.
import pg from "pg";

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const q = async (sql, params = []) => (await client.query(sql, params)).rows;

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("ERRO: DATABASE_URL ausente. Use: node --env-file=.env.local scripts/db-size.mjs");
    process.exit(1);
  }
  await client.connect();

  const [{ total }] = await q(
    "select pg_size_pretty(pg_database_size(current_database())) total"
  );
  console.log(`TAMANHO DO BANCO: ${total}\n`);

  console.log("== 15 maiores relacoes ==");
  const maiores = await q(`
    select n.nspname || '.' || c.relname as rel,
           pg_size_pretty(pg_total_relation_size(c.oid)) as total,
           pg_size_pretty(pg_relation_size(c.oid))       as dados,
           pg_size_pretty(pg_indexes_size(c.oid))        as indices
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r', 'm', 'p')
       and n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
     order by pg_total_relation_size(c.oid) desc
     limit 15`);
  for (const r of maiores) {
    console.log(
      `  ${r.rel.padEnd(46)} ${r.total.padStart(9)}  (dados ${r.dados}, indices ${r.indices})`
    );
  }

  // Indice que nunca foi lido custa disco E deixa toda escrita mais lenta.
  console.log("\n== indices nunca usados (idx_scan = 0) ==");
  const ociosos = await q(`
    select schemaname || '.' || relname as tabela, indexrelname as indice,
           pg_size_pretty(pg_relation_size(indexrelid)) as tamanho
      from pg_stat_user_indexes
     where idx_scan = 0
       and indexrelid not in (select conindid from pg_constraint where contype in ('p','u'))
     order by pg_relation_size(indexrelid) desc
     limit 10`);
  if (!ociosos.length) console.log("  (nenhum)");
  for (const r of ociosos) console.log(`  ${r.tabela}.${r.indice} — ${r.tamanho}`);

  console.log("\n== tuplas mortas (espaco preso ate o autovacuum) ==");
  const mortas = await q(`
    select schemaname || '.' || relname as rel, n_live_tup live, n_dead_tup dead,
           to_char(last_autovacuum, 'YYYY-MM-DD HH24:MI') as ultimo_autovacuum
      from pg_stat_user_tables
     where n_dead_tup > 1000
     order by n_dead_tup desc
     limit 10`);
  if (!mortas.length) console.log("  (nenhuma relevante)");
  for (const r of mortas) {
    const pct = r.live > 0 ? Math.round((r.dead / r.live) * 100) : 0;
    console.log(
      `  ${r.rel.padEnd(46)} vivas ${String(r.live).padStart(8)}  mortas ${String(r.dead).padStart(8)} (${pct}%)  autovacuum ${r.ultimo_autovacuum ?? "nunca"}`
    );
  }

  // A fila de webhooks e a tabela com politica de retencao (ADR-016).
  console.log("\n== fila de webhooks (workspace_marketplace_events) ==");
  const fila = await q(`
    select status, count(*)::int n,
           to_char(min(received_at), 'YYYY-MM-DD') as mais_antigo,
           count(*) FILTER (
             WHERE status = 'complete' AND processed_at < now() - interval '30 days'
           )::int as elegivel_expurgo
      from workspace_marketplace_events
     group by status
     order by n desc`);
  for (const r of fila) {
    console.log(
      `  ${String(r.status).padEnd(12)} ${String(r.n).padStart(8)}  desde ${r.mais_antigo}  elegivel ao expurgo: ${r.elegivel_expurgo}`
    );
  }

  await client.end();
}

main().catch(async (e) => {
  console.error("Falhou:", e.message);
  try {
    await client.end();
  } catch {}
  process.exit(1);
});
