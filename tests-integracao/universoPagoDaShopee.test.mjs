import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { LOCAL_HOSTS } from "../scripts/migration-safety.mjs";

// ═══ O FATURAMENTO DA SHOPEE E O PEDIDO PAGO — PROVADO PELO POSTGRES ════════
//
// A decisao e da dona do produto, 02/09/2026, verbatim: *"vai aparecer o que
// realmente entrou como venda na api da shopee, boleto em algum momento
// entraria, mas e diferente da amazon"*.
//
// ⚠️ POR QUE ESTE ARQUIVO EXISTE ao lado de `tests/universoPagoDaShopee`: la a
// asserção olha o FONTE, e fonte nao prova comportamento — a familia inteira de
// testes decorativos deste projeto nasceu de casar simbolo em vez de medir
// efeito (AGENTS.md). O universo mora numa clausula SQL; so o banco responde se
// ela faz o que diz.
//
// ⚠️ E AS FRONTEIRAS SAO FABRICADAS DE PROPOSITO. No dado real de hoje os tres
// casos nao coexistem num mesmo dia, e um teste feito so com o que a conta tem
// ficaria verde com a regra errada dos dois lados — foi assim que a faixa de
// comissao nasceu como aliquota unica em 01/09. Aqui o mesmo dia tem UNPAID,
// pago e cancelado, e o UNPAID muda de status DEPOIS, sem que a data do pedido
// mude.
//
// COMO VER VERMELHO: troque, no produtor, o filtro do faturamento de
// `status = ANY($6::text[])` de volta para `status <> 'cancelled'`. O primeiro
// caso passa a somar 300 em vez de 200.

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error(
    "TEST_DATABASE_URL ausente: o teste do UNIVERSO PAGO DA SHOPEE nao rodou. Isto e FALHA, nao " +
    "ausencia de trabalho. Suba um Postgres descartavel, rode `node scripts/ci-preparar-banco.mjs` e repita.",
  );
}
if (!LOCAL_HOSTS.has(new URL(url).hostname)) {
  throw new Error(
    `BLOCKED: TEST_DATABASE_URL aponta para "${new URL(url).hostname}", que nao e descartavel. ` +
    "Este teste ESCREVE pedidos e itens.",
  );
}
if (url === process.env.DATABASE_URL) {
  throw new Error("BLOCKED: banco de teste e banco de aplicacao nao podem ser o mesmo.");
}

// O app inteiro le DATABASE_URL — apontamos para o descartavel ANTES de importar
// qualquer modulo que abra pool, e depois das tres travas acima.
process.env.DATABASE_URL = url;
const { runWithWorkspace } = await import("../src/lib/workspaceScope.ts");
const { getShopeeOverviewFromCanonical } = await import("../src/lib/integrations/shopeeOverviewCanonical.ts");

const WORKSPACE = "00000000-0000-4000-8000-000000005h0p";
const CONEXAO = "shopee:teste-universo";
const DIA = "2026-07-15T13:00:00.000Z";

const conexao = {
  id: CONEXAO, provider: "shopee", externalAccountId: "teste-universo", displayName: "Loja de teste",
  mode: "local", region: "BR", scopes: [], metadata: {}, status: "connected",
  connectedAt: DIA, updatedAt: DIA,
};
const periodo = {
  from: new Date("2026-07-01T03:00:00.000Z"),
  to: new Date("2026-07-31T23:59:59.000Z"),
  label: "Julho",
};

async function comCliente(fn) {
  const cliente = new pg.Client({ connectionString: url });
  await cliente.connect();
  try { return await fn(cliente); } finally { await cliente.end(); }
}

async function limpar(cliente) {
  for (const tabela of ["workspace_channel_order_items", "workspace_channel_orders"]) {
    await cliente.query(`DELETE FROM ${tabela} WHERE workspace_id = $1 AND connection_id = $2`, [WORKSPACE, CONEXAO]);
  }
  await cliente.query(
    `DELETE FROM workspace_marketplace_syncs WHERE workspace_id = $1 AND connection_id = $2`,
    [WORKSPACE, CONEXAO],
  );
}

/** Um pedido no MESMO dia dos outros — a data do pedido nunca muda depois. */
async function inserirPedido(cliente, id, status, providerStatus, bruto) {
  await cliente.query(
    `INSERT INTO workspace_channel_orders
       (workspace_id, provider, connection_id, external_order_id, occurred_at, status,
        provider_status, gross, currency, buyer_shipping, fulfillment)
     VALUES ($1, 'shopee', $2, $3, $4, $5, $6, $7, 'BRL', 0, 'platform')`,
    [WORKSPACE, CONEXAO, id, DIA, status, providerStatus, bruto],
  );
  await cliente.query(
    `INSERT INTO workspace_channel_order_items
       (workspace_id, provider, connection_id, external_order_id, line_no,
        external_product_id, sku, title, qty, unit_price)
     VALUES ($1, 'shopee', $2, $3, 1, 'P-1', 'SKU-1', 'Produto', 1, $4)`,
    [WORKSPACE, CONEXAO, id, bruto],
  );
}

