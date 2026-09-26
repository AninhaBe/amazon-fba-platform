import test from "node:test";
import assert from "node:assert/strict";
import "../scripts/ts-resolver.mjs";

const { processFinalStatementTransactions, processUnsettledPage } = await import(
  "../src/lib/integrations/tiktokFinancialPipeline.ts"
);

// ⚠️ O DEFEITO QUE ESTE ARQUIVO REPROVA TRAVOU A CONCILIACAO DO PRIMEIRO CLIENTE
// REAL POR 14 DIAS — medido em 20/09/2026 e de novo em 26/09/2026.
//
// A conexao nasceu em 12/09 e a regra de estreia importa so o MES VIGENTE, entao
// ela nao tem pedido anterior a 01/09 e nunca vai ter. O extrato de 11/09 liquida
// pedidos criados antes disso, e `upsertLedger` recusa gravar transacao cujo
// pedido nao exista do nosso lado. Numeros reais:
//
//   janela travada 11→12/09, sempre a mesma
//   erros em `statements` .......... 176 (20/09) -> 299 (26/09)
//   transacoes gravadas ............ 59 -> 59
//   pedidos ........................ 1.863 -> 2.461
//
// 📌 A forma do numero era o diagnostico: PEDIDO CRESCE, TRANSACAO NAO. E as duas
// regras estavam CERTAS — o travamento nasceu do encontro delas, na fronteira
// entre a ingestao de pedido e o ledger financeiro.
//
// A decisao da dona do produto em 26/09 foi a opcao C (ADR-039): buscar o pedido
// que o extrato citou, em busca DIRIGIDA por id. Este arquivo reproduz o
// travamento e prova que o gancho o desfaz.

const SCOPE = { workspaceId: "ws-teste", connectionId: "tiktok_shop:loja-teste" };
const WINDOW = { from: new Date("2026-09-11T00:00:00Z"), to: new Date("2026-09-12T00:00:00Z") };
const EXTRATO = { id: "7683705670897518344", status: "PAID", currency: "BRL" };
/** O pedido que o extrato cita e a estreia nao trouxe: criado ANTES de 01/09. */
const PEDIDO_ANTIGO = "580000000000000001";

/** Uma transacao de extrato apontando para o pedido antigo. */
const transacaoDoExtrato = () => ({
  id: "tx-1",
  statementId: EXTRATO.id,
  orderId: PEDIDO_ANTIGO,
  adjustmentOrderId: null,
  type: "ORDER",
  occurredAt: Math.floor(new Date("2026-08-28T10:00:00Z").getTime() / 1000),
  currency: "BRL",
  totals: { revenue: 22.9, feeAndTax: 2.3, shippingCost: 0, settlement: 20.6 },
  raw: { id: "tx-1", order_id: PEDIDO_ANTIGO, type: "ORDER", currency: "BRL" },
});

/**
 * Banco em memoria. O que importa aqui: `pedidosConhecidos` comeca VAZIO, como a
 * conexao real, e so ganha o pedido quando alguem o ingere — que e exatamente o
 * que a busca dirigida faz.
 */
