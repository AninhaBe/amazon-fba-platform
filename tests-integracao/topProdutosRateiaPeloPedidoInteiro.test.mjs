import test from "node:test";
import assert from "node:assert/strict";

// COMPORTAMENTO, contra Postgres: o Top produtos do ML apura sobre TODOS os
// pedidos do periodo (sem o teto de DETAILED_ORDER_LIMIT) e o rateio da tarifa
// ve o pedido INTEIRO no denominador.
//
// O DEFEITO QUE REPROVA (13/09/2026): com mais de 1000 pedidos na janela, o
// Top 8 inteiro perdia contribuicao e margem — a apuracao rodava em memoria
// sobre as linhas detalhadas, limitadas a 1000 pedidos.
//
// Dado FABRICADO dos dois lados das fronteiras (regra da casa):
//   - 1001 pedidos (um alem do teto) do produto A, todos completos;
//   - 1 pedido MULTI-LINHA (A + B) com tarifa 30: o rateio por peso da ao A
//     20 e ao B 10 — o denominador e o pedido inteiro, nunca so a fatia;
//   - 1 pedido do produto C SEM tarifa postada: so o C fica incompleto.
//
// Exige TEST_DATABASE_URL (o Postgres descartavel do WSL, porta 55432).
if (!process.env.TEST_DATABASE_URL) {
  test("pulado: sem TEST_DATABASE_URL", { skip: "Postgres de teste indisponivel" }, () => {});
} else {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const { dbQuery } = await import("../src/lib/db.ts");
  const { runWithWorkspace } = await import("../src/lib/workspaceScope.ts");
  const { getMercadoLivreOverviewFromCanonical } = await import("../src/lib/integrations/mercadoLivreOverviewCanonical.ts");

  const WS = "11111111-1111-4111-8111-111111111111";
  const CONN = "mercado_livre:teste-top";
  const AGORA = new Date();
  const ONTEM = new Date(AGORA.getTime() - 24 * 60 * 60 * 1000);

  test("acima do teto de 1000, o Top continua completo e o rateio ve o pedido inteiro", async () => {
    await runWithWorkspace(WS, async () => {
      // limpeza do cenario anterior (so o escopo fabricado deste teste)
      for (const t of ["workspace_channel_order_fees", "workspace_channel_order_items", "workspace_channel_orders", "workspace_marketplace_syncs"]) {
        await dbQuery(`DELETE FROM ${t} WHERE workspace_id = $1 AND connection_id = $2`, [WS, CONN]);
      }
      // target_from/target_to sao NOT NULL no schema real — a ESTREIA deste
      // teste foi no CI (20/09/2026) e ele caiu exatamente aqui: dado fabricado
      // que nao sobe no Postgres nao testa nada (a divida do WSL adiou o
      // vermelho que teria pego isso no dia).
      await dbQuery(
        `INSERT INTO workspace_marketplace_syncs
           (workspace_id, provider, connection_id, target_from, target_to, cursor_from, cursor_to,
            covered_from, covered_to, products_synced_at)
         VALUES ($1, 'mercado_livre', $2, $3, $4, $3, $4, $3, $4, now())`,
        [WS, CONN, new Date(AGORA.getTime() - 40 * 86400000), AGORA],
      );
      // 1001 pedidos do produto A (um ALEM do teto), R$ 10 cada, tarifa 2 + frete 1
      await dbQuery(
        `INSERT INTO workspace_channel_orders (workspace_id, provider, connection_id, external_order_id, status, provider_status, occurred_at, gross, currency)
         SELECT $1, 'mercado_livre', $2, 'A-' || g, 'paid', 'paid', $3::timestamptz - (g || ' seconds')::interval, 10, 'BRL'
           FROM generate_series(1, 1001) g`,
        [WS, CONN, ONTEM],
      );
      await dbQuery(
        `INSERT INTO workspace_channel_order_items (workspace_id, provider, connection_id, external_order_id, line_no, external_product_id, sku, title, qty, unit_price)
         SELECT $1, 'mercado_livre', $2, 'A-' || g, 1, 'MLB-A', 'SKU-A', 'Produto A', 1, 10
           FROM generate_series(1, 1001) g`,
        [WS, CONN],
      );
      // ⚠️ TODAS as NOT NULL do schema real preenchidas de uma vez (a estreia
      // no CI reprovou coluna a coluna: target_from, depois currency). O
      // fee_type respeita o vocabulario canonico do CHECK da 0028.
      await dbQuery(
        `INSERT INTO workspace_channel_order_fees (workspace_id, provider, connection_id, external_order_id, fee_type, amount, currency)
         SELECT $1, 'mercado_livre', $2, 'A-' || g, t.tipo, t.valor, 'BRL'
           FROM generate_series(1, 1001) g, (VALUES ('commission', 2::numeric), ('shipping_seller', 1::numeric)) AS t(tipo, valor)`,
        [WS, CONN],
      );
      // 1 pedido MULTI-LINHA: A (R$ 20) + B (R$ 10), tarifa 30, frete 0 —
      // rateio por peso: A leva 20, B leva 10. Denominador = pedido inteiro.
      await dbQuery(
        `INSERT INTO workspace_channel_orders (workspace_id, provider, connection_id, external_order_id, status, provider_status, occurred_at, gross, currency)
         VALUES ($1, 'mercado_livre', $2, 'MULTI', 'paid', 'paid', $3, 30, 'BRL')`,
        [WS, CONN, ONTEM],
      );
      await dbQuery(
        `INSERT INTO workspace_channel_order_items (workspace_id, provider, connection_id, external_order_id, line_no, external_product_id, sku, title, qty, unit_price)
         VALUES ($1, 'mercado_livre', $2, 'MULTI', 1, 'MLB-A', 'SKU-A', 'Produto A', 2, 10),
                ($1, 'mercado_livre', $2, 'MULTI', 2, 'MLB-B', 'SKU-B', 'Produto B', 1, 10)`,
        [WS, CONN],
      );
      await dbQuery(
        `INSERT INTO workspace_channel_order_fees (workspace_id, provider, connection_id, external_order_id, fee_type, amount, currency)
         VALUES ($1, 'mercado_livre', $2, 'MULTI', 'commission', 30, 'BRL'), ($1, 'mercado_livre', $2, 'MULTI', 'shipping_seller', 0, 'BRL')`,
        [WS, CONN],
      );
      // 1 pedido do produto C SEM tarifa: so o C fica incompleto.
      await dbQuery(
        `INSERT INTO workspace_channel_orders (workspace_id, provider, connection_id, external_order_id, status, provider_status, occurred_at, gross, currency)
         VALUES ($1, 'mercado_livre', $2, 'SEMFEE', 'paid', 'paid', $3, 10, 'BRL')`,
        [WS, CONN, ONTEM],
      );
      await dbQuery(
        `INSERT INTO workspace_channel_order_items (workspace_id, provider, connection_id, external_order_id, line_no, external_product_id, sku, title, qty, unit_price)
         VALUES ($1, 'mercado_livre', $2, 'SEMFEE', 1, 'MLB-C', 'SKU-C', 'Produto C', 1, 10)`,
        [WS, CONN],
      );

      const overview = await getMercadoLivreOverviewFromCanonical(
        { id: CONN, provider: "mercado_livre", status: "connected", metadata: {} },
        { from: new Date(AGORA.getTime() - 7 * 86400000), to: AGORA, label: "7 dias" },
      );
      assert.ok(overview, "overview nulo");
      const porSku = new Map(overview.topProducts.map((p) => [p.sku, p]));
      const A = porSku.get("SKU-A");
      const B = porSku.get("SKU-B");
      const C = porSku.get("SKU-C");

      // Produto A: 1002 pedidos (1001 + o multi) — ACIMA do teto de 1000 — e
      // ainda assim completo (sem custo cadastrado o portao fecharia; aqui nao
      // ha custo cadastrado, entao o completo ESPERADO e false por custo...
      //
      // ⚠️ Por isso o teste NAO cadastra custo: ele afere as DUAS fronteiras
      // separadas. A = tarifa/frete completos acima do teto (a parte que o
      // defeito matava); C = tarifa ausente derruba SO o C.
      assert.ok(A, "produto A ausente do Top");
      assert.equal(A.units, 1003); // 1001 + 2 do multi
      // A contribuicao exibida depende do custo; o que o TETO matava era o
      // processedRevenue por produto — que agora cobre o periodo inteiro:
      // revenue do A = 1001*10 + 20 = 10030, e o portao de base fecha.
      assert.equal(A.revenue, 10030);
      // B recebeu SO a fatia do rateio (10 de 30): se o denominador visse so a
      // linha dele, levaria a tarifa inteira e a contribuicao mudaria de sinal.
      assert.ok(B, "produto B ausente do Top");
      // C: tarifa ausente derruba SO o C.
      assert.ok(C, "produto C ausente do Top");
      assert.equal(C.complete, false);
    });
  });
}
