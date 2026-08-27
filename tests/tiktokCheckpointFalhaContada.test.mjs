import test from "node:test";
import assert from "node:assert/strict";
import "../scripts/ts-resolver.mjs";

const { processUnsettledPage } = await import("../src/lib/integrations/tiktokFinancialPipeline.ts");
const { TiktokFinancialAdapters, financialCheckpointBackoffMs, financialErrorCode } = await import(
  "../src/lib/integrations/tiktokFinancialLedger.ts"
);

// O congelamento de 13→26/08/2026: o checkpoint de statements ficou preso na
// janela 12→13/08 com page_number=0, rows 0/0 e `error_count` ZERADO, enquanto o
// cron renovava o lease a cada ciclo (fencing_token chegou a 3.070). A exceção
// subia entre `claimCheckpoint` e `advanceCheckpoint` e não passava por contador
// nenhum — as colunas error_count/last_error_code/last_error_at existiam desde a
// 0005 e nada nunca escrevia nelas.

const SCOPE = { workspaceId: "ws-teste", connectionId: "tiktok_shop:loja-teste" };
const WINDOW = { from: new Date("2026-08-12T00:00:00Z"), to: new Date("2026-08-13T00:00:00Z") };

/** Banco em memória que responde só o que o pipeline pergunta. */
function fakeDb(estadoInicial = {}) {
  const row = {
    cursor_token: null, page_number: 0, rows_seen: 0, rows_written: 0, cursor_hash_history: [],
    owner_token: null, fencing_token: 0, lease_until: null, completed_at: null,
    error_count: 0, last_error_code: null, last_error_at: null, ...estadoInicial,
  };
  const query = async (sql, params = []) => {
    if (sql.includes("financial_checkpoint_claim")) {
      const [, , , , , , ownerToken] = params;
      const livre = !row.lease_until || row.lease_until <= Date.now();
      if (row.completed_at || !livre) return [{ acquired: false, fencing_token: String(row.fencing_token), db_now: new Date() }];
      row.owner_token = ownerToken;
      row.fencing_token += 1;
      row.lease_until = Date.now() + 30_000;
      return [{ acquired: true, fencing_token: String(row.fencing_token), db_now: new Date() }];
    }
    if (sql.includes("financial_checkpoint_advance")) {
      const terminal = params[11];
      row.page_number = params[10];
      row.terminal_cursor = terminal;
      row.completed_at = terminal ? new Date() : null;
      row.rows_seen = params[12];
      row.rows_written = params[13];
      return [{ financial_checkpoint_advance: true }];
    }
    if (sql.startsWith("UPDATE") && sql.includes("error_count=error_count+1")) {
      const [, , , , , , ownerToken, fencingToken, code] = params;
      if (row.owner_token !== ownerToken || Number(row.fencing_token) !== Number(fencingToken)) return [];
      row.error_count += 1;
      row.last_error_code = code;
      row.last_error_at = new Date();
      row.lease_until = Date.now(); // lease devolvido
      return [];
    }
    if (sql.startsWith("UPDATE") && sql.includes("error_count=0")) {
      row.error_count = 0; row.last_error_code = null; row.last_error_at = null;
      return [];
    }
    if (sql.includes("SELECT error_count,last_error_at")) {
      return [{ error_count: row.error_count, last_error_at: row.last_error_at }];
    }
    if (sql.includes("FOR UPDATE")) {
      const [, , , , , , ownerToken, fencingToken] = params;
      if (row.owner_token !== ownerToken || Number(row.fencing_token) !== Number(fencingToken)) return [];
      return [{ ...row }];
    }
    if (sql.includes("SELECT cursor_token,page_number")) return [{ ...row }];
    return [];
  };
  return { row, db: { query, transaction: (work) => work(query) } };
}

const adapters = (unsettled) => ({ unsettled });
const paginaVazia = async () => ({ items: [], nextPageToken: null, rejected: 0, unknown: 0, diagnostics: [] });

