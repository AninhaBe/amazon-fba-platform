import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { LOCAL_HOSTS } from "../scripts/migration-safety.mjs";

// VALORIZA O PENDENTE PELA NOSSA BASE, em tempo real, sem relatório nem Amazon
// (decisão da dona, 21/09/2026). O pedido sem valor recebe `ordered_gross` = o
// preço que o MESMO SKU já teve × qty, para entrar na conta de faturamento/lucro
// na hora. Este teste prova as três regras que o passo tem que respeitar:
//   1. pendente sem valor, com SKU conhecido → recebe o valor da nossa base;
//   2. valor real (gross) ou do relatório (ordered_gross) → NUNCA é sobrescrito;
//   3. SKU sem histórico de preço → fica nulo (não inventa).

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error(
    "TEST_DATABASE_URL ausente: o teste da VALORIZACAO PELA BASE nao rodou. Isto e FALHA, nao " +
    "ausencia de trabalho. Suba um Postgres descartavel e rode `node scripts/ci-preparar-banco.mjs`.",
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
const { valorizarPendentesPeloCatalogo } = await import("../src/lib/integrations/amazonSync.ts");

const WORKSPACE = "00000000-0000-4000-8000-0000000valor";
const CONEXAO = "amazon:TESTEVALOR";

async function comCliente(fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
const limpar = (c) => Promise.all(
  ["workspace_channel_order_items", "workspace_channel_orders"].map((t) =>
    c.query(`DELETE FROM ${t} WHERE connection_id = $1`, [CONEXAO])),
);

const pedido = (c, id, status, gross, orderedGross) => c.query(
  `INSERT INTO workspace_channel_orders
     (workspace_id, provider, connection_id, external_order_id, occurred_at, status, provider_status, gross, ordered_gross, currency, fulfillment)
   VALUES ($1,'amazon',$2,$3,'2026-09-21T12:00:00Z',$4,$4,$5,$6,'BRL','platform')`,
  [WORKSPACE, CONEXAO, id, status, gross, orderedGross]);
const item = (c, id, sku, qty, unitPrice) => c.query(
  `INSERT INTO workspace_channel_order_items
     (workspace_id, provider, connection_id, external_order_id, line_no, external_product_id, sku, title, qty, unit_price)
   VALUES ($1,'amazon',$2,$3,1,$4,$4,'t',$5,$6)`,
  [WORKSPACE, CONEXAO, id, sku, qty, unitPrice]);
const orderedGrossDe = (c, id) => c.query(
  `SELECT ordered_gross::float8 v, ordered_gross_source s FROM workspace_channel_orders WHERE connection_id=$1 AND external_order_id=$2`,
  [CONEXAO, id]).then((r) => r.rows[0]);

test("pendente sem valor recebe o valor da nossa base (preço do SKU × qty); real e relatório ficam intocados", async (t) => {
  await comCliente(limpar);
  t.after(() => comCliente(limpar));
  await comCliente(async (c) => {
    // Histórico: o SKU FOI-A já saiu a R$ 20,00 num pedido enviado (dá o preço).
    await pedido(c, "HIST-A", "shipped", 20.0, null);
    await item(c, "HIST-A", "FOI-A", 1, 20.0);
    // Pendente sem valor, 2 un do FOI-A → deve virar 2 × 20 = 40,00.
    await pedido(c, "PEND-1", "pending", null, null);
    await item(c, "PEND-1", "FOI-A", 2, null);
    // Pendente com SKU sem histórico de preço → fica nulo.
    await pedido(c, "PEND-2", "pending", null, null);
    await item(c, "PEND-2", "SEM-PRECO", 1, null);
    // Já tem valor do relatório → NÃO pode ser sobrescrito.
    await pedido(c, "PEND-3", "pending", null, 99.9);
    await item(c, "PEND-3", "FOI-A", 1, null);
    // Já tem gross real → intocado.
    await pedido(c, "ENV-1", "shipped", 15.0, null);
    await item(c, "ENV-1", "FOI-A", 1, null);
  });

  await runWithWorkspace(WORKSPACE, () => valorizarPendentesPeloCatalogo(CONEXAO));

  assert.deepEqual(await comCliente((c) => orderedGrossDe(c, "PEND-1")), { v: 40, s: "estimado" },
    "pendente sem valor tinha que receber 2×20 = 40 da nossa base, marcado estimado");
  assert.equal((await comCliente((c) => orderedGrossDe(c, "PEND-2"))).v, null,
    "SKU sem histórico de preço não pode inventar valor");
  assert.equal((await comCliente((c) => orderedGrossDe(c, "PEND-3"))).v, 99.9,
    "valor do relatório não pode ser sobrescrito pela estimativa");
  const env = await comCliente((c) => c.query(`SELECT ordered_gross FROM workspace_channel_orders WHERE connection_id=$1 AND external_order_id='ENV-1'`, [CONEXAO]));
  assert.equal(env.rows[0].ordered_gross, null, "pedido com gross real não é tocado (ordered_gross segue nulo)");
});