function fakeDb() {
  const row = {
    cursor_token: null, page_number: 0, rows_seen: 0, rows_written: 0, cursor_hash_history: [],
    owner_token: null, fencing_token: 0, lease_until: null, completed_at: null,
    error_count: 0, last_error_code: null, last_error_at: null, terminal_cursor: false,
  };
  const pedidosConhecidos = new Set();
  const ordem = [];

  const query = async (sql, params = []) => {
    if (sql.includes("financial_checkpoint_claim")) {
      const ownerToken = params[6];
      const livre = !row.lease_until || row.lease_until <= Date.now();
      if (row.completed_at || !livre) return [{ acquired: false, fencing_token: String(row.fencing_token), db_now: new Date() }];
      row.owner_token = ownerToken; row.fencing_token += 1; row.lease_until = Date.now() + 30_000;
      return [{ acquired: true, fencing_token: String(row.fencing_token), db_now: new Date() }];
    }
    if (sql.includes("financial_checkpoint_advance")) {
      row.page_number = params[10]; row.terminal_cursor = params[11];
      row.completed_at = params[11] ? new Date() : null;
      row.rows_seen = params[12]; row.rows_written = params[13];
      return [{ financial_checkpoint_advance: true }];
    }
    if (sql.startsWith("UPDATE") && sql.includes("error_count=error_count+1")) {
      row.error_count += 1; row.last_error_code = params[8]; row.last_error_at = new Date();
      row.lease_until = Date.now();
      return [];
    }
    if (sql.startsWith("UPDATE") && sql.includes("error_count=0")) {
      row.error_count = 0; row.last_error_code = null; return [];
    }
    if (sql.includes("SELECT error_count,last_error_at")) {
      return [{ error_count: row.error_count, last_error_at: row.last_error_at }];
    }
    if (sql.includes("FOR UPDATE")) {
      if (row.owner_token !== params[6] || Number(row.fencing_token) !== Number(params[7])) return [];
      return [{ ...row }];
    }
    if (sql.includes("SELECT cursor_token,page_number")) return [{ ...row }];
    // A consulta que o `upsertLedger` faz para associar dinheiro a pedido.
    if (sql.includes("SELECT external_order_id FROM workspace_channel_orders")) {
      const id = params[3];
      return pedidosConhecidos.has(id) ? [{ external_order_id: id }] : [];
    }
    if (sql.includes("INSERT INTO workspace_financial_transactions")) {
      ordem.push("grava-transacao");
      return [{ 1: 1 }];
    }
    return [];
  };
  // ⚠️ A TRANSACAO MARCA A PROPRIA FRONTEIRA, e isso nao e enfeite: a primeira
  // versao deste fake era `transaction: work => work(query)`, que roda inline —
  // e com ela a quebra "mover o `prepare` para DENTRO da transacao" ficou VERDE.
  // O teste lia certo em voz alta e nao distinguia dentro de fora. E a familia
  // "guarda esperta que erra a fronteira": o fake precisa ter a fronteira para
  // que a assercao possa falar dela.
  const transaction = async (work) => {
    ordem.push("abre-transacao");
    try { return await work(query); } finally { ordem.push("fecha-transacao"); }
  };
  return { row, pedidosConhecidos, ordem, db: { query, transaction } };
}

const adaptersComExtrato = () => ({
  transactions: async () => ({
    items: [transacaoDoExtrato()], nextPageToken: null, rejected: 0, unknown: 0, diagnostics: [],
  }),
});

test("🔴 SEM a busca dirigida, o extrato derruba a janela — o travamento de 26/09", async () => {
  const { row, db } = fakeDb();

  await assert.rejects(
    () => processFinalStatementTransactions({
      db, adapters: adaptersComExtrato(), scope: SCOPE, window: WINDOW,
      ownerToken: "dono-1", statement: EXTRATO,
    }),
    /TIKTOK_FINANCIAL_ORDER_ASSOCIATION_UNRESOLVED/,
    "sem o pedido, a recusa tem de continuar subindo — gravar dinheiro sem pedido seria pior"
  );

  assert.equal(row.rows_written, 0, "nada gravado");
  assert.equal(row.completed_at, null, "e a janela NAO completa — e assim que ela fica presa para sempre");

  // ⚠️ E AQUI VAI UM ACHADO QUE ESTE TESTE REVELOU, registrado para nao ser lido
  // como descuido: o contador de falhas do checkpoint NAO conta esta. Eu tinha
  // escrito `assert.equal(row.last_error_code, ...)` e ele veio `null`.
  //
  // O motivo esta em `runPage`: `return input.db.transaction(...)` NAO e
  // aguardado dentro do `try`, entao rejeicao vinda de DENTRO da transacao
  // escapa do `catch` que chama `recordCheckpointFailure`. Os 299 erros que
  // producao mostra em `statements` vem do laco (que e `await`ado); os que
  // estouram dentro da transacao do FILHO nao aparecem em lugar nenhum.
  //
  // 📌 E a familia "ausencia de escrita nao e ausencia de tentativa" dentro do
  // proprio contador. NAO consertei aqui: e defeito distinto do que esta leva
  // foi autorizada a mexer, e um `await` ali muda quem devolve o lease. Foi
  // reportado ao cerebro em 26/09/2026 com o conserto proposto.
  assert.equal(row.last_error_code, null,
    "hoje a falha de dentro da transacao NAO e contada — quando isso mudar, este " +
      "assert muda com ela, e a mudanca e a correcao, nao a quebra");
});

