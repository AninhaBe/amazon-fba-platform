// Uso: node --env-file=.env.local scripts/vigia-do-ml.mjs
//
// Vigia o religamento do Mercado Livre depois do incidente de 29/08/2026.
//
// ⚠️ CONEXAO DIRETA (fora do pooler), de propósito: durante o incidente o pooler
// recusava conexao nova, e a sonda que passa por ele fica cega justamente quando
// mais se precisa dela. Uma conexao so, amostra a cada 20s — o instrumento tem
// custo, e o custo tem que ser medido como qualquer outro.
//
// O QUE ELE VIGIA, e por que cada um:
//  - consulta ativa passando de 60s: foi assim que o pool virou refem duas vezes;
//  - INSERT em workspace_marketplace_orders: o ML e o UNICO que escreve nessa
//    tabela (39.160 linhas, todas dele), entao e o unico que pode reproduzir a
//    primeira onda;
//  - sync do ML falhando SEMPRE no mesmo ponto: e o efeito colateral do teto de
//    120s que ninguem olhou ainda. Se a escrita legitima precisar de mais que
//    isso, o teto a mata todo ciclo e o ML nunca mais sincroniza — sintoma
//    silencioso, mais facil de nao ver que um incidente.
import { createRequire } from "node:module";

const require = createRequire("G:/amazon-fba-platform/package.json");
const { Client } = require("pg");

const u = new URL(process.env.DATABASE_URL);
const ref = decodeURIComponent(u.username).split(".").pop();
const direta = new URL(process.env.DATABASE_URL);
direta.hostname = `db.${ref}.supabase.co`;
direta.port = "5432";
direta.username = "postgres";

const MINUTOS = Number(process.env.MINUTOS ?? 6);
const agora = () => new Date().toISOString().slice(11, 19);

const c = new Client({ connectionString: direta.toString(), ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 25000 });
await c.connect();
console.log(`${agora()} vigia do ML ligado — ${MINUTOS} min, amostra a cada 20s`);

const fim = Date.now() + MINUTOS * 60_000;
let alarme = null;
let piorConsulta = 0;

while (Date.now() < fim && !alarme) {
  const ativas = await c.query(`
    SELECT pid, EXTRACT(EPOCH FROM (now()-query_start))::int AS seg,
           left(regexp_replace(query, E'\\\\s+', ' ', 'g'), 60) AS q
      FROM pg_stat_activity
     WHERE state = 'active' AND pid <> pg_backend_pid()
       AND query_start < now() - interval '20 seconds'
     ORDER BY query_start`);
  const sync = await c.query(`
    SELECT status, EXTRACT(EPOCH FROM (now()-COALESCE(last_success_at, updated_at)))/60 AS min,
           left(COALESCE(last_error, ''), 70) AS erro
      FROM workspace_marketplace_syncs
     WHERE provider = 'mercado_livre' AND connection_id NOT LIKE '%demo%'`);

  const pior = Math.max(0, ...ativas.rows.map((x) => x.seg));
  if (pior > piorConsulta) piorConsulta = pior;
  const comErro = sync.rows.filter((x) => x.erro);

  console.log(`${agora()} ativas>20s=${ativas.rowCount} pior=${pior}s | ml: ${sync.rows.map((x) => `${x.status}/${Number(x.min).toFixed(0)}m`).join(" ")}${comErro.length ? ` | ERRO: ${comErro[0].erro}` : ""}`);

  const longa = ativas.rows.find((x) => x.seg >= 60);
  if (longa) alarme = { tipo: "consulta longa", detalhe: `pid ${longa.pid}, ${longa.seg}s: ${longa.q}` };
  // Teto matando trabalho legitimo: o erro do Postgres e explicito.
  const morto = comErro.find((x) => /statement timeout|canceling statement/i.test(x.erro));
  if (morto) alarme = { tipo: "teto de 120s matando o sync", detalhe: morto.erro };

  if (!alarme) await new Promise((r) => setTimeout(r, 20000));
}

if (alarme) {
  console.log(`\n🚨 ${agora()} ${alarme.tipo.toUpperCase()}: ${alarme.detalhe}`);
  console.log("ACAO: desligar o ML (SCHEDULER_CANAIS sem mercado-livre-sync) e reportar.");
  console.log("⚠️ Se for o teto matando o sync: NAO afrouxar por reflexo — escrita que precisa");
  console.log("   de mais de 2 minutos e um problema por si so, e a resposta pode ser dividir o lote.");
} else {
  console.log(`\n${agora()} ${MINUTOS} MIN LIMPOS — pior consulta: ${piorConsulta}s, nenhum alarme.`);
}
await c.end();
process.exit(alarme ? 2 : 0);
