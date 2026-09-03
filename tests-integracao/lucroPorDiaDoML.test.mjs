import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { LOCAL_HOSTS } from "../scripts/migration-safety.mjs";

// ⚠️ LUCRO POR DIA NO ML — e o teste é sobre a SEMÂNTICA DO ZERO.
//
// Dois silêncios diferentes, e dar zero aos dois seria mentir num deles:
//
//   dia SEM venda ............................. lucro `0`. É FATO.
//   dia COM venda, custo/tarifa desconhecidos . lucro `null`. É DESCONHECIDO.
//
// 📌 Numa série temporal a confusão é pior que numa tela estática: um zero no
// gráfico não parece ausência, parece **notícia ruim** — uma queda que não
// aconteceu. A tela desenha `null` como ausência de coluna.
//
// ⚠️ AS DUAS FRONTEIRAS SÃO FABRICADAS, e é isso que faz o teste valer. No dado
// real de uma conta saudável os dois casos não coexistem no mesmo recorte, e um
// teste feito só com o que a conta tem ficaria verde com a regra errada dos dois
// lados — foi assim que a faixa de comissão nasceu como alíquota única em 01/09.
//
// ⚠️ E É TESTE DE INTEGRAÇÃO, não de unidade: o produtor do ML não aceita
// consulta injetada (diferente do da Shopee), então a única forma honesta de
// medir é contra o Postgres. Mudar a assinatura do produtor só para testá-lo
// seria desenhar o código em volta do teste.

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error(
    "TEST_DATABASE_URL ausente: o teste do LUCRO POR DIA DO ML nao rodou. Isto e FALHA, nao " +
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
const { getMercadoLivreOverviewFromCanonical } = await import("../src/lib/integrations/mercadoLivreOverviewCanonical.ts");

const WORKSPACE = "00000000-0000-4000-8000-00000000ml01";
const CONEXAO = "mercado_livre:teste-lucro-dia";
const periodo = {
  from: new Date("2026-09-01T03:00:00.000Z"),
  to: new Date("2026-09-04T02:59:59.000Z"),
  label: "3 dias",
};
const conexao = {
  id: CONEXAO, provider: "mercado_livre", externalAccountId: "9", displayName: "Loja de teste",
  mode: "local", region: "BR", scopes: [], metadata: { taxRate: 10 },
  status: "connected", connectedAt: periodo.from.toISOString(), updatedAt: periodo.from.toISOString(),
};

async function comCliente(fn) {
  const cliente = new pg.Client({ connectionString: url });
  await cliente.connect();
  try { return await fn(cliente); } finally { await cliente.end(); }
}

async function limpar(cliente) {
  for (const t of ["workspace_channel_order_fees", "workspace_channel_order_items", "workspace_channel_orders"]) {
    await cliente.query(`DELETE FROM ${t} WHERE workspace_id = $1 AND connection_id = $2`, [WORKSPACE, CONEXAO]);
  }
  await cliente.query(`DELETE FROM workspace_marketplace_syncs WHERE workspace_id = $1 AND connection_id = $2`, [WORKSPACE, CONEXAO]);
  await cliente.query(`DELETE FROM workspace_product_costs WHERE workspace_id = $1 AND id LIKE $2`, [WORKSPACE, `mercado_livre:${CONEXAO}:%`]);
}

/** Um pedido pago, com item e (opcionalmente) tarifa. */
async function inserirDia(cliente, { id, quando, bruto, sku, tarifa, status = "paid" }) {
  await cliente.query(
    `INSERT INTO workspace_channel_orders
       (workspace_id, provider, connection_id, external_order_id, occurred_at, status,
        provider_status, gross, currency, buyer_shipping, fulfillment)
     VALUES ($1,'mercado_livre',$2,$3,$4,$6,$6,$5,'BRL',0,'platform')`,
    [WORKSPACE, CONEXAO, id, quando, bruto, status],
  );
  await cliente.query(
    `INSERT INTO workspace_channel_order_items
       (workspace_id, provider, connection_id, external_order_id, line_no,
        external_product_id, sku, title, qty, unit_price)
     VALUES ($1,'mercado_livre',$2,$3,1,$4,$5,'Produto',1,$6)`,
    [WORKSPACE, CONEXAO, id, `P-${sku}`, sku, bruto],
  );
  if (tarifa != null) {
    await cliente.query(
      `INSERT INTO workspace_channel_order_fees
         (workspace_id, provider, connection_id, external_order_id, fee_type, provider_fee_code, amount, currency)
       VALUES ($1,'mercado_livre',$2,$3,'commission','sale_fee',$4,'BRL')`,
      [WORKSPACE, CONEXAO, id, tarifa],
    );
  }
}

const medir = () => runWithWorkspace(WORKSPACE, () =>
  getMercadoLivreOverviewFromCanonical(conexao, periodo));

test("lucro por dia: 0 para dia sem venda, null para dia incompleto", async (t) => {
  await comCliente(async (cliente) => {
    await limpar(cliente);
    await cliente.query(
      `INSERT INTO workspace_marketplace_syncs
         (workspace_id, provider, connection_id, target_from, target_to, cursor_from, cursor_to,
          covered_from, covered_to, products_synced_at, products_total, active_products, products_complete)
       VALUES ($1,'mercado_livre',$2,$3,$4,$3,$4,$3,$4,$4,1,1,true)`,
      [WORKSPACE, CONEXAO, periodo.from.toISOString(), periodo.to.toISOString()],
    );
    // 01/09 — completo: tarifa registrada e custo cadastrado.
    await inserirDia(cliente, { id: "D1", quando: "2026-09-01T15:00:00Z", bruto: 100, sku: "COM-CUSTO", tarifa: 10 });
    await cliente.query(
      `INSERT INTO workspace_product_costs (workspace_id, id, sku, cost, updated_at, history)
       VALUES ($1,$2,'COM-CUSTO',30, now(), '[{"cost":30,"from":"2020-01-01T00:00:00.000Z"}]'::jsonb)`,
      [WORKSPACE, `mercado_livre:${CONEXAO}:sku:COM-CUSTO`],
    );
    // 02/09 — venda com unidade SEM custo cadastrado.
    await inserirDia(cliente, { id: "D2", quando: "2026-09-02T15:00:00Z", bruto: 200, sku: "SEM-CUSTO", tarifa: 20 });
    // ⚠️ 01/09 GANHA UMA CANCELADA, e ela existe para EXERCITAR o universo.
    //
    // Sem ela, o universo pago e o universo do faturamento coincidem no cenário
    // — e a quebra "trocar REVENUE_STATUSES por GROSS_STATUSES" passava VERDE.
    // Medido em 03/09/2026 ao rodar as quebras: 3 de 4 ficaram vermelhas e essa
    // não, porque o dado não exercitava a regra (AGENTS.md).
    //
    // A cancelada não tem tarifa: se ela entrasse na conta, o dia 01 passaria a
    // ter pedido sem tarifa e o lucro viraria `null` em vez de 50.
    await inserirDia(cliente, { id: "D1-CANCELADA", quando: "2026-09-01T16:00:00Z", bruto: 999, sku: "COM-CUSTO", tarifa: null, status: "cancelled" });
    // 03/09 — nada. O dia existe no calendário e não teve venda.

    const ov = await medir();
    assert.ok(ov, "o produtor devolveu null — o cenario nao chegou a ser medido");
    const dia = (d) => ov.dailySales.find((x) => x.date === d);

    await t.test("dia COMPLETO tem lucro numerico e a conta fecha", () => {
      // 100 − 10 de tarifa − 30 de custo − 10 de imposto (10%) = 50
      assert.equal(dia("2026-09-01").profit, 50);
    });

    await t.test("🔴 dia COM venda e custo desconhecido = null, nunca zero", () => {
      assert.equal(dia("2026-09-02").revenue, 200, "o faturamento do dia e conhecido");
      assert.equal(dia("2026-09-02").profit, null,
        "custo desconhecido = lucro desconhecido; zero desenharia uma queda que nao houve");
    });

    await t.test("dia SEM venda = 0, porque zero ali e FATO", () => {
      assert.equal(dia("2026-09-03").revenue, 0);
      assert.equal(dia("2026-09-03").profit, 0, "nao vendeu, nao lucrou");
    });

    await t.test("os tres casos convivem na MESMA serie", () => {
      // Com um caso so, a regra errada passaria nos outros dois.
      assert.deepEqual(
        ov.dailySales.map((d) => `${d.date.slice(8)}:${d.profit === null ? "null" : d.profit}`),
        ["01:50", "02:null", "03:0"],
      );
    });

    await limpar(cliente);
  });
});
