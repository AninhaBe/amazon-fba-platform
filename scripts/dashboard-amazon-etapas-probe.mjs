// Uso: node --env-file=.env.local --experimental-strip-types \
//        --import ./scripts/ts-resolver.mjs scripts/dashboard-amazon-etapas-probe.mjs
//
// ⚠️ REGRA DE HIGIENE (28/08/2026): SCRIPT LOCAL CONTRA PRODUCAO NAO ABRE POOL
// DE 10 — o pooler tem pool_size 15 compartilhado com o app e os crons. Ver
// ADR-028. O pool do db.ts e criado preguicosamente, entao definir aqui basta.
process.env.DB_POOL_MAX = "3";

// SOMENTE LEITURA. Mede o dashboard da Amazon POR ETAPA, na conta REAL, contra
// o Mercado Livre do MESMO workspace.
//
// POR QUE POR ETAPA: a media da rota inteira diria que ela e lenta, nao QUAL
// parte custa. A rota do ML le so o banco; a da Amazon faz mais coisa, e duas
// delas chamam a SP-API AO VIVO dentro da requisicao.
//
// ⚠️ ESTE SCRIPT FAZ CHAMADA REAL A SP-API (orderMetrics, somente leitura) com
// o token da conta — e exatamente o que a rota faz a cada abertura da tela.
// Autorizado pelo cerebro em 28/08/2026, com a condicao: se 429 acumular, PARAR
// a medicao. Melhor ficar sem o numero do que gastar o limite da conta dela.
//
// ⚠️ NENHUM IDENTIFICADOR DE CONTA E HARDCODED: o seller_id sai de
// `workspace_accounts` — a tabela onde a Amazon realmente mora (ANTERIOR ao
// modelo multicanal; ela NAO esta em `workspace_integrations`).
import { runWithWorkspace } from "../src/lib/workspaceScope.ts";
import { runWithAccount } from "../src/lib/accountContext.ts";
import { dbQuery } from "../src/lib/db.ts";

const WORKSPACE = process.env.PROBE_WORKSPACE_ID;
if (!WORKSPACE) throw new Error("PROBE_WORKSPACE_ID ausente.");
const RODADAS = Number(process.env.PROBE_RODADAS ?? 3);
const LIMITE_DE_429 = 2;

let contador429 = 0;
class Abortar429 extends Error {}

function ms(inicio) {
  return Number(process.hrtime.bigint() - inicio) / 1e6;
}

function mediana(valores) {
  if (!valores.length) return null;
  const ordenado = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenado.length / 2);
  return ordenado.length % 2 ? ordenado[meio] : (ordenado[meio - 1] + ordenado[meio]) / 2;
}

function periodos() {
  const fim = new Date();
  return [["hoje", 0], ["7 dias", 7], ["15 dias", 15], ["30 dias", 30]].map(([rotulo, n]) => {
    const inicio = new Date(fim);
    if (n === 0) inicio.setHours(0, 0, 0, 0);
    else inicio.setDate(inicio.getDate() - n);
    return { rotulo, startISO: inicio.toISOString(), endISO: fim.toISOString(), from: inicio, to: fim };
  });
}

/** Cronometra uma etapa. Erro vira medida com rotulo, nunca desaparece. */
async function etapa(nome, registro, fn) {
  const inicio = process.hrtime.bigint();
  let erro = null;
  let valor = null;
  try {
    valor = await fn();
  } catch (err) {
    erro = err instanceof Error ? err.message : String(err);
    // 429 acumulando = parar. Condicao do cerebro.
    if (/429|rate.?limit|QuotaExceeded/i.test(erro)) {
      contador429 += 1;
      if (contador429 >= LIMITE_DE_429) throw new Abortar429(erro);
    }
  }
  const dt = ms(inicio);
  (registro[nome] ??= []).push({ ms: dt, erro });
  return valor;
}

