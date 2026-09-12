/**
 * ⚠️ SCRIPT DE CURA — ITERA TODOS OS INQUILINOS POR PADRAO (01/09/2026).
 *
 * Todo script de cura varre TODAS as conexoes do canal, em TODOS os workspaces.
 * Rodar numa conta so e a excecao, e exige `--conexao <id>` explicito.
 *
 * O erro que criou a regra: este script nasceu com workspace e seller FIXOS,
 * porque o defeito apareceu numa conta. Medido no mesmo dia — a conta da propria
 * dona do produto vive em OUTRO workspace, e ficou de fora de todas as curas do
 * dia sem que nada ficasse vermelho. A doutrina de 23/08/2026 nao mudou: o app e
 * multi-inquilino, curar dado e na tabela inteira.
 */
/**
 * BACKFILL: troca o agregado colado pela tarifa DECOMPOSTA, por rubrica.
 *
 * ⚠️ O DEFEITO QUE ISTO CONSERTA, medido em 01/09/2026 na conexao
 * `amazon:A15NQMF7A6J1Y0`: 5.267 linhas de tarifa foram gravadas como
 * `fee_type = 'commission'` com `provider_fee_code = 'transactions_total'` — o
 * TOTAL de todas as tarifas do pedido, guardado sob o nome de uma delas.
 *
 * Isso nao fica so no banco. O card de Comissao da tela casa
 * `/commission|referralfee/` contra `fee_type`, entao o agregado inteiro cai nele.
 * Na tela de 30 dias: Taxas R$ 17.756,48, Comissao R$ 15.129,32 (85,2%),
 * Logistica FBA R$ 1.338,78. O TOTAL esta certo; a DIVISAO mente.
 * Medido em 11/08 pela Transactions API: naquele dia 72% do que chamamos de
 * comissao era FBA (R$ 328,12 de FBAPerUnitFulfillmentFee contra R$ 126,38 de
 * Commission). O agregado de R$ 7,31 e R$ 5,65 de FBA + R$ 1,66 de comissao.
 *
 * 📌 POR QUE O SYNC DIARIO NAO RESOLVE SOZINHO: `syncMissingOrderFees` exclui
 * pedido que ja tem `fee_type = 'commission'` — e o agregado esta rotulado
 * assim. O sync nao ve buraco nenhum. Por isso backfill dedicado, selecionando
 * por `provider_fee_code = 'transactions_total'`.
 *
 * ⚠️ A TROCA E ATOMICA POR PEDIDO, e essa e a parte perigosa. A chave de
 * conflito da tabela inclui `provider_fee_code`, entao gravar `Commission` e
 * `FBAPerUnitFulfillmentFee` AO LADO do `transactions_total` existente
 * DUPLICARIA a tarifa do pedido. Apagar o agregado e inserir as rubricas
 * acontece na MESMA transacao — ou os dois, ou nenhum. E pedido que a API nao
 * decompuser mantem o agregado intacto: melhor rotulo errado que tarifa perdida.
 *
 * Regras acordadas com o cerebro e o Delta em 01/09/2026:
 *  - janela de 60 dias (o que a tela alcanca e o que a comparacao com o Gestor
 *    Seller usa). Mais antigo que isso fica como esta;
 *  - TARIFA REAL PRIMEIRO; o estimador so roda depois, no que sobrar. Estimativa
 *    retroativa sobre pedido que ja tem tarifa real nao e previsao — e acerto por
 *    construcao, e contamina a pontaria da ADR-027 a nosso favor;
 *  - fatiado por dia, medindo o tamanho do banco entre as fatias;
 *
 * ⚠️ DUAS FASES, E A SEGUNDA SO ESCREVE DEPOIS DE LER TUDO. A primeira versao
 * escrevia dentro do laco de dias e tirava o pedido da lista no primeiro acerto.
 * Isso perde tarifa: a Amazon lanca as rubricas de UM pedido em DIAS DIFERENTES
 * (a comissao num dia, a logistica noutro), e so a primeira fatia era gravada.
 * Medido depois de rodar assim nos 60 dias: a soma do nosso banco ficou
 * R$ 965,42 ABAIXO da soma da propria API, em 1.604 pedidos.
 *
 * E o relatorio dizia "3.113 decompostos, faltam 1" — teria passado por concluido.
 * Foi a conferencia contra a fonte que pegou, nao o relatorio da execucao: numero
 * que o proprio processo produz nao serve para auditar o processo.
 *  - PARADA em +8 MB de crescimento acumulado (~4x o previsto de ~2 MB). A regra
 *    e por DELTA e nao por folga absoluta de proposito: a quota de 500 MB e uma
 *    constante transcrita de painel em agosto e nunca verificada — regra de
 *    parada com quota chutada da confianca de freio a um freio que nao existe.
 *
 * Uso: node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/ts-resolver.mjs \
 *        scripts/backfill-decompor-tarifa-amazon.mjs [--dias 60] [--aplicar]
 *
 * Sem `--aplicar` roda em modo SECO: mede e mostra o que faria, sem escrever.
 */
