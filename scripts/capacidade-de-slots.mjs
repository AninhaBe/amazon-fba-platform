// Uso: node --env-file=.env.local --experimental-strip-types \
//        --import ./scripts/ts-resolver.mjs scripts/capacidade-de-slots.mjs
//
// ⚠️ Script local contra producao: pool pequeno (ADR-028).
process.env.DB_POOL_MAX = "8";

// Responde DUAS perguntas com medicao, nao com conta de guardanapo:
//   (1) quantos SLOTS DE SERVIDOR do Supavisor a gente ocupa no pico hoje;
//   (2) a partir de quantos usuarios simultaneos o teto de 15 comeca a doer.
//
// O metodo: um amostrador olha `pg_stat_activity` pela conexao DIRETA (fora do
// pooler, senao ele mediria a si mesmo) enquanto N composicoes de dashboard
// rodam em paralelo pelo pool da APLICACAO. Sobe N e observa onde a curva quebra.
//
// ⚠️ Por que medir e nao calcular: a conta ingenua (28 transacoes x microssegundos)
// diz que cabem centenas de usuarios. A noite de 29/08 mostrou que nao — porque o
// que derruba nao e a MEDIA, e a CAUDA. Uma consulta longa segura o slot inteiro
// pela duracao dela.
import { createRequire } from "node:module";
import { runWithWorkspace } from "../src/lib/workspaceScope.ts";
import { runWithAccount } from "../src/lib/accountContext.ts";
import { getAccounts } from "../src/lib/accountStore.ts";
import { dbQuery } from "../src/lib/db.ts";

const require = createRequire("G:/amazon-fba-platform/package.json");
const { Client } = require("pg");

const W = process.env.PROBE_WORKSPACE_ID ?? "22ae3d9d-6f28-4ec2-96dd-a106b2b3e40d";
const POOL_SIZE = Number(process.env.SUPAVISOR_POOL_SIZE ?? 15);

const u = new URL(process.env.DATABASE_URL);
const ref = decodeURIComponent(u.username).split(".").pop();
const direta = new URL(process.env.DATABASE_URL);
direta.hostname = `db.${ref}.supabase.co`;
direta.port = "5432";
direta.username = "postgres";

const { getAmazonOverviewCanonicalCached } = await import("../src/lib/integrations/amazonOverviewCanonical.ts");
const conta = await runWithWorkspace(W, async () => (await getAccounts())[0]);

/** Uma composicao de dashboard: o mesmo trabalho que a tela pede. */
async function umaCarga(i) {
  const fim = new Date(), ini = new Date(fim);
  ini.setDate(ini.getDate() - 30);
  const p = { startISO: ini.toISOString(), endISO: fim.toISOString(), key: `cap:${Date.now()}:${i}` };
  const canonical = await getAmazonOverviewCanonicalCached(p);
  if (!canonical) return;
  const esc = [W, canonical.connectionId, ini, fim];
  await Promise.all([
    dbQuery(`SELECT f.fee_type, SUM(f.amount)::text t FROM workspace_channel_order_fees f JOIN workspace_channel_orders o ON o.workspace_id=f.workspace_id AND o.provider=f.provider AND o.connection_id=f.connection_id AND o.external_order_id=f.external_order_id WHERE f.workspace_id=$1 AND f.provider='amazon' AND f.connection_id=$2 AND o.occurred_at BETWEEN $3 AND $4 GROUP BY 1`, esc),
    dbQuery(`SELECT COUNT(*)::int n FROM workspace_channel_orders WHERE workspace_id=$1 AND provider='amazon' AND connection_id=$2 AND occurred_at BETWEEN $3 AND $4`, esc),
    dbQuery(`SELECT covered_from FROM workspace_marketplace_syncs WHERE workspace_id=$1 AND provider='amazon' AND connection_id=$2`, [W, canonical.connectionId]),
  ]);
}

const amostrador = new Client({ connectionString: direta.toString(), ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 25000 });
await amostrador.connect();

async function medirNivel(n) {
  let pico = 0, amostras = 0, soma = 0;
  let parar = false;
  const amostrando = (async () => {
    while (!parar) {
      try {
        const r = await amostrador.query(
          `SELECT count(*)::int ocupados FROM pg_stat_activity
            WHERE application_name = 'Supavisor' AND state = 'active'`);
        const v = r.rows[0].ocupados;
        if (v > pico) pico = v;
        soma += v; amostras += 1;
      } catch { /* amostra perdida nao invalida a medida */ }
      await new Promise((r) => setTimeout(r, 150));
    }
  })();

  const t = Date.now();
  await runWithWorkspace(W, () => runWithAccount({ sellerId: conta.sellerId, refreshToken: conta.refreshToken }, () =>
    Promise.all(Array.from({ length: n }, (_, i) => umaCarga(i)))));
  const ms = Date.now() - t;
  parar = true;
  await amostrando;
  const media = amostras ? (soma / amostras).toFixed(1) : "?";
  console.log(`  ${String(n).padStart(2)} carga(s) simultanea(s): ${String(ms).padStart(6)}ms | pico de slots ocupados: ${pico} de ${POOL_SIZE} | media ${media} | ${amostras} amostras`);
  return { n, ms, pico };
}

console.log(`pool_size do Supavisor (confirmado pela dona): ${POOL_SIZE}`);
console.log("\nUMA CARGA = uma composicao de dashboard (o que a tela pede):");
const resultados = [];
for (const n of [1, 2, 4, 8]) resultados.push(await medirNivel(n));

console.log("\n== LEITURA ==");
const base = resultados[0];
for (const r of resultados) {
  const ideal = base.ms;
  const degradacao = (r.ms / ideal).toFixed(1);
  const linear = r.n;
  console.log(`  ${String(r.n).padStart(2)} simultaneas: ${degradacao}x o tempo de uma | se escalasse perfeito seria 1,0x | se serializasse seria ${linear},0x`);
}
console.log(`\n  pico maximo observado: ${Math.max(...resultados.map((r) => r.pico))} de ${POOL_SIZE} slots`);
await amostrador.end();
process.exit(0);