// ⚠️ A conta sai de `getAccounts()`, o MESMO caminho do app — nao de um SELECT
// meu. Motivo aprendido na primeira versao desta sonda: o `refresh_token` esta
// CIFRADO no banco (`enc:v1:`), e `accountStore` o decifra com `revealSecret`.
// Lendo cru, todas as chamadas a SP-API falhavam com "reconecte a conta" e a
// sonda concluiria que o orderMetrics "falha rapido" — mediria o MEU erro e
// inocentaria justamente o principal suspeito.
const { getAccounts } = await import("../src/lib/accountStore.ts");
const conta = await runWithWorkspace(WORKSPACE, async () => (await getAccounts())[0]);
if (!conta) throw new Error("Sem conta Amazon em workspace_accounts para este workspace.");
console.log(`conta Amazon carregada pelo caminho do app (marketplace ${conta.marketplace}); token nao exibido`);

const {
  getAmazonOverviewCanonicalCached,
} = await import("../src/lib/integrations/amazonOverviewCanonical.ts");
const { getStockRadar } = await import("../src/lib/radar.ts");
const { getDailySales } = await import("../src/lib/sales.ts");
const { defaultMarketplaceId } = await import("../src/lib/spapi.ts");
const { adsEstaConectado, anunciosNoPeriodo } = await import("../src/lib/integrations/amazonAdsSync.ts");
const { anunciosPorProdutoNoPeriodo } = await import("../src/lib/integrations/amazonAdsPorProduto.ts");
const { getMercadoLivreOverviewFromCanonical } = await import("../src/lib/integrations/mercadoLivreOverviewCanonical.ts");

/** Reproduz a rota /api/amazon/dashboard etapa por etapa, na mesma ordem. */
async function dashboardAmazon(periodo, registro) {
  const period = { startISO: periodo.startISO, endISO: periodo.endISO, key: `${periodo.startISO}:${periodo.endISO}` };

  const canonical = await etapa("1. canonico (getAmazonOverviewCanonicalCached)", registro,
    () => getAmazonOverviewCanonicalCached(period));
  if (!canonical) return;

  const escopo = [WORKSPACE, canonical.connectionId, periodo.from, periodo.to];

  // As cinco em paralelo, como na rota — e cada uma tambem medida sozinha para
  // saber quem segura o grupo (o Promise.all custa o MAIS LENTO, nao a soma).
  await etapa("2. as cinco em paralelo (o que a rota espera)", registro, () => Promise.all([
    etapa("2a. tarifas por tipo (banco)", registro, () => dbQuery(
      `SELECT f.fee_type, SUM(f.amount)::text AS total
         FROM workspace_channel_order_fees f
         JOIN workspace_channel_orders o
           ON o.workspace_id = f.workspace_id AND o.provider = f.provider
          AND o.connection_id = f.connection_id AND o.external_order_id = f.external_order_id
        WHERE f.workspace_id = $1 AND f.provider = 'amazon' AND f.connection_id = $2
          AND o.occurred_at BETWEEN $3 AND $4
        GROUP BY f.fee_type`, escopo)),
    etapa("2b. pedidos faturados (banco)", registro, () => dbQuery(
      `SELECT COUNT(*)::text AS pedidos
         FROM workspace_channel_orders
        WHERE workspace_id = $1 AND provider = 'amazon' AND connection_id = $2
          AND occurred_at BETWEEN $3 AND $4 AND status <> 'cancelled'`, escopo)),
    etapa("2c. radar de estoque (getStockRadar)", registro,
      () => getStockRadar(period, canonical.velocityBySku).catch(() => null)),
    etapa("2d. ⚠️ getDailySales -> SP-API orderMetrics", registro,
      () => getDailySales(period, defaultMarketplaceId())),
    etapa("2e. frescor do sync (banco)", registro, () => dbQuery(
      `SELECT covered_from, covered_to, status, processed_orders
         FROM workspace_marketplace_syncs
        WHERE workspace_id = $1 AND provider = 'amazon' AND connection_id = $2`,
      [WORKSPACE, canonical.connectionId])),
  ]));

  // Fora do Promise.all DE PROPOSITO na rota — entao custa em SERIE, somando.
  await etapa("3. anuncios (em SERIE depois do grupo)", registro, () => Promise.all([
    anunciosNoPeriodo(period.startISO, period.endISO),
    adsEstaConectado(),
    anunciosPorProdutoNoPeriodo(period.startISO, period.endISO).catch(() => []),
  ]));
}

