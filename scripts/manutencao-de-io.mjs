/**
 * MANUTENCAO DE IO DO BANCO — VACUUM (ANALYZE) nas tabelas quentes.
 *
 * ⚠️ POR QUE (04/09/2026): alerta de "depleting its Disk IO Budget" no Supabase.
 * Medido no `pg_stat_statements`, o autovacuum esta ATRASADO nas tabelas
 * quentes — `workspace_marketplace_shipments` nao era aspirada desde 31/07, 35
 * dias. Mapa de visibilidade velho obriga TODO index-only scan do banco a ir ao
 * heap: e a causa COMUM dos tres maiores ofensores medidos.
 *
 * O que este script NAO faz, de proposito:
 *  - `VACUUM FULL` (trava a tabela e reescreve o arquivo);
 *  - mudanca de schema — indice e `autovacuum_scale_factor` vao pela migration
 *    0032, pelo fluxo assinado;
 *  - remover ou alterar qualquer dado.
 *
 * `VACUUM (ANALYZE)` comum nao bloqueia leitura nem escrita.
 *
 * Uso (padrao aplicar.sh — a Ana roda com `!` no terminal):
 *   node --env-file=.env.local scripts/manutencao-de-io.mjs            # so mede
 *   node --env-file=.env.local scripts/manutencao-de-io.mjs --aplicar  # executa
 */
import pg from "pg";

const APLICAR = process.argv.includes("--aplicar");
const RESETAR = !process.argv.includes("--sem-reset");

const TABELAS = [
  "workspace_marketplace_shipments",
  "workspace_marketplace_orders",
  "workspace_channel_orders",
  "workspace_channel_order_items",
  "workspace_channel_order_fees",
  "workspace_marketplace_events",
];

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL ausente."); process.exit(1); }

const cliente = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await cliente.connect();

async function estado(titulo) {
  const { rows } = await cliente.query(
    `SELECT relname, n_live_tup AS vivas, n_dead_tup AS mortas,
            round(100.0*n_dead_tup/nullif(n_live_tup+n_dead_tup,0),1) AS pct_morto,
            to_char(greatest(coalesce(last_vacuum,'epoch'), coalesce(last_autovacuum,'epoch')),
                    'YYYY-MM-DD HH24:MI') AS ultima_aspirada
       FROM pg_stat_user_tables WHERE relname = ANY($1::text[])
      ORDER BY n_dead_tup DESC`, [TABELAS]);
  console.log(`\n=== ${titulo}`);
  for (const l of rows) {
    console.log(`  ${l.relname.padEnd(34)} vivas=${String(l.vivas).padStart(7)} mortas=${String(l.mortas).padStart(6)}`
      + ` (${String(l.pct_morto ?? 0).padStart(4)}%) ultima=${l.ultima_aspirada}`);
  }
}

await estado("ANTES");

if (!APLICAR) {
  console.log("\nSO MEDICAO. Para executar de verdade: --aplicar");
  await cliente.end();
  process.exit(0);
}

for (const tabela of TABELAS) {
  const t0 = Date.now();
  try {
    // VACUUM nao roda dentro de transacao — o cliente envia solto, e e por isso
    // que nao ha BEGIN/COMMIT em lugar nenhum aqui.
    await cliente.query(`VACUUM (ANALYZE) ${tabela}`);
    console.log(`  ${tabela}: ok em ${Date.now() - t0} ms`);
  } catch (erro) {
    // Uma tabela que falha nao cala as outras.
    console.error(`  ${tabela}: FALHOU — ${erro instanceof Error ? erro.message.slice(0, 160) : erro}`);
  }
}

// O indice dos eventos pendentes lia 799 buffers para achar 1 linha.
// CONCURRENTLY nao bloqueia leitura nem escrita; se falhar, pode deixar um
// indice invalido — por isso a conferencia vem junto, e nao depois.
try {
  await cliente.query("REINDEX INDEX CONCURRENTLY workspace_marketplace_events_pending_idx");
  console.log("  reindex do indice de eventos: ok");
} catch (erro) {
  console.error(`  reindex FALHOU — ${erro instanceof Error ? erro.message.slice(0, 160) : erro}`);
  const { rows } = await cliente.query("SELECT indexrelid::regclass::text AS idx FROM pg_index WHERE NOT indisvalid");
  console.error(rows.length
    ? `  ⚠️ INDICE INVALIDO deixado para tras: ${rows.map((r) => r.idx).join(", ")} — remover com DROP INDEX`
    : "  (nenhum indice invalido ficou para tras)");
}

await estado("DEPOIS");

if (RESETAR) {
  // ⚠️ POR ULTIMO, e so depois de tudo acima: sem o marco zero, a media
  // acumulada de 51 dias esconde o efeito da correcao — e a pergunta que
  // importa, "a taxa de HOJE cabe no budget?", continua sem resposta medida.
  await cliente.query("SELECT pg_stat_statements_reset()");
  const { rows } = await cliente.query("SELECT stats_reset FROM pg_stat_statements_info");
  console.log(`\n=== MARCO ZERO: pg_stat_statements zerado em ${rows[0]?.stats_reset}`);
  console.log("A remedicao e em 48h — a partir daqui os numeros sao da taxa NOVA.");
}

await cliente.end();
process.exit(0);