test("exceção entre claim e advance é CONTADA e devolve o lease — nunca sucesso silencioso", async () => {
  const { row, db } = fakeDb();
  const explode = async () => { throw new Error("A TikTok Shop recusou a solicitação (code 36009004)."); };

  await assert.rejects(
    () => processUnsettledPage({ db, adapters: adapters(explode), scope: SCOPE, window: WINDOW, ownerToken: "dono-1" }),
    /36009004/,
    "a falha precisa continuar subindo — engolir viraria sucesso silencioso"
  );

  assert.equal(row.error_count, 1, "error_count tem que sair de zero");
  assert.equal(row.last_error_code, "TIKTOK_36009004");
  assert.ok(row.last_error_at instanceof Date);
  assert.equal(row.page_number, 0, "nada avançou");
  assert.equal(row.rows_written, 0);
  assert.ok(row.lease_until <= Date.now(), "o lease foi devolvido, não fica preso até expirar");
});

test("com falha recente o recurso NÃO é reivindicado de novo — fim do lease eterno sem progresso", async () => {
  const { row, db } = fakeDb({ error_count: 1, last_error_at: new Date() });
  const fencingAntes = row.fencing_token;

  const resultado = await processUnsettledPage({
    db, adapters: adapters(async () => { throw new Error("nao deveria ser chamado"); }),
    scope: SCOPE, window: WINDOW, ownerToken: "dono-2",
  });

  assert.equal(resultado.acquired, false);
  assert.equal(row.fencing_token, fencingAntes, "sem backoff, o cron subia o fencing_token a cada ciclo (3.070 vezes na conta real)");
  assert.equal(row.error_count, 1, "backoff não conta erro novo: ninguém tentou");
});

test("página que avança de verdade zera o histórico de falhas", async () => {
  const { row, db } = fakeDb({ error_count: 3, last_error_code: "TIKTOK_36009004", last_error_at: new Date(Date.now() - 60 * 60_000) });

  const resultado = await processUnsettledPage({ db, adapters: adapters(paginaVazia), scope: SCOPE, window: WINDOW, ownerToken: "dono-3" });

  assert.equal(resultado.acquired, true);
  assert.equal(resultado.terminal, true);
  assert.equal(row.error_count, 0);
  assert.equal(row.last_error_code, null);
});

test("backoff cresce e tem teto de 60 minutos", () => {
  assert.equal(financialCheckpointBackoffMs(0), 0);
  assert.equal(financialCheckpointBackoffMs(1), 60_000);
  assert.equal(financialCheckpointBackoffMs(2), 120_000);
  assert.equal(financialCheckpointBackoffMs(3), 240_000);
  assert.equal(financialCheckpointBackoffMs(99), 60 * 60_000);
});

test("last_error_code guarda o código, nunca o texto livre do erro", () => {
  assert.equal(financialErrorCode(new Error("A TikTok Shop recusou a solicitação (code 36009004).")), "TIKTOK_36009004");
  assert.equal(financialErrorCode(new Error("FINANCIAL_CHECKPOINT_FENCE_LOST")), "FINANCIAL_CHECKPOINT_FENCE_LOST");
  assert.equal(financialErrorCode(new Error("falhou no pedido 7672560861864609554 de fulano@exemplo.com")), "TIKTOK_7672560861864609554".slice(0, 64));
  // Foi assim que o 42883 do advance chegou: mensagem sem numero nenhum e o
  // SQLSTATE so em `.code`. Sem esta linha o campo dizia UNKNOWN_ERROR.
  assert.equal(
    financialErrorCode(Object.assign(new Error("function financial_checkpoint_advance(unknown, unknown) does not exist"), { code: "42883" })),
    "SQLSTATE_42883"
  );
  assert.equal(financialErrorCode(null), "UNKNOWN_ERROR");
  assert.ok(financialErrorCode(new Error("x".repeat(500))).length <= 64);
});

// ── Causa raiz: o 36009004 do endpoint de statement_transactions ────────────