async function overviewMercadoLivre(periodo, registro) {
  const conexao = (await dbQuery(
    `SELECT id, provider, status, metadata FROM workspace_integrations
      WHERE workspace_id = $1 AND provider = 'mercado_livre' AND status = 'connected'
      ORDER BY connected_at LIMIT 1`, [WORKSPACE]
  ))[0];
  if (!conexao) return;
  await etapa("ML: overview inteiro (so banco)", registro,
    () => getMercadoLivreOverviewFromCanonical(
      { id: conexao.id, provider: conexao.provider, status: conexao.status, metadata: conexao.metadata ?? {} },
      { from: periodo.from, to: periodo.to }
    ));
}

function relatar(titulo, registro) {
  console.log(`\n== ${titulo} ==`);
  for (const [nome, amostras] of Object.entries(registro)) {
    const boas = amostras.filter((a) => !a.erro).map((a) => a.ms);
    const ruins = amostras.filter((a) => a.erro);
    const m = mediana(boas);
    console.log(
      `  ${nome.padEnd(46)} ${m == null ? "   n/a" : m.toFixed(0).padStart(6)}ms  (n=${boas.length})`
    );
    // ⚠️ Etapa que FALHA tambem custa tempo, e esse tempo e o que a pessoa
    // espera. Reportar so a mediana das que deram certo esconderia justamente o
    // caso caro (chamada que erra depois de segundos de backoff).
    if (ruins.length) {
      const mr = mediana(ruins.map((a) => a.ms));
      console.log(`  ${"".padEnd(46)} ${mr.toFixed(0).padStart(6)}ms  (${ruins.length} COM ERRO: ${ruins[0].erro.slice(0, 70)})`);
    }
  }
}

try {
  await runWithWorkspace(WORKSPACE, () =>
    runWithAccount({ sellerId: conta.sellerId, refreshToken: conta.refreshToken }, async () => {
      const lista = periodos();

      // FRIO: primeira visita de cada periodo — e o que ela sente ao clicar num
      // filtro que ainda nao abriu. Para a Amazon isso importa mais que no ML,
      // porque o cache do getDailySales e POR PERIODO.
      const frioAmazon = {};
      const frioML = {};
      for (const periodo of lista) {
        console.log(`\n--- frio · ${periodo.rotulo} ---`);
        await dashboardAmazon(periodo, frioAmazon);
        await overviewMercadoLivre(periodo, frioML);
      }
      relatar("FRIO — Amazon por etapa", frioAmazon);
      relatar("FRIO — Mercado Livre", frioML);

      // QUENTE: rodadas alternando periodo a periodo (ADR-017).
      const quenteAmazon = {};
      const quenteML = {};
      for (let r = 1; r <= RODADAS; r += 1) {
        for (const periodo of lista) {
          await dashboardAmazon(periodo, quenteAmazon);
          await overviewMercadoLivre(periodo, quenteML);
        }
        console.log(`rodada quente ${r}/${RODADAS} concluida`);
      }
      relatar("QUENTE — Amazon por etapa", quenteAmazon);
      relatar("QUENTE — Mercado Livre", quenteML);
    })
  );
} catch (err) {
  if (err instanceof Abortar429) {
    console.log(`\n⚠️ MEDICAO ABORTADA: ${LIMITE_DE_429} respostas de rate limit da SP-API.`);
    console.log(`   Melhor ficar sem o numero do que gastar o limite da conta dela.`);
  } else {
    throw err;
  }
}

process.exit(0);
