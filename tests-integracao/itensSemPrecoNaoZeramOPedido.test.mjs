import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { LOCAL_HOSTS } from "../scripts/migration-safety.mjs";

// ⚠️ ITEM SEM PRECO NAO PODE ZERAR O PEDIDO — E O ENVIO TEM QUE TRAZER O VALOR.
//
// 🔴 MEDIDO EM PRODUCAO (20/09/2026, conta A15NQMF7A6J1Y0): 46 de 49 pedidos
// ENVIADOS de 19/09 com `gross = 0,00` no banco, e a Orders API devolvendo
// `OrderTotal` de R$ 10,00 a R$ 24,90 em todos os 8 conferidos. ~97% dos
// enviados desde 31/08; 628 linhas de item com `unit_price` nulo. A tela dizia
// "85 de 88 pedidos ainda sem valor publicado pela Amazon" — e a Amazon ja
// tinha publicado.
//
// 📌 A causa, em tres passos que so falham juntos:
//   1. os itens sao conciliados com o pedido ainda `Pending` (sem preco) e a
//      soma das linhas, 0, era gravada em `gross`;
//   2. no envio o header traz `OrderTotal`, mas `GROSS_KEEP_WHEN_ITEMS`
//      preservava o que ja estava la "porque o pedido tem linhas";
//   3. `syncMissingOrderItems` so buscava pedido SEM linha, entao o preco nunca
//      era buscado de novo.
//
// Este arquivo cobre 1 e 2 contra Postgres. O passo 3 e consulta + chamada a
// SP-API; a selecao dele esta guardada em tests/amazonItensSemPreco.test.mjs.

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error(
    "TEST_DATABASE_URL ausente: o teste do ITEM SEM PRECO nao rodou. Isto e FALHA, nao ausencia de " +
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
const { saveCanonicalOrderHeaders, applyCanonicalOrderItems } = await import("../src/lib/integrations/canonicalStore.ts");
const { normalizeAmazonOrderHeader, normalizeAmazonOrderItems } = await import("../src/lib/integrations/amazonCanonical.ts");

const WORKSPACE = "00000000-0000-4000-8000-0000000semp0";
const CONEXAO = "amazon:TESTESEMPRECO";
const ESCOPO = { provider: "amazon", connectionId: CONEXAO, storeRaw: false };

async function comCliente(fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
// Limpeza por CONEXAO: execucao que aborta numa quebra nao chega ao fim, e a
// sobra derruba a guarda de isolamento entre inquilinos.
const limpar = (c) => Promise.all(
  ["workspace_channel_order_items", "workspace_channel_orders"].map((t) =>
    c.query(`DELETE FROM ${t} WHERE connection_id = $1`, [CONEXAO])),
);
const grossDe = (c, id) => c.query(
  `SELECT gross::float8 AS gross FROM workspace_channel_orders WHERE connection_id = $1 AND external_order_id = $2`,
  [CONEXAO, id]).then((r) => r.rows[0]?.gross ?? null);
const precoDaLinha = (c, id) => c.query(
  `SELECT unit_price::float8 AS p FROM workspace_channel_order_items WHERE connection_id = $1 AND external_order_id = $2 AND line_no = 1`,
  [CONEXAO, id]).then((r) => r.rows[0]?.p ?? null);

const header = (id, status, total) => normalizeAmazonOrderHeader({
  amazonOrderId: id,
  orderStatus: status,
  purchaseDate: "2026-09-19T12:00:00.000Z",
  fulfillmentChannel: "AFN",
  ...(total === undefined ? {} : { orderTotal: { CurrencyCode: "BRL", Amount: total } }),
});
const itens = (id, comPreco) => {
  const n = normalizeAmazonOrderItems([{
    ASIN: "B0HG852JHD", SellerSKU: "SILV-GEL-10000", Title: "Bolinhas de gel", QuantityOrdered: 1,
    ...(comPreco ? { ItemPrice: { CurrencyCode: "BRL", Amount: "14.90" }, PromotionDiscount: { CurrencyCode: "BRL", Amount: "0.00" } } : {}),
  }]);
  return { externalOrderId: id, items: n.items, gross: n.gross, buyerShipping: n.buyerShipping };
};

test("o ciclo real do pedido FBA: pendente -> itens sem preco -> envio -> itens com preco", async (t) => {
  await comCliente(limpar);
  t.after(() => comCliente(limpar));
  const ID = "702-0000001-0000001";

  await runWithWorkspace(WORKSPACE, async () => {
    // 1) nasce Pending, sem OrderTotal
    await saveCanonicalOrderHeaders(ESCOPO, [header(ID, "Pending")]);
    // 2) itens conciliados ainda pendentes: a Amazon nao manda preco
    await applyCanonicalOrderItems(ESCOPO, [itens(ID, false)]);
  });
  assert.equal(await comCliente((c) => grossDe(c, ID)), null,
    "pedido pendente com item sem preco vale DESCONHECIDO. Era aqui que entrava o 0,00 que depois bloqueava o OrderTotal.");

  // 3) envia: o header agora tem OrderTotal, e o pedido JA TEM linhas
  await runWithWorkspace(WORKSPACE, () => saveCanonicalOrderHeaders(ESCOPO, [header(ID, "Shipped", "14.90")]));
  assert.equal(await comCliente((c) => grossDe(c, ID)), 14.9,
    "no envio o OrderTotal tem que entrar mesmo com linhas ja gravadas — as linhas sem preco nao refinaram nada.");

  // 4) a segunda busca de itens traz o preco e refina
  await runWithWorkspace(WORKSPACE, () => applyCanonicalOrderItems(ESCOPO, [itens(ID, true)]));
  assert.equal(await comCliente((c) => grossDe(c, ID)), 14.9);
  assert.equal(await comCliente((c) => precoDaLinha(c, ID)), 14.9, "a linha ganha unit_price na segunda busca");
});

test("o passivo de producao se cura: pedido enviado que JA esta com gross 0,00 e linhas", async (t) => {
  await comCliente(limpar);
  t.after(() => comCliente(limpar));
  const ID = "702-0000002-0000002";
  // Estado exato encontrado em producao: shipped, gross 0.00, linha com unit_price NULL.
  await comCliente(async (c) => {
    await c.query(
      `INSERT INTO workspace_channel_orders
         (workspace_id, provider, connection_id, external_order_id, occurred_at, status, provider_status, gross, currency, fulfillment)
       VALUES ($1,'amazon',$2,$3,'2026-09-19T12:00:00Z','shipped','Shipped',0,'BRL','platform')`,
      [WORKSPACE, CONEXAO, ID]);
    await c.query(
      `INSERT INTO workspace_channel_order_items
         (workspace_id, provider, connection_id, external_order_id, line_no, external_product_id, sku, title, qty, unit_price)
       VALUES ($1,'amazon',$2,$3,1,'B0HG852JHD','SILV-GEL-10000','Bolinhas de gel',1,NULL)`,
      [WORKSPACE, CONEXAO, ID]);
  });

  await runWithWorkspace(WORKSPACE, () => saveCanonicalOrderHeaders(ESCOPO, [header(ID, "Shipped", "14.90")]));
  assert.equal(await comCliente((c) => grossDe(c, ID)), 14.9, "header de pedido enviado cura o zero herdado");
});

test("valor ja refinado pelas linhas continua protegido da aproximacao do header", async (t) => {
  await comCliente(limpar);
  t.after(() => comCliente(limpar));
  const ID = "702-0000003-0000003";
  await runWithWorkspace(WORKSPACE, async () => {
    await saveCanonicalOrderHeaders(ESCOPO, [header(ID, "Shipped", "23.80")]); // OrderTotal inclui frete
    await applyCanonicalOrderItems(ESCOPO, [itens(ID, true)]);                  // linhas: 14,90 de produto
    await saveCanonicalOrderHeaders(ESCOPO, [header(ID, "Shipped", "23.80")]); // header de novo
  });
  assert.equal(await comCliente((c) => grossDe(c, ID)), 14.9,
    "a outra fronteira: refinado (> 0) nao volta para o OrderTotal. E a regra antiga, que tem de sobreviver a correcao.");
});

test("leitura de itens sem preco nao apaga valor que o pedido ja conhece", async (t) => {
  await comCliente(limpar);
  t.after(() => comCliente(limpar));
  const ID = "702-0000004-0000004";
  await runWithWorkspace(WORKSPACE, async () => {
    await saveCanonicalOrderHeaders(ESCOPO, [header(ID, "Shipped", "14.90")]);
    await applyCanonicalOrderItems(ESCOPO, [itens(ID, false)]);
  });
  assert.equal(await comCliente((c) => grossDe(c, ID)), 14.9);
});