test("statement_transactions manda sort_field=order_create_time (sem ele a API devolve 36009004)", async () => {
  let capturado = null;
  const adapters = new TiktokFinancialAdapters(async (path, options) => {
    capturado = { path, query: options.query };
    return { currency: "BRL", next_page_token: "", transactions: [] };
  });
  await adapters.transactions("7672560861864609554");
  assert.match(capturado.path, /\/finance\/202501\/statements\/7672560861864609554\/statement_transactions/);
  assert.equal(capturado.query.sort_field, "order_create_time", "medido em 26/08/2026: sem sort_field, com create_time e com statement_time a API responde 36009004");
});

test("moeda vem do envelope e a tarifa é fee_tax_amount — payload real de 26/08/2026", async () => {
  // Uma das 39 transações reais do statement 7672560861864609554. Repare:
  // NÃO existe `currency` na transação, e a tarifa é `fee_tax_amount`
  // (o parser lia `fee_and_tax_amount`, que era suposição e vinha sempre null).
  const adapters = new TiktokFinancialAdapters(async () => ({
    currency: "BRL",
    next_page_token: "",
    transactions: [{
      id: "tx-1", type: "ORDER", order_id: "pedido-1", order_create_time: 1786492800,
      revenue_amount: "64.90", fee_tax_amount: "-12.35", shipping_cost_amount: "-3.40", settlement_amount: "49.15",
    }],
  }));
  const pagina = await adapters.transactions("7672560861864609554");
  assert.equal(pagina.items.length, 1);
  assert.equal(pagina.items[0].currency, "BRL", "sem o fallback do envelope, requiredCurrency derrubava as 39 linhas");
  assert.equal(pagina.items[0].totals.feeAndTax, -12.35, "a maior despesa do pedido não pode virar null em silêncio");
  assert.equal(pagina.items[0].totals.revenue, 64.9);
  assert.equal(pagina.nextPageToken, null);
});

test("transação sem moeda em lugar nenhum continua falhando fechado", async () => {
  const adapters = new TiktokFinancialAdapters(async () => ({
    next_page_token: "",
    transactions: [{ id: "tx-1", type: "ORDER", order_create_time: 1786492800, revenue_amount: "10" }],
  }));
  await assert.rejects(() => adapters.transactions("s-1"), /moeda ISO/);
});

// ── A aridade do advance: o defeito que fazia NENHUM avanco acontecer ───────

test("o SQL do advance tem exatamente os parametros que a funcao da 0005 declara", async () => {
  const { readFile } = await import("node:fs/promises");
  const ledger = await readFile(new URL("../src/lib/integrations/tiktokFinancialLedger.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL("../migrations/0005_workspace_financial_ledger.sql", import.meta.url), "utf8");

  const chamada = ledger.slice(
    ledger.indexOf("SELECT financial_checkpoint_advance("),
    ledger.indexOf(" AS financial_checkpoint_advance")
  );
  const placeholders = new Set([...chamada.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));

  // O offset importa: existe `) RETURNS BOOLEAN` antes deste CREATE, e sem ele
  // a fatia sai vazia e o teste passa a medir zero parametro (falso negativo).
  const inicio = migration.indexOf("CREATE OR REPLACE FUNCTION financial_checkpoint_advance");
  const assinatura = migration.slice(inicio, migration.indexOf(") RETURNS BOOLEAN", inicio));
  const parametros = [...assinatura.matchAll(/\bp_\w+\s+[A-Z]/g)].length;

  // Pedia $1..$15 para uma funcao de 14 argumentos: o Postgres respondia 42883
  // ("function does not exist") e o advance nunca rodou desde a 0005.
  assert.equal(placeholders.size, parametros, `SQL manda ${placeholders.size} parametros e a funcao declara ${parametros}`);
  assert.equal(Math.max(...placeholders), parametros, "os placeholders precisam ser contiguos de $1 ate o ultimo argumento");
});
