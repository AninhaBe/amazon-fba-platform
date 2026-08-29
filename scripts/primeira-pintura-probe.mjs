// Uso: node --env-file=.env.local --experimental-strip-types \
//        --import ./scripts/ts-resolver.mjs scripts/primeira-pintura-probe.mjs
//
// ⚠️ REGRA DE HIGIENE (28/08/2026): SCRIPT LOCAL CONTRA PRODUCAO NAO ABRE POOL
// DE 10 — o pooler tem pool_size 15 compartilhado com o app e os crons. Ver
// ADR-028. O pool do db.ts e criado preguicosamente, entao definir aqui basta.
process.env.DB_POOL_MAX = "3";

// SOMENTE LEITURA. Mede o ganho do piloto de primeira pintura (commit f3833e7)
// na conta REAL (licao do ADR-017: medicao em conta demo nao representa a dela).
//
// ⚠️ NAO EXISTE A/B DE SERVIDOR AQUI, e escrever um seria mentir a favor da
// propria entrega. O servidor SEMPRE resolveu a conexao dentro da rota de
// overview; o custo dele nao mudou nada. O que o piloto corta e uma ETAPA DA
// FILA DO NAVEGADOR: antes, a tela pedia /api/integrations, esperava a resposta
// para saber qual loja, e so entao pedia o overview. Duas viagens em serie.
//
// Entao o ganho = (custo de servidor do /api/integrations) + (1 RTT navegador
// ate o Fly). E isso que este script mede, cada parcela separada.
import { runWithWorkspace } from "../src/lib/workspaceScope.ts";
import { getIntegrations } from "../src/lib/integrations/integrationStore.ts";
import { escolherConexaoPadrao } from "../src/lib/integrations/conexaoPadrao.ts";
import { getShopeeOverviewFromCanonical } from "../src/lib/integrations/shopeeOverviewCanonical.ts";

const WORKSPACE = process.env.PROBE_WORKSPACE_ID;
if (!WORKSPACE) throw new Error("PROBE_WORKSPACE_ID ausente.");
const RODADAS = Number(process.env.PROBE_RODADAS ?? 5);
const URL_SAUDE = "https://nexoaihub.com.br/api/health";

function ms(inicio) {
  return Number(process.hrtime.bigint() - inicio) / 1e6;
}

function mediana(valores) {
  const ordenado = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenado.length / 2);
  return ordenado.length % 2 ? ordenado[meio] : (ordenado[meio - 1] + ordenado[meio]) / 2;
}

async function cronometrar(fn) {
  const inicio = process.hrtime.bigint();
  await fn();
  return ms(inicio);
}

await runWithWorkspace(WORKSPACE, async () => {
  const to = new Date();
  const from = new Date(to);
  from.setHours(0, 0, 0, 0); // "hoje" — o periodo que abre por padrao

  // Aquece uma vez: o ADR-017 manda medir frio e quente separados, e aqui
  // interessa o regime quente (a etapa cortada e a mesma nos dois).
  await getIntegrations("shopee");

  const daConexao = [];
  const doOverview = [];
  // ALTERNADO (ADR-017): nunca N vezes uma coisa e depois N vezes a outra.
  for (let i = 0; i < RODADAS; i += 1) {
    daConexao.push(await cronometrar(() => getIntegrations("shopee")));
    const conexoes = await getIntegrations("shopee");
    const conexao = escolherConexaoPadrao(conexoes.filter((c) => c.provider === "shopee"));
    if (!conexao) throw new Error("sem conexao shopee neste workspace");
    doOverview.push(await cronometrar(() => getShopeeOverviewFromCanonical(conexao, { from, to })));
  }

  const rede = [];
  for (let i = 0; i < RODADAS; i += 1) {
    try {
      rede.push(await cronometrar(() => fetch(URL_SAUDE, { cache: "no-store" }).then((r) => r.text())));
    } catch {
      /* sem rede: a parcela sai do relatorio em vez de virar zero */
    }
  }

  const etapaCortada = mediana(daConexao);
  console.log(`\nconta: ${WORKSPACE}   periodo: hoje   rodadas: ${RODADAS}`);
  console.log(`\nA ETAPA QUE O PILOTO TIRA DA FILA:`);
  console.log(`  /api/integrations, custo de servidor ..... ${etapaCortada.toFixed(0)}ms`);
  if (rede.length) {
    console.log(`  1 RTT desta maquina ate o Fly (proxy) .... ${mediana(rede).toFixed(0)}ms`);
    console.log(`  -------------------------------------------`);
    console.log(`  economia estimada na primeira pintura .... ${(etapaCortada + mediana(rede)).toFixed(0)}ms`);
    console.log(`\n  ⚠️ O RTT e DESTA maquina, nao da rede da Ana. A parcela de servidor`);
    console.log(`     e a mesma para ela; a de rede pode ser maior ou menor.`);
  } else {
    console.log(`  (nao consegui medir o RTT ate o Fly — a parcela de rede fica ausente,`);
    console.log(`   nao zerada)`);
  }
  console.log(`\nPARA COMPARAR — o que sobra na primeira pintura depois do corte:`);
  console.log(`  overview de "hoje" ...................... ${mediana(doOverview).toFixed(0)}ms de servidor`);
});

process.exit(0);
