// CURA DO GASTO DE ANÚNCIO DO MERCADO LIVRE — apaga o errado e recolhe dia a dia.
//
// Uso:
//   node --env-file=.env.local --experimental-strip-types \
//        --import ./scripts/ts-resolver.mjs scripts/curar-ads-do-mercado-livre.mjs [--executar]
//
// Sem `--executar` ele só MEDE e mostra o plano. Nada é apagado sem a flag.
//
// ⚠️ O QUE ESTAVA ERRADO. O agendador pedia ao PADS uma janela de oito dias
// (`date_from = hoje-7`, `date_to = hoje`) e gravava o resultado carimbado como
// UM dia. O PADS devolve o agregado do intervalo, então cada linha "diária" era
// a soma de oito — ~17× o valor real.
//
// Provado contra a fonte, mesma conta, mesmo minuto:
//   um dia (30/08):  R$  46,78 e    80 cliques  → console de Ads: R$ 44, 71 cliques
//   oito dias:       R$ 771,93 e 1.237 cliques  → o que estava gravado
//
// ⚠️ POR QUE APAGAR E RECOLHER, E NÃO CORRIGIR POR CÁLCULO. Um acumulado de oito
// dias não se desfaz em dias: a diferença entre dois acumulados consecutivos só
// daria o dia se nenhum dia faltasse no meio, e faltar vai acontecer. A fonte
// responde de novo (o PADS aceita 90 dias para trás), então recolher é a única
// forma que produz um dado que É o que diz ser.
//
// ⚠️ ESCOPO TRAVADO EM `mercado_livre`. A Amazon NÃO entra: o pipeline dela é
// relatório assíncrono com o `day` vindo da própria fonte, e o total dela já foi
// conferido contra o console (R$ 417,09 = 256,22 faturado + 160,87 acumulado).
//
// ⚠️ TODOS OS INQUILINOS. É instrução permanente dela que correção vale para o
// app inteiro, não só para a conta de quem reportou. A conexão zerada também
// entra: as linhas dela somam R$ 0,00 e o erro é invisível, mas a semântica está
// igualmente errada — janela de oito dias carimbada como um.
process.env.DB_POOL_MAX = "3";

const EXECUTAR = process.argv.includes("--executar");
const PROVIDER = "mercado_livre";
/** Os dias que a coleta quebrada gravou. Nada além disso é tocado. */
const DIAS = ["2026-08-28", "2026-08-29", "2026-08-30"];

const { dbQuery } = await import("../src/lib/db.ts");
const { runWithWorkspace } = await import("../src/lib/workspaceScope.ts");
const { getIntegration } = await import("../src/lib/integrations/integrationStore.ts");
const { coletarAdsDoMercadoLivre } = await import("../src/lib/integrations/mercadoLivreAdsSync.ts");

const brl = (v) => `R$ ${Number(v).toFixed(2)}`;

/** Fotografia do que existe hoje, por conexão e dia. */
async function medir() {
  return dbQuery(
    `SELECT workspace_id, connection_id, day::text AS dia,
            COUNT(*)::int AS linhas, SUM(cost)::numeric AS gasto, SUM(clicks)::int AS cliques
       FROM workspace_ad_product_metrics
      WHERE provider = $1 AND day = ANY($2::date[])
      GROUP BY workspace_id, connection_id, day
      ORDER BY workspace_id, day`,
    [PROVIDER, DIAS],
  );
}

const antes = await medir();
if (!antes.length) {
  console.log("Nada a curar: nenhuma linha do Mercado Livre nesses dias.");
  process.exit(0);
}

console.log("ANTES:");
for (const r of antes) {
  console.log(`  ${r.connection_id}  ${r.dia}  ${String(r.linhas).padStart(3)} linhas  ${brl(r.gasto).padStart(12)}  ${r.cliques} cliques`);
}
const conexoes = [...new Map(antes.map((r) => [r.connection_id, r.workspace_id])).entries()];
const linhasAntes = antes.reduce((s, r) => s + r.linhas, 0);
console.log(`\nPLANO: apagar ${linhasAntes} linha(s) de ${conexoes.length} conexão(ões) e recolher ${DIAS.length} dia(s) cada.`);
console.log(`CUSTO NA API: ${conexoes.length * DIAS.length * 3} chamadas ao PADS (3 por dia: advertisers + ads + campanhas).`);