test("🔴 COM a busca dirigida, o pedido citado entra e a janela COMPLETA", async () => {
  const { row, pedidosConhecidos, db } = fakeDb();
  const buscados = [];

  const resultado = await processFinalStatementTransactions({
    db, adapters: adaptersComExtrato(), scope: SCOPE, window: WINDOW,
    ownerToken: "dono-1", statement: EXTRATO,
    // Faz o que a busca dirigida real faz: traz o pedido e o grava no canonico.
    garantirPedidosCitados: async (ids) => {
      buscados.push(...ids);
      for (const id of ids) pedidosConhecidos.add(id);
      return ids.length;
    },
  });

  assert.deepEqual(buscados, [PEDIDO_ANTIGO], "busca DIRIGIDA: so o id que o extrato citou");
  assert.equal(row.error_count, 0, "sem erro");
  assert.equal(row.rows_written, 1, "a transacao foi gravada — as 59 param de ser 59");
  assert.ok(row.completed_at instanceof Date, "a janela completa, e e isso que destrava a selecao");
  assert.equal(resultado.terminal, true);
});

test("🔴 a busca roda ANTES da escrita — rede dentro da transacao seria defeito novo", async () => {
  const { pedidosConhecidos, ordem, db } = fakeDb();

  await processFinalStatementTransactions({
    db, adapters: adaptersComExtrato(), scope: SCOPE, window: WINDOW,
    ownerToken: "dono-1", statement: EXTRATO,
    garantirPedidosCitados: async (ids) => {
      // ⚠️ A ORDEM E A GARANTIA. `write` roda dentro de `db.transaction`, e uma
      // chamada externa ali dentro manteria a transacao aberta pelo tempo da API
      // — trocar um travamento de conciliacao por um incidente de banco.
      ordem.push("busca-pedido");
      for (const id of ids) pedidosConhecidos.add(id);
      return ids.length;
    },
  });

  assert.deepEqual(ordem, ["busca-pedido", "abre-transacao", "grava-transacao", "fecha-transacao"],
    "a busca acontece ANTES de a transacao abrir — dentro dela, a chamada de rede " +
      "manteria a transacao aberta pelo tempo da API");
  assert.ok(ordem.indexOf("busca-pedido") < ordem.indexOf("abre-transacao"),
    "se a busca entrar depois do `abre-transacao`, esta guarda tem de ficar vermelha");
});

test("🔴 o gancho NAO vale para unsettled — custo sem defeito correspondente", async () => {
  // `unsettled` le pedidos que ja sao nossos e `payments` nao carrega order_id.
  // Ganchar os tres pagaria chamada extra por um defeito que eles nao tem.
  const { db } = fakeDb();
  let chamou = false;

  await processUnsettledPage({
    db, scope: SCOPE, window: WINDOW, ownerToken: "dono-1",
    adapters: { unsettled: async () => ({ items: [], nextPageToken: null, rejected: 0, unknown: 0, diagnostics: [] }) },
    garantirPedidosCitados: async () => { chamou = true; return 0; },
  });

  assert.equal(chamou, false, "so o processador do EXTRATO busca pedido");
});

test("🔴 sem o gancho configurado o pipeline segue funcionando", async () => {
  // O campo e opcional para que o pipeline continue testavel sem rede. O que
  // nao pode e a ausencia dele virar erro de execucao.
  const { row, db } = fakeDb();
  await processUnsettledPage({
    db, scope: SCOPE, window: WINDOW, ownerToken: "dono-1",
    adapters: { unsettled: async () => ({ items: [], nextPageToken: null, rejected: 0, unknown: 0, diagnostics: [] }) },
  });
  assert.equal(row.error_count, 0);
});

