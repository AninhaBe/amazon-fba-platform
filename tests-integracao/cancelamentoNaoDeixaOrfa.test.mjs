import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { LOCAL_HOSTS } from "../scripts/migration-safety.mjs";

// ⚠️ PEDIDO CANCELADO NAO PODE DEIXAR ESTIMATIVA VIVA PARA SEMPRE.
//
// 🔴 MEDIDO EM PRODUCAO (06/09/2026): 16 linhas de estimativa vivas em 8
// pedidos cancelados da Amazon, R$ 54,77, e **nenhuma jamais carimbada** — o
// contador de carimbadas em cancelado era ZERO. No dia anterior eram 8 linhas /
// R$ 25,85: acumula.
//
// 📌 A causa: `carimbarEstimativasSubstituidas` so carimbava quando existia
// tarifa REAL para o mesmo pedido e tipo — e a Amazon nunca cobra tarifa de
// pedido cancelado, entao a condicao nunca se satisfazia.
//
// ⚠️ E O QUE ESTE TESTE **NAO** AFIRMA: que a tela estava errada. Todo leitor de
// tarifa filtra status <> 'cancelled', e isso foi conferido. O defeito e a linha
// que nunca morre — divida que cresce e arma para o primeiro leitor que
// esquecer o filtro.

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error(
    "TEST_DATABASE_URL ausente: o teste do CANCELAMENTO nao rodou. Isto e FALHA, nao ausencia de " +
    "trabalho. Suba um Postgres descartavel e rode `node scripts/ci-preparar-banco.mjs`.",
  );
}
if (!LOCAL_HOSTS.has(new URL(url).hostname)) {
  throw new Error(`BLOCKED: TEST_DATABASE_URL aponta para "${new URL(url).hostname}", que nao e descartavel.`);
}
if (url === process.env.DATABASE_URL) {
  throw new Error("BLOCKED: banco de teste e banco de aplicacao nao podem ser o mesmo.");
}
process.env.DATABASE_URL = url;

const { runWithWorkspace } = await import("../src/lib/workspaceScope.ts");
const { carimbarEstimativasSubstituidas } = await import("../src/lib/integrations/amazonTarifaEstimada.ts");

const WORKSPACE = "00000000-0000-4000-8000-00000000canc";
const SELLER = "TESTECANCEL01";
const CONEXAO = `amazon:${SELLER}`;
const DIA = "2026-09-01T15:00:00.000Z";

async function comCliente(fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
// Limpeza por CONEXAO: execucao que aborta numa quebra nao chega ao fim, e a
// sobra derruba a guarda de isolamento entre inquilinos.
const limpar = async (c) => {
  for (const t of ["workspace_channel_order_fee_estimates", "workspace_channel_order_fees",
                   "workspace_channel_order_items", "workspace_channel_orders"]) {
    await c.query(`DELETE FROM ${t} WHERE connection_id = $1`, [CONEXAO]);
  }
};

async function pedido(c, id, status) {
  await c.query(
    `INSERT INTO workspace_channel_orders
       (workspace_id, provider, connection_id, external_order_id, occurred_at, status,
        provider_status, gross, currency, buyer_shipping, fulfillment)
     VALUES ($1,'amazon',$2,$3,$4,$5,$5,10,'BRL',0,'platform')`,
    [WORKSPACE, CONEXAO, id, DIA, status],
  );
  await c.query(
    `INSERT INTO workspace_channel_order_fee_estimates
       (workspace_id, provider, connection_id, external_order_id, line_no, fee_type,
        provider_fee_code, amount, currency, unit_price, qty, source)
     VALUES ($1,'amazon',$2,$3,1,'commission','tabela:Teste:10%',1.5,'BRL',10,1,'tabela')`,
    [WORKSPACE, CONEXAO, id],
  );
}

const vivas = (c, id) => c.query(
  `SELECT count(*)::int n FROM workspace_channel_order_fee_estimates
    WHERE connection_id = $1 AND external_order_id = $2 AND superseded_at IS NULL`,
  [CONEXAO, id]).then((r) => r.rows[0].n);

test("estimativa de pedido cancelado e carimbada", async (t) => {
  await comCliente(async (c) => {
    await limpar(c);
    // ⚠️ OS TRES CASOS NO MESMO CENARIO: com um so, a regra errada passa nos
    // outros dois. O pendente e o que prova que a correcao nao carimba demais.
    await pedido(c, "CANCELADO", "cancelled");
    await pedido(c, "PENDENTE", "pending");
    await pedido(c, "COM-TARIFA-REAL", "shipped");
    await c.query(
      `INSERT INTO workspace_channel_order_fees
         (workspace_id, provider, connection_id, external_order_id, fee_type, provider_fee_code, amount, currency)
       VALUES ($1,'amazon',$2,'COM-TARIFA-REAL','commission','ReferralFee',1.4,'BRL')`,
      [WORKSPACE, CONEXAO],
    );

    const carimbadas = await runWithWorkspace(WORKSPACE, () => carimbarEstimativasSubstituidas(CONEXAO));

    await t.test("🔴 o CANCELADO nao deixa estimativa viva", async () => {
      assert.equal(await vivas(c, "CANCELADO"), 0,
        "sem isto a linha vive para sempre — 16 delas ja existiam em producao");
    });

    await t.test("o que tem tarifa REAL continua sendo carimbado", async () => {
      assert.equal(await vivas(c, "COM-TARIFA-REAL"), 0);
    });

    await t.test("🔴 o PENDENTE continua VIVO — a correcao nao pode carimbar demais", async () => {
      // Se esta virasse 0, a tarifa calculada sumiria do pedido pendente, que e
      // exatamente a frente que a vendedora validou em 04/09.
      assert.equal(await vivas(c, "PENDENTE"), 1);
    });

    await t.test("o contador devolve quantas foram carimbadas", () => {
      assert.equal(carimbadas, 2, "cancelado + tarifa real; o pendente fica de fora");
    });

    await limpar(c);
  });
});