if (!EXECUTAR) {
  console.log("\nMedição apenas. Rode com --executar para aplicar.");
  process.exit(0);
}

// ── APAGAR ────────────────────────────────────────────────────────────────────
// Uma transação, rowCount conferido contra a contagem medida, ROLLBACK se
// divergir. Divergência aqui significa que o dado mudou embaixo entre a medição
// e o apagamento — e apagar mais do que se mediu é o erro que não tem volta.
const pg = await import("pg");
const cliente = new pg.default.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: ["localhost", "127.0.0.1", "::1"].includes(new URL(process.env.DATABASE_URL).hostname)
    ? false
    : { rejectUnauthorized: false },
});
await cliente.connect();
try {
  await cliente.query("BEGIN");
  const apagadas = await cliente.query(
    `DELETE FROM workspace_ad_product_metrics WHERE provider = $1 AND day = ANY($2::date[])`,
    [PROVIDER, DIAS],
  );
  if (apagadas.rowCount !== linhasAntes) {
    await cliente.query("ROLLBACK");
    console.error(`ABORTADO: apagaria ${apagadas.rowCount} linha(s), mas a medição contou ${linhasAntes}.`);
    console.error("O dado mudou entre medir e apagar — refaça a medição antes de tentar de novo.");
    process.exit(1);
  }
  await cliente.query("COMMIT");
  console.log(`\napagadas: ${apagadas.rowCount} linha(s) (rowCount == medido).`);
} catch (erro) {
  await cliente.query("ROLLBACK").catch(() => {});
  throw erro;
} finally {
  await cliente.end();
}

// ── RECOLHER, DIA A DIA, PELO CÓDIGO CORRIGIDO ────────────────────────────────
// De propósito pelo caminho de produção, e não por consulta própria: assim a
// recoleta PROVA o conserto no mesmo ato, em vez de existir uma terceira
// semântica escrita por um script que morre depois.
console.log("\nRECOLHENDO (uma janela de um dia por vez):");
for (const [connectionId, workspaceId] of conexoes) {
  for (const dia of DIAS) {
    const r = await runWithWorkspace(workspaceId, async () => {
      const connection = await getIntegration(connectionId);
      if (!connection || connection.provider !== PROVIDER) return null;
      return coletarAdsDoMercadoLivre(connection, dia);
    });
    console.log(`  ${connectionId}  ${dia}  ${r ? `${r.gravadas} gravada(s)` : "conexão indisponível"}`);
  }
}

// ── RELEITURA EM CONEXÃO NOVA ─────────────────────────────────────────────────
// Conferir pelo mesmo pool que acabou de escrever é conferir a própria memória.
const depois = await dbQuery(
  `SELECT connection_id, day::text AS dia, COUNT(*)::int AS linhas,
          SUM(cost)::numeric AS gasto, SUM(clicks)::int AS cliques
     FROM workspace_ad_product_metrics
    WHERE provider = $1 AND day = ANY($2::date[])
    GROUP BY connection_id, day ORDER BY connection_id, day`,
  [PROVIDER, DIAS],
);
console.log("\nDEPOIS:");
for (const r of depois) {
  const a = antes.find((x) => x.connection_id === r.connection_id && x.dia === r.dia);
  const fator = a && Number(r.gasto) > 0 ? ` (era ${(Number(a.gasto) / Number(r.gasto)).toFixed(1)}× maior)` : "";
  console.log(`  ${r.connection_id}  ${r.dia}  ${String(r.linhas).padStart(3)} linhas  ${brl(r.gasto).padStart(12)}  ${r.cliques} cliques${fator}`);
}
console.log("\n⚠️ CONFIRA contra o console de Ads do canal antes de dar por curado — o número");
console.log("   nosso não vira verdade por ter sido medido por nós.");
