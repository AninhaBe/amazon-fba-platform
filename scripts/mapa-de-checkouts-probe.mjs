// Uso: node --env-file=.env.local --experimental-strip-types \
//        --import ./scripts/ts-resolver.mjs scripts/mapa-de-checkouts-probe.mjs
//
// SOMENTE LEITURA. Conta quantas idas ao pool custa UMA carga de dashboard, por
// etapa, nas conexoes REAIS (nao na demo — licao de 28/08/2026).
//
// ⚠️ POR QUE ESTE SCRIPT EXISTE (29/08/2026): a tela custava 28 checkouts contra
// 8 slots de pool de usuario. Isso e quatro ONDAS de espera antes de a tela
// ficar pronta, e enquanto for assim qualquer trabalho de fundo empurra a
// vendedora para o timeout. O sync esta desligado por causa disso.
//
// A pergunta que este script responde nao e "quanto tempo", e "QUANTAS IDAS" —
// e, para cada uma, se ela esta separada POR NECESSIDADE (depende do resultado
// da anterior) ou so POR CONVENIENCIA de codigo. Tempo aqui e ruido: a maquina
// local esta mais longe do banco que o Fly.
process.env.DB_POOL_MAX = "3";
process.env.DB_TRACE = "1";

import { runWithWorkspace } from "../src/lib/workspaceScope.ts";
import { dbQuery, checkoutsDoPool, trilhaDeConsultas, zerarContabilidade } from "../src/lib/db.ts";

const WORKSPACE = process.env.PROBE_WORKSPACE_ID;
if (!WORKSPACE) throw new Error("PROBE_WORKSPACE_ID ausente.");

const DIAS = Number(process.env.PROBE_DIAS ?? 30);

function periodo() {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - DIAS);
  return { from, to };
}

async function medir(rotulo, fn) {
  zerarContabilidade();
  const inicio = process.hrtime.bigint();
  let erro = null;
  try {
    await fn();
  } catch (err) {
    erro = err instanceof Error ? err.message : String(err);
  }
  const ms = Number(process.hrtime.bigint() - inicio) / 1e6;
  const consultas = trilhaDeConsultas().map((c) => c.sql);
  return { rotulo, checkouts: checkoutsDoPool(), ms, erro, consultas };
}

await runWithWorkspace(WORKSPACE, async () => {
  const p = periodo();

  const { getIntegrations } = await import("../src/lib/integrations/integrationStore.ts");
  const { getMercadoLivreOverviewFromCanonical } = await import(
    "../src/lib/integrations/mercadoLivreOverviewCanonical.ts"
  );
  const { getShopeeOverviewFromCanonical } = await import(
    "../src/lib/integrations/shopeeOverviewCanonical.ts"
  );
  const { requestMercadoLivreSync } = await import("../src/lib/integrations/mercadoLivreSync.ts");
  const { anunciosPorProdutoNoPeriodo } = await import("../src/lib/integrations/amazonAdsPorProduto.ts");

  // Aquece o `ensureSchema` fora da conta: ele custa 1 checkout uma vez por
  // processo e apareceria como custo da primeira etapa medida, mentindo a favor
  // das etapas seguintes.
  await dbQuery("SELECT 1", []);

  const conexoes = await getIntegrations();
  const ml = conexoes.find((c) => c.provider === "mercado_livre");
  const shopee = conexoes.find((c) => c.provider === "shopee");

  const etapas = [];

  etapas.push(await medir("route: getIntegrations()", () => getIntegrations()));

  if (ml) {
    etapas.push(await medir("route: requestMercadoLivreSync()", () => requestMercadoLivreSync(ml.id)));
    etapas.push(
      await medir("overview canonico (ML)", () => getMercadoLivreOverviewFromCanonical(ml, p))
    );
  }
  if (shopee) {
    etapas.push(
      await medir("overview canonico (Shopee)", () =>
        getShopeeOverviewFromCanonical(shopee, p)
      )
    );
  }
  etapas.push(
    await medir("route: anunciosPorProdutoNoPeriodo()", () =>
      anunciosPorProdutoNoPeriodo(p.from.toISOString(), p.to.toISOString(), "mercado_livre")
    )
  );

  // As OUTRAS rotas que a MESMA carga de tela dispara. Cada uma e uma
  // requisicao HTTP separada, entao elas NAO compartilham nada entre si —
  // getIntegrations e getCosts se repetem de rota em rota.
  const { getDashboardLayout } = await import("../src/lib/dashboardLayoutStore.ts");
  const { getCosts } = await import("../src/lib/costStore.ts");
  const { coletarSinaisDeCausa } = await import("../src/lib/centralDiagnostico.ts");

  etapas.push(await medir("route: dashboard-layout (chamada 2x na carga)", () => getDashboardLayout("dashboard")));
  etapas.push(
    await medir("route: sync-estado", () =>
      dbQuery(
        `SELECT provider, connection_id, status, updated_at FROM workspace_marketplace_syncs WHERE workspace_id = $1`,
        [WORKSPACE]
      )
    )
  );
  etapas.push(await medir("route: briefing -> coletarSinaisDeCausa()", () => coletarSinaisDeCausa()));
  // `getCosts()` se repete em TRES caminhos da mesma carga (overview do ML,
  // overview da Shopee e rota `full`) — mesma consulta, mesmo resultado.
  etapas.push(await medir("route: full -> getCosts() (3a vez na mesma carga)", () => getCosts()));

  let total = 0;
  console.log(`\nMAPA DE CHECKOUTS — workspace ${WORKSPACE}, ultimos ${DIAS} dias\n`);
  for (const e of etapas) {
    total += e.checkouts;
    console.log(`${String(e.checkouts).padStart(3)} checkouts  ${e.ms.toFixed(0).padStart(6)}ms  ${e.rotulo}${e.erro ? `  [ERRO: ${e.erro}]` : ""}`);
    for (const sql of e.consultas) console.log(`      · ${sql}`);
  }
  console.log(`\nTOTAL DA CARGA: ${total} checkouts`);
});

process.exit(0);