process.env.DB_POOL_MAX = "4";
import { dbQuery, dbTransaction } from "../src/lib/db.ts";
import { runWithWorkspace } from "../src/lib/workspaceScope.ts";
import { runWithAccount } from "../src/lib/accountContext.ts";
import { periodFromRange } from "../src/lib/period.ts";
import { naturezaDaTarifa } from "../src/lib/integrations/amazonSync.ts";
import { SQL_TARIFAS_QUE_CUSTAM } from "../src/lib/integrations/canonical.ts";

const LIMITE_DE_CRESCIMENTO_MB = 8;

const arg = (nome, padrao) => {
  const i = process.argv.indexOf(nome);
  return i === -1 ? padrao : process.argv[i + 1];
};
const DIAS = Number(arg("--dias", 60));
const APLICAR = process.argv.includes("--aplicar");
const SO_ESTA_CONEXAO = arg("--conexao", null);
const brl = (v) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v));

const tamanhoDoBanco = async () =>
  Number((await dbQuery(`SELECT pg_database_size(current_database())::text AS b`))[0].b);

const conexoes = await dbQuery(
  `SELECT DISTINCT o.workspace_id, o.connection_id
     FROM workspace_channel_orders o
    WHERE o.provider = 'amazon' AND o.connection_id <> 'amazon:demo'
    ORDER BY 1, 2`);
const alvosDeConexao = SO_ESTA_CONEXAO
  ? conexoes.filter((c) => c.connection_id === SO_ESTA_CONEXAO)
  : conexoes;
console.log(`conexoes Amazon: ${conexoes.length} | a processar: ${alvosDeConexao.length}`);

