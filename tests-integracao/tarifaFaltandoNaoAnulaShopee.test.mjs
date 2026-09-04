import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { LOCAL_HOSTS } from "../scripts/migration-safety.mjs";

// ⚠️ UMA VENDA SEM TARIFA NAO PODE ANULAR O AGREGADO DA SHOPEE.
//
// 🔴 DEFEITO MEDIDO EM 04/09/2026, print da vendedora (loja UTILEIRA, 15:33):
// Taxas em TRAVESSAO com a legenda "tarifa de 154 de 155 vendas", Resultado
// processado e Margem tambem em travessao. E em 7, 15 e 30 dias o MESMO estado:
// em 7 dias eram **2.276 de 2.277** — uma venda anulava a janela inteira.
//
// 📌 A venda era `26090574W7JU8Q`, R$ 59,90, com SEIS MINUTOS de idade. Medido
// no mesmo instante: em 7 dias havia exatamente UMA venda sem tarifa, e era
// essa. Nao e buraco de conciliacao — e o pedido recem-chegado cuja tarifa o
// proximo ciclo traz. Uma semana de agregado ficava muda por seis minutos.
//
// ⚠️ GARANTIA REPLICADA DA AMAZON, MECANISMO NAO (regra da dona do produto):
// la a lacuna e preenchida por tarifa calculada pela tabela, porque a Amazon
// publica tarde; aqui a Shopee entrega pela API na hora, entao NAO ha tabela
// nenhuma — a unica coisa que muda e parar de anular.

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error(
    "TEST_DATABASE_URL ausente: o teste da TARIFA FALTANDO NA SHOPEE nao rodou. Isto e FALHA, nao " +
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
const { getShopeeOverviewFromCanonical } = await import("../src/lib/integrations/shopeeOverviewCanonical.ts");

const WORKSPACE = "00000000-0000-4000-8000-00000000fee5";
const CONEXAO = "shopee:teste-tarifa-faltando";
const DIA = "2026-07-15T13:00:00.000Z";
const conexao = {
  id: CONEXAO, provider: "shopee", externalAccountId: "teste-tarifa", displayName: "Loja de teste",
  mode: "local", region: "BR", scopes: [], metadata: {}, status: "connected", connectedAt: DIA, updatedAt: DIA,
};
const periodo = { from: new Date("2026-07-01T03:00:00.000Z"), to: new Date("2026-07-31T23:59:59.000Z"), label: "Julho" };

async function comCliente(fn) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
// Limpeza por CONEXAO: execucao que aborta numa quebra nao chega ao fim, e a
// sobra derruba a guarda de isolamento entre inquilinos. Aconteceu hoje.
const limpar = async (c) => {
  for (const t of ["workspace_channel_order_fees", "workspace_channel_order_items",
                   "workspace_channel_orders", "workspace_marketplace_syncs"]) {
    await c.query(`DELETE FROM ${t} WHERE connection_id = $1`, [CONEXAO]);
  }
};

async function pedido(c, id, bruto, tarifa) {
  await c.query(
    `INSERT INTO workspace_channel_orders
       (workspace_id, provider, connection_id, external_order_id, occurred_at, status,
        provider_status, gross, currency, buyer_shipping, fulfillment)
     VALUES ($1,'shopee',$2,$3,$4,'paid','COMPLETED',$5,'BRL',0,'platform')`,
    [WORKSPACE, CONEXAO, id, DIA, bruto],
  );
  await c.query(
    `INSERT INTO workspace_channel_order_items
       (workspace_id, provider, connection_id, external_order_id, line_no,
        external_product_id, sku, title, qty, unit_price)
     VALUES ($1,'shopee',$2,$3,1,'P-1','SKU-1','Produto',1,$4)`,
    [WORKSPACE, CONEXAO, id, bruto],
  );
  if (tarifa != null) {
    await c.query(
      `INSERT INTO workspace_channel_order_fees
         (workspace_id, provider, connection_id, external_order_id, fee_type, provider_fee_code, amount, currency)
       VALUES ($1,'shopee',$2,$3,'commission','commission_fee',$4,'BRL')`,
      [WORKSPACE, CONEXAO, id, tarifa],
    );
    // ⚠️ A BANDEIRA E O QUE O PRODUTOR CONTA, nao a existencia da linha:
    // `orders_with_fees` filtra por `evidence_fees`. A primeira versao deste
    // teste inseria so a linha de tarifa e media 3 pedidos "sem tarifa" com as
    // tarifas somando certo — cenario que nao reproduz o que o sync grava nao
    // mede o produtor, mede outra coisa.
    await c.query(
      `UPDATE workspace_channel_orders SET evidence_fees = true
        WHERE workspace_id = $1 AND connection_id = $2 AND external_order_id = $3`,
      [WORKSPACE, CONEXAO, id],
    );
  }
}

const medir = () => runWithWorkspace(WORKSPACE, () =>
  getShopeeOverviewFromCanonical(conexao, periodo, { workspaceId: WORKSPACE }));

test("tarifa faltando em UMA venda", async (t) => {
  await comCliente(async (c) => {
    await limpar(c);
    await c.query(
      `INSERT INTO workspace_marketplace_syncs
         (workspace_id, provider, connection_id, target_from, target_to, cursor_from, cursor_to, covered_from, covered_to)
       VALUES ($1,'shopee',$2,$3,$4,$3,$4,$3,$4)`,
      [WORKSPACE, CONEXAO, periodo.from.toISOString(), periodo.to.toISOString()],
    );
    // ⚠️ OS DOIS LADOS DA FRONTEIRA NO MESMO CENARIO: duas vendas conciliadas e
    // UMA recem-chegada sem tarifa. Com so um tipo, a regra errada passa.
    await pedido(c, "COM-TARIFA-1", 100, 10);
    await pedido(c, "COM-TARIFA-2", 100, 10);
    await pedido(c, "SEM-TARIFA", 100, null);

    const ov = await medir();
    assert.ok(ov, "o produtor devolveu null — o cenario nao chegou a ser medido");
    const p = ov.profit;

    await t.test("🔴 Taxas soma as CONHECIDAS, nunca travessao", () => {
      assert.equal(p.fees, 20, "duas tarifas de 10 sao conhecidas; a terceira faltar nao apaga as duas");
    });

    await t.test("🔴 a falta vira APONTAMENTO COM NUMERO", () => {
      assert.equal(p.pedidosSemTarifa, 1);
      // A legenda da tela precisa do denominador para dizer "1 de 3".
      assert.equal(p.coverage.processedOrders, 3);
    });

    await t.test("🔴 Resultado e Margem existem — e sao um PAR", () => {
      // 300 de faturamento − 20 de tarifa − custo 0 − imposto 0 = 280.
      assert.equal(p.estimatedProfit, 280);
      assert.ok(p.marginPct != null, "margem sem lucro, ou lucro sem margem, e a pagina se contradizendo");
      assert.equal(Math.round(p.marginPct), 93);
    });

    // ⚠️ NAO ASSERTO `feesComplete` AQUI, e o motivo importa: ele e
    // `periodCovered && allKnown(...)`, entao pode ser falso pela COBERTURA DO
    // SYNC e nao pela tarifa. Medido ao escrever este teste: com as 3 vendas
    // conciliadas ele continuava falso, e a assercao anterior estava passando
    // pelo motivo errado. `pedidosSemTarifa` responde exatamente a pergunta
    // desta guarda, sem ambiguidade.

    await t.test("🔴 com TODAS conciliadas, nao sobra apontamento", () => {
      // O outro lado da fronteira: sem ele, "sempre aponta 1" passaria verde.
      return comCliente(async (c2) => {
        await c2.query(
          `INSERT INTO workspace_channel_order_fees
             (workspace_id, provider, connection_id, external_order_id, fee_type, provider_fee_code, amount, currency)
           VALUES ($1,'shopee',$2,'SEM-TARIFA','commission','commission_fee',10,'BRL')`,
          [WORKSPACE, CONEXAO],
        );
        await c2.query(
          `UPDATE workspace_channel_orders SET evidence_fees = true
            WHERE workspace_id = $1 AND connection_id = $2 AND external_order_id = 'SEM-TARIFA'`,
          [WORKSPACE, CONEXAO],
        );
        const ov2 = await medir();
        assert.equal(ov2.profit.pedidosSemTarifa, 0, "conciliadas todas, nao sobra o que apontar");
        assert.equal(ov2.profit.fees, 30);
        assert.equal(ov2.profit.estimatedProfit, 270);
      });
    });

    await limpar(c);
  });
});
