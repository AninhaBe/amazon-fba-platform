import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { LOCAL_HOSTS } from "../scripts/migration-safety.mjs";

// ⚠️ O UNIVERSO DO RESULTADO DA AMAZON — a spec e a planilha da vendedora.
//
// Defeito que este teste reprova (04/09/2026): a tela exibia **43,7% de margem**
// enquanto a planilha dela dava 13–20%. A equacao usava a receita de TODOS os
// pedidos (o agregado da Amazon, 21) contra a tarifa e o custo dos que o nosso
// banco conhece (17) — numerador de um universo, denominador de outro.
//
// 📌 E O CRITERIO DA RECEITA E DELA, corrigido no mesmo dia depois que ela
// refez a planilha: **pedido sem valor publicado NAO sai do resultado.** Ele tem
// preco de anuncio, custo e tarifa calculada; o que falta e so o numero oficial.
// Quem sai e o pedido SEM CUSTO CADASTRADO — cadastro e dela, e ja tem
// apontamento proprio na tela.
//
// ⚠️ OS TRES TIPOS CONVIVEM NO MESMO CENARIO de proposito. Com um so, a regra
// errada passa nos outros dois — foi assim que a faixa de comissao nasceu como
// aliquota unica em 01/09 e que a quebra do vigia de frete ficou verde hoje.

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error(
    "TEST_DATABASE_URL ausente: o teste do UNIVERSO DO RESULTADO nao rodou. Isto e FALHA, nao " +
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
const { runWithAccount } = await import("../src/lib/accountContext.ts");
const { getAmazonOverviewFromCanonical } = await import("../src/lib/integrations/amazonOverviewCanonical.ts");

const WORKSPACE = "00000000-0000-4000-8000-0000000a2001";
const SELLER = "TESTESELLER01";
const CONEXAO = `amazon:${SELLER}`;
const DIA = "2026-09-04";

async function comCliente(fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
// ⚠️ A LIMPEZA E POR CONEXAO, NAO POR WORKSPACE — e isso NAO e desleixo de
// escopo: e o oposto. Uma execucao que aborta no meio (assercao vermelha, que e
// o estado NORMAL de uma quebra) nao chega ao `limpar` do fim, e a sobra fica.
// Se o workspace do teste mudar depois disso, a MESMA conexao passa a existir em
// dois inquilinos e derruba `isolamentoEntreInquilinos` — que e uma guarda de
// verdade acusando sujeira de teste. Aconteceu em 04/09/2026.
// Vale so aqui porque o banco e descartavel e a conexao e exclusiva deste teste.
const limpar = async (c) => {
  for (const t of ["workspace_channel_order_fee_estimates", "workspace_channel_order_fees",
                   "workspace_channel_order_items", "workspace_channel_orders",
                   "workspace_marketplace_syncs"]) {
    await c.query(`DELETE FROM ${t} WHERE connection_id = $1`, [CONEXAO]);
  }
  await c.query(`DELETE FROM workspace_product_costs WHERE workspace_id=$1`, [WORKSPACE]);
};

/** Um pedido com item, tarifa estimada e (opcionalmente) valor publicado. */
async function pedido(c, { id, sku, preco, valorPublicado, tarifa }) {
  await c.query(
    `INSERT INTO workspace_channel_orders
       (workspace_id, provider, connection_id, external_order_id, occurred_at, status,
        provider_status, gross, ordered_gross, currency, buyer_shipping, fulfillment)
     VALUES ($1,'amazon',$2,$3,$4,'pending','Pending',$5,NULL,'BRL',0,'platform')`,
    [WORKSPACE, CONEXAO, id, `${DIA}T15:00:00Z`, valorPublicado],
  );
  await c.query(
    `INSERT INTO workspace_channel_order_items
       (workspace_id, provider, connection_id, external_order_id, line_no,
        external_product_id, sku, title, qty, unit_price)
     VALUES ($1,'amazon',$2,$3,1,$4,$5,'Produto',1,NULL)`,
    [WORKSPACE, CONEXAO, id, `ASIN-${sku}`, sku],
  );
  await c.query(
    `INSERT INTO workspace_channel_order_fee_estimates
       (workspace_id, provider, connection_id, external_order_id, line_no, fee_type,
        provider_fee_code, amount, currency, unit_price, qty, source)
     VALUES ($1,'amazon',$2,$3,1,'commission','tabela:Teste:10%',$4,'BRL',$5,1,'tabela')`,
    [WORKSPACE, CONEXAO, id, tarifa, preco],
  );
}

test("o resultado da Amazon cobre o universo que declara", async (t) => {
  await comCliente(async (c) => {
    await limpar(c);
    await c.query(
      `INSERT INTO workspace_marketplace_syncs
         (workspace_id, provider, connection_id, target_from, target_to, cursor_from, cursor_to, covered_from, covered_to)
       VALUES ($1,'amazon',$2,$3,$4,$3,$4,$3,$4)`,
      [WORKSPACE, CONEXAO, `${DIA}T03:00:00Z`, `${DIA}T23:59:00Z`],
    );
    // (1) PUBLICADO: a Amazon ja informou o valor.
    await pedido(c, { id: "PUBLICADO", sku: "SKU-A", preco: 100, valorPublicado: 100, tarifa: 10 });
    // (2) SEM VALOR PUBLICADO: entra pelo PRECO DE ANUNCIO (criterio dela).
    await pedido(c, { id: "SEM-VALOR", sku: "SKU-A", preco: 50, valorPublicado: null, tarifa: 5 });
    // (3) SEM CUSTO CADASTRADO: fica FORA do resultado e vira apontamento.
    await pedido(c, { id: "SEM-CUSTO", sku: "SKU-SEM", preco: 900, valorPublicado: 900, tarifa: 90 });
    await c.query(
      `INSERT INTO workspace_product_costs (workspace_id, id, sku, cost, updated_at, history)
       VALUES ($1,$2,'SKU-A',20, now(), '[{"cost":20,"from":"2020-01-01T00:00:00.000Z"}]'::jsonb)`,
      // ⚠️ O `id` E O PROPRIO SKU: `getCosts` chaveia o mapa por `id`, e o
      // produtor procura `costs[sku]`. Id diferente do SKU faz o custo nunca ser
      // encontrado — e o cenario inteiro passa a medir "sem custo".
      [WORKSPACE, "SKU-A"],
    );

    const ov = await runWithWorkspace(WORKSPACE, () => runWithAccount({ sellerId: SELLER, refreshToken: "x" }, () =>
      getAmazonOverviewFromCanonical(
        { startISO: `${DIA}T03:00:00.000Z`, endISO: `${DIA}T23:59:00.000Z`, days: 1, key: DIA, custom: false },
        { faturamentoDoPeriodo: 1050 },
      )));
    assert.ok(ov, "o produtor devolveu null — o cenario nao chegou a ser medido");
    const p = ov.profit;

    await t.test("🔴 o pedido SEM VALOR PUBLICADO entra pelo preco de anuncio", () => {
      // 100 (publicado) + 50 (preco de anuncio) = 150. Excluir o segundo — que
      // era a versao anterior desta correcao — daria 100 e jogaria fora venda
      // real: ele tem preco, custo e tarifa; so o numero OFICIAL falta.
      assert.equal(p.baseDoResultado, 150);
      assert.equal(p.pedidosCompletos, 2);
    });

    await t.test("🔴 o pedido SEM CUSTO fica FORA do resultado", () => {
      // Se entrasse, somaria 900 de receita e 0 de custo: o lucro subiria 810 de
      // uma vez. Custo e cadastro dela, e a tela ja aponta o que falta.
      assert.ok(p.baseDoResultado < 900, "pedido sem custo cadastrado nao pode entrar na base");
      assert.equal(p.unitsWithoutCost, 1);
    });

    await t.test("🔴 o lucro fecha na equacao do universo declarado", () => {
      // 150 − 15 de tarifa − 40 de custo = 95.
      assert.equal(p.estimatedProfit, 95);
    });

    await t.test("o FATURAMENTO segue sendo o do periodo inteiro", () => {
      // O card de Faturamento nao encolhe: quem muda de universo e o RESULTADO,
      // e a tela declara isso. Encolher a base foi o que ela mandou parar de
      // fazer em 29/08.
      assert.equal(p.revenueDoLucro, 1050);
    });

    await limpar(c);
  });
});