test("🔴 o scheduler financeiro REPASSA o gancho aos processadores", async () => {
  // ⚠️ Guarda de FIACAO, e ela existe porque a quebra revelou o buraco: eu tinha
  // testado o pipeline direto, injetando o gancho a mao. Com isso, apagar o
  // repasse no scheduler deixava tudo VERDE — o defeito voltava pelo caminho que
  // producao usa, que e justamente o que nenhum teste exercitava.
  const { runTiktokFinancialScheduler } = await import(
    "../src/lib/integrations/tiktokFinancialScheduler.ts"
  );
  const recebidos = [];
  const processadorFalso = async (input) => {
    recebidos.push(typeof input.garantirPedidosCitados);
    return { acquired: true, terminal: true, seen: 0, written: 0 };
  };

  await runTiktokFinancialScheduler({
    db: { query: async () => [], transaction: async (work) => work(async () => []) },
    adapters: {}, scope: SCOPE, window: WINDOW,
    deadline: Date.now() + 5_000, pageBudget: 1,
    garantirPedidosCitados: async () => 0,
    processors: [processadorFalso],
  });

  assert.deepEqual(recebidos, ["function"],
    "o processador tem de RECEBER o gancho; sem o repasse, producao volta a travar");
});

test("🔴 a busca dirigida so pede o que falta, e valida como a varredura", async () => {
  // ⚠️ GUARDA POR FONTE, e digo por que: `ingerirPedidosCitadosPeloExtrato` usa
  // `dbQuery` e `getTiktokOrderDetail` de modulo, sem injecao — nao da para
  // exercitar comportamento sem rede nem banco. Entao a assercao casa a CHAMADA
  // INTEIRA, nunca o identificador solto, que e a forma que este repo ja provou
  // ser a unica que nao fica verde por acidente.
  const { readFileSync } = await import("node:fs");
  const fonte = readFileSync(
    new URL("../src/lib/integrations/tiktokSync.ts", import.meta.url), "utf8"
  ).toString();

  assert.ok(
    fonte.includes("const faltantes = unicos.filter((id) => !jaTemos.has(id));"),
    "sem o filtro, a busca pede de novo pedido que ja temos — chamada paga por nada, " +
      "e some a razao de ela ser DIRIGIDA"
  );
  // ⚠️ CONTAGEM, E NAO `includes`, e a quebra e que ensinou: as MESMAS duas linhas
  // de validacao existem em `saveOrderWindow`, a varredura. Apagar as da busca
  // dirigida deixava a assercao VERDE, porque o texto continuava no arquivo pela
  // outra funcao. Contar prova "nos DOIS caminhos"; `includes` provava "em algum
  // lugar", que e a familia de "casar a existencia de um simbolo nao prova
  // comportamento nenhum".
  //
  // Sao DOIS caminhos que ingerem pedido: a varredura (`saveOrderWindow`) e a
  // busca dirigida. Caminho novo entra aqui e SOBE o numero no mesmo commit.
  const statusNovo = fonte.split("if (statusNovos.length) throw new TiktokUnmappedStatusError(statusNovos);").length - 1;
  const validaPedido = fonte.split("for (const pedido of pedidos) validateTiktokOrderForSync(pedido);").length - 1;
  assert.equal(statusNovo, 2,
    "os DOIS caminhos de ingestao recusam status desconhecido. Se voce ADICIONOU um " +
      "caminho, suba este numero; se ele CAIU, algum caminho passou a inventar canonico.");
  assert.equal(validaPedido, 2,
    "os DOIS caminhos validam o pedido antes de gravar — mesma regra, mesma fonte.");
  assert.ok(
    fonte.includes("await getTiktokOrderDetail(shop, lote)") &&
    fonte.includes("for (let i = 0; i < faltantes.length; i += ORDER_DETAIL_BATCH)"),
    "o lote e o mesmo da varredura — e o que mantem o custo dentro do limite medido"
  );
});