const medir = () => runWithWorkspace(WORKSPACE, () =>
  getShopeeOverviewFromCanonical(conexao, periodo, { workspaceId: WORKSPACE }));

test("o faturamento da Shopee soma so o pago — os tres status no MESMO dia", async (t) => {
  await comCliente(async (cliente) => {
    await limpar(cliente);
    // A sincronizacao precisa existir: sem ela o produtor devolve null e o teste
    // ficaria verde por ausencia de dado, que e o pior verde que existe.
    await cliente.query(
      // target_* e cursor_* sao NOT NULL sem default: a tabela exige a janela
      // PEDIDA, nao so a coberta. Omiti-las fazia o teste falhar por defeito
      // DELE — vermelho por motivo que nao e o produto ensina a ignorar
      // vermelho (AGENTS.md), e foi assim que ele caiu na primeira execucao.
      `INSERT INTO workspace_marketplace_syncs
         (workspace_id, provider, connection_id, target_from, target_to,
          cursor_from, cursor_to, covered_from, covered_to, products_synced_at,
          products_total, active_products, products_complete)
       VALUES ($1, 'shopee', $2, $3, $4, $3, $4, $3, $4, $4, 1, 1, true)`,
      [WORKSPACE, CONEXAO, periodo.from.toISOString(), periodo.to.toISOString()],
    );

    await inserirPedido(cliente, "PAGO-1", "paid", "PROCESSED", 200);
    await inserirPedido(cliente, "UNPAID-1", "pending", "UNPAID", 100);
    await inserirPedido(cliente, "CANCEL-1", "cancelled", "CANCELLED", 50);

    await t.test("o dia misturado: paga 200, aguardando 100, cancelado 50", async () => {
      const ov = await medir();
      assert.ok(ov, "o produtor devolveu null — o cenario nao chegou a ser medido");
      assert.equal(ov.metrics.revenue30d, 200, "UNPAID e cancelado nao podem entrar no faturamento");
      assert.equal(ov.metrics.paidOrders, 1, "a contagem ao lado do valor conta o mesmo conjunto");
      assert.equal(ov.metrics.pendingOrders, 1);
      assert.equal(ov.metrics.pendingRevenue, 100, "o que saiu do faturamento tem de ficar visivel");
      assert.equal(ov.metrics.cancelledRevenue, 50);
    });

    await t.test("UNPAID que PAGA entra — e entra na data do PEDIDO", async () => {
      // O sync so troca o status; a data do pedido fica como estava. E o que faz
      // o pedido aparecer no periodo em que foi feito, nao no dia do pagamento.
      await cliente.query(
        `UPDATE workspace_channel_orders SET status = 'paid', provider_status = 'PROCESSED'
          WHERE workspace_id = $1 AND connection_id = $2 AND external_order_id = 'UNPAID-1'`,
        [WORKSPACE, CONEXAO],
      );
      const ov = await medir();
      assert.equal(ov.metrics.revenue30d, 300, "o pedido que pagou tem de entrar");
      assert.equal(ov.metrics.pendingRevenue, null, "nao sobrou pendente");
      const { rows } = await cliente.query(
        `SELECT occurred_at FROM workspace_channel_orders
          WHERE workspace_id = $1 AND connection_id = $2 AND external_order_id = 'UNPAID-1'`,
        [WORKSPACE, CONEXAO],
      );
      assert.equal(new Date(rows[0].occurred_at).toISOString(), DIA,
        "a data do pedido nao pode mudar quando o pagamento confirma");
    });

    await t.test("UNPAID que CANCELA nunca entra", async () => {
      await inserirPedido(cliente, "UNPAID-2", "pending", "UNPAID", 70);
      const antes = await medir();
      assert.equal(antes.metrics.revenue30d, 300, "enquanto aguarda, fica de fora");
      await cliente.query(
        `UPDATE workspace_channel_orders SET status = 'cancelled', provider_status = 'CANCELLED'
          WHERE workspace_id = $1 AND connection_id = $2 AND external_order_id = 'UNPAID-2'`,
        [WORKSPACE, CONEXAO],
      );
      const depois = await medir();
      assert.equal(depois.metrics.revenue30d, 300, "cancelou: nao entra nem por um instante");
      assert.equal(depois.metrics.pendingRevenue, null);
    });

    await limpar(cliente);
  });
});