for (const { workspace_id: WS, connection_id: CONN } of alvosDeConexao) {
  const SELLER = CONN.replace("amazon:", "");
  console.log(`
===== ${CONN} (workspace ${WS.slice(0, 8)}) =====`);
  await runWithWorkspace(WS, async () => {
  const inicial = await tamanhoDoBanco();
  console.log(`modo: ${APLICAR ? "APLICANDO" : "SECO (nada e escrito)"} | janela: ${DIAS} dias`);
  console.log(`banco no inicio: ${(inicial / 1048576).toFixed(1)} MB\n`);

  // ⚠️ O ALVO E UM CONJUNTO DE PEDIDOS; AS FATIAS ANDAM POR DATA DE LANCAMENTO.
  //
  // A primeira versao fatiava por data do PEDIDO e perguntava a Transactions API
  // pelo mesmo dia. Medido no modo seco: 38% ficavam sem decomposicao (28 de 73
  // em dois dias; 22 de 46 num deles). A causa e semantica, nao de volume — a
  // Transactions API responde por data de LANCAMENTO, e a Amazon lanca a tarifa
  // DEPOIS do pedido. Perguntar pelo dia do pedido simplesmente nao alcanca a
  // tarifa que sera postada dias depois.
  //
  // Se eu tivesse rodado assim, 38% dos pedidos continuariam colados e o relatorio
  // diria "concluido" — a forma mais cara de erro, porque ninguem reinvestiga o
  // que ja foi dado como feito.
  //
  // Agora: monta-se o conjunto de pedidos-alvo uma vez, e caminha-se pelos dias de
  // LANCAMENTO. Cada dia decompoe qualquer pedido do conjunto que aparecer, seja
  // qual for a data dele. A margem de MARGEM_DE_LANCAMENTO_DIAS depois da janela
  // cobre a tarifa que ainda vai ser postada.
  // ⚠️ O ALVO E TODO PEDIDO DA JANELA, com ou sem linha de tarifa — e a mudanca
  // que fecha o ultimo buraco (01/09/2026).
  //
  // Enquanto o alvo exigia JOIN com a tabela de tarifa, o pedido que nunca teve
  // tarifa ingerida ficava invisivel para o backfill. Medido depois da primeira
  // passada correta: a soma do nosso banco continuava R$ 817,52 abaixo da API, e
  // 100% dessa diferenca eram 74 pedidos SEM NENHUMA LINHA — nenhum pedido
  // divergia por valor errado. Nao era erro de decomposicao; era ausencia.
  //
  // 📌 E fecha com TARIFA REAL, nao com estimativa. A ordem acordada (real
  // primeiro, estimador so no que sobrar) so vale se o "real primeiro" alcancar
  // tudo que a fonte tem — senao o estimador cobre com previsao um pedido cuja
  // tarifa a Amazon ja publicou.
  const alvos = await dbQuery(
    `SELECT o.external_order_id, o.currency
       FROM workspace_channel_orders o
      WHERE o.workspace_id = $1 AND o.provider = 'amazon' AND o.connection_id = $2
        AND o.status <> 'cancelled'
        AND o.occurred_at::date >= (now() - ($3 || ' days')::interval)::date`,
    [WS, CONN, DIAS]);
  const moedaDe = new Map(alvos.map((a) => [a.external_order_id, a.currency ?? "BRL"]));
  const pendentes = new Set(moedaDe.keys());
  console.log(`${pendentes.size} pedidos na janela de ${DIAS} dias — todos reconciliados contra a fonte`);

  // Dias de LANCAMENTO a percorrer: a janela inteira, do mais recente para tras.
  const MARGEM_DE_LANCAMENTO_DIAS = 0; // o lancamento vem DEPOIS do pedido, nunca antes
  const dias = [];
  for (let i = -MARGEM_DE_LANCAMENTO_DIAS; i <= DIAS; i += 1) {
    const d = new Date(Date.now() - i * 86_400_000);
    dias.push({ dia: new Date(d.getTime() - 3 * 3_600_000).toISOString().slice(0, 10), pedidos: 0 });
  }
  console.log(`${dias.length} dias de lancamento a percorrer\n`);

  const { getAccounts } = await import("../src/lib/accountStore.ts");
  const conta = (await getAccounts()).find((c) => c.sellerId === SELLER);
  // Duas vias de credencial convivem: token guardado (app-dash) dentro de
  // `runWithAccount`, e o par do `.env` FORA dele — `getAccessToken` so cai no
  // segundo quando `currentAccount()` e nulo.
  const comCredencial = (fn) =>
    conta
      ? runWithAccount({ workspaceId: WS, sellerId: SELLER, refreshToken: conta.refreshToken }, fn)
      : fn();

  const total = { trocados: 0, semDecomposicao: 0, semResposta: 0, linhas: 0, fatias: 0 };

  // ---------------------------------------------------------------- FASE 1
  // Le TODOS os dias de lancamento e ACUMULA as rubricas por pedido. Nada e
  // escrito aqui — e a leitura que torna a escrita correta, porque so ao final
  // da varredura se sabe o conjunto completo de rubricas de um pedido.
  const acumulado = new Map(); // externalOrderId -> Map(tipoDaAmazon -> valor)
  await comCredencial(async () => {
    const { getOrderFinancialsFromTransactions } = await import("../src/lib/transactions.ts");
    for (const { dia } of dias) {
      let fin;
      try {
        fin = await getOrderFinancialsFromTransactions(periodFromRange(dia, dia));
      } catch (erro) {
        console.log(`  lancamento ${dia}  ⚠️ Transactions falhou (${String(erro?.message ?? erro).slice(0, 60)}) — dia PULADO`);
        total.semResposta += 1;
        continue;
      }
      let tocados = 0;
      for (const [externalOrderId, f] of Object.entries(fin)) {
        if (!pendentes.has(externalOrderId)) continue;
        const rubricas = Object.entries(f?.porTipo ?? {}).filter(([, valor]) => Number(valor) > 0);
        if (!rubricas.length) continue;
        const doPedido = acumulado.get(externalOrderId) ?? new Map();
        for (const [tipo, valor] of rubricas) doPedido.set(tipo, (doPedido.get(tipo) ?? 0) + Number(valor));
        acumulado.set(externalOrderId, doPedido);
        tocados += 1;
      }
      if (tocados) console.log(`  lancamento ${dia}  → ${String(tocados).padStart(3)} pedidos com rubrica  | acumulados ${acumulado.size}/${pendentes.size}`);
    }
  });

  total.semDecomposicao = pendentes.size - acumulado.size;
  console.log(`\nFASE 1 concluida: ${acumulado.size} pedidos com rubrica, ${total.semDecomposicao} sem nenhuma (agregado sera mantido)`);

  // ---------------------------------------------------------------- FASE 2
  // Escreve UMA VEZ por pedido, com o conjunto completo. A troca continua sendo
  // atomica: o agregado sai e as rubricas entram na mesma transacao.
  if (!APLICAR) {
    for (const [, rubricas] of acumulado) total.linhas += rubricas.size;
    total.trocados = acumulado.size;
  } else {
    let feitos = 0;
    for (const [externalOrderId, rubricas] of acumulado) {
      const crescimento = feitos % 200 === 0 ? (await tamanhoDoBanco()) - inicial : 0;
      if (crescimento > LIMITE_DE_CRESCIMENTO_MB * 1048576) {
        console.log(`\n🔴 PARADA: o banco cresceu ${(crescimento / 1048576).toFixed(1)} MB, acima do limite de ${LIMITE_DE_CRESCIMENTO_MB} MB.`);
        break;
      }
      await dbTransaction(async (query) => {
        await query(
          `DELETE FROM workspace_channel_order_fees
            WHERE workspace_id = $1 AND provider = 'amazon' AND connection_id = $2
              AND external_order_id = $3 AND fee_type IN (${SQL_TARIFAS_QUE_CUSTAM})`,
          [WS, CONN, externalOrderId]);
        for (const [tipoDaAmazon, valor] of rubricas) {
          await query(
            `INSERT INTO workspace_channel_order_fees
               (workspace_id, provider, connection_id, external_order_id, fee_type,
                provider_fee_code, amount, currency)
             VALUES ($1, 'amazon', $2, $3, $4, $5, $6, $7)
             ON CONFLICT (workspace_id, provider, connection_id, external_order_id, fee_type, provider_fee_code)
             DO UPDATE SET amount = EXCLUDED.amount`,
            [WS, CONN, externalOrderId, naturezaDaTarifa(tipoDaAmazon),
             tipoDaAmazon, Number(valor).toFixed(2), moedaDe.get(externalOrderId) ?? "BRL"]);
        }
      });
      total.trocados += 1;
      total.linhas += rubricas.size;
      feitos += 1;
      if (feitos % 500 === 0) console.log(`  gravados ${feitos}/${acumulado.size}  | banco +${(((await tamanhoDoBanco()) - inicial) / 1048576).toFixed(2)} MB`);
    }
  }
  total.fatias = dias.length;

  const final = await tamanhoDoBanco();
  console.log(`\n=== FIM ===`);
  console.log(`fatias: ${total.fatias} | pedidos trocados: ${total.trocados} | linhas gravadas: ${total.linhas}`);
  console.log(`sem decomposicao (agregado mantido): ${total.semDecomposicao} | dias sem resposta: ${total.semResposta}`);
  console.log(`pedidos sem rubrica na fonte (mantidos como estao): ${pendentes.size - acumulado.size}`);
  console.log(`banco: ${(inicial / 1048576).toFixed(1)} MB → ${(final / 1048576).toFixed(1)} MB (${((final - inicial) / 1048576).toFixed(2)} MB)`);

  const depois = await dbQuery(
    `SELECT f.fee_type, ROUND(SUM(f.amount)::numeric, 2)::text AS total, COUNT(*)::int AS linhas
       FROM workspace_channel_order_fees f
       JOIN workspace_channel_orders o
         ON o.workspace_id = f.workspace_id AND o.provider = f.provider
        AND o.connection_id = f.connection_id AND o.external_order_id = f.external_order_id
      WHERE f.workspace_id = $1 AND f.connection_id = $2 AND o.status <> 'cancelled'
        AND o.occurred_at >= now() - interval '30 days' AND f.fee_type IN (${SQL_TARIFAS_QUE_CUSTAM})
      GROUP BY 1 ORDER BY 2::numeric DESC`, [WS, CONN]);
  console.log("\ntarifa REAL de 30 dias, por rubrica:");
  for (const r of depois) console.log(`  ${r.fee_type.padEnd(14)} ${brl(r.total).padStart(13)}  (${r.linhas} linhas)`);
  });
}
process.exit(0);
