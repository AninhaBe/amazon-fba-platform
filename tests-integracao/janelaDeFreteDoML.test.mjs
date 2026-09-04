import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { LOCAL_HOSTS } from "../scripts/migration-safety.mjs";

// ⚠️ A JANELA DE 30 DIAS DO FRETE DO ML, E O QUE A SEGURA.
//
// Defeito real que este teste reprova (04/09/2026, alerta de Disk IO Budget do
// Supabase): a conciliação de frete varria TODO pedido pago desde 23/07/2025 —
// 38.113 iterações de anti-join, 5,9 a 12,3 s por chamada, ~90 vezes por dia —
// e devolvia zero linhas. Eram 88 GB, 35% de todo o disco lido do banco.
//
// A correção é uma janela. E janela sem vigia troca IO por BURACO SILENCIOSO:
// envio antigo que faltasse sairia do alcance e ninguém saberia. Por isso as
// duas metades são testadas juntas, e as duas fronteiras são FABRICADAS:
//
//   pedido de 5 dias  sem envio -> caminho quente ACHA   (a janela não pode cegar o recente)
//   pedido de 60 dias sem envio -> caminho quente IGNORA, vigia CONTA
//
// 📌 É teste de integração porque o que está sendo medido é o SQL: as duas
// consultas se distinguem por um único predicado de data. Asserção sobre o
// texto do fonte casaria o predicado sem provar que ele filtra coisa alguma.

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error(
    "TEST_DATABASE_URL ausente: o teste da JANELA DE FRETE DO ML nao rodou. Isto e FALHA, nao " +
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
const {
  JANELA_DE_FRETE_DIAS,
  alarmeDeFreteForaDaJanela,
  contarFreteFaltandoNoHistorico,
  deveVarrerHistoricoCompleto,
  enviosFaltandoNaJanela,
} = await import("../src/lib/integrations/freteDoMercadoLivre.ts");

const WORKSPACE = "00000000-0000-4000-8000-0000000frete";
const CONEXAO = "mercado_livre:teste-janela-frete";

async function comCliente(fn) {
  const cliente = new pg.Client({ connectionString: url });
  await cliente.connect();
  try { return await fn(cliente); } finally { await cliente.end(); }
}
const limpar = async (cliente) => {
  for (const t of ["workspace_marketplace_shipments", "workspace_marketplace_orders"]) {
    await cliente.query(`DELETE FROM ${t} WHERE workspace_id = $1 AND connection_id = $2`, [WORKSPACE, CONEXAO]);
  }
};
const inserirPedido = (cliente, { id, diasAtras, envio, status = "paid" }) => cliente.query(
  `INSERT INTO workspace_marketplace_orders
     (workspace_id, provider, connection_id, external_order_id, status, occurred_at, payload, synced_at)
   VALUES ($1,'mercado_livre',$2,$3,$6, now() - ($4 || ' days')::interval, $5::jsonb, now())`,
  [WORKSPACE, CONEXAO, id, String(diasAtras), JSON.stringify({ shipping: { id: envio } }), status],
);

test("janela de frete do ML: recente entra no caminho quente, antigo so aparece para o vigia", async (t) => {
  await comCliente(async (cliente) => {
    await limpar(cliente);
    await inserirPedido(cliente, { id: "RECENTE", diasAtras: 5, envio: "ENV-RECENTE" });
    await inserirPedido(cliente, { id: "ANTIGO", diasAtras: 60, envio: "ENV-ANTIGO" });
    // ⚠️ DOIS antigos, e o segundo existe para EXERCITAR a regra.
    //
    // Com um só, o vigia contaria 1 — o MESMO número que a janela quente vê no
    // pedido recente — e a quebra "vigia usando a mesma janela do caminho
    // quente" passava VERDE. Medido em 04/09/2026 ao rodar as quebras: 3 de 4
    // ficaram vermelhas e essa não, porque o dado não distinguia as duas
    // consultas (AGENTS.md).
    await inserirPedido(cliente, { id: "ANTIGO-2", diasAtras: 45, envio: "ENV-ANTIGO-2" });
    // Conciliado: existe em shipments, então nenhuma das duas pode acusá-lo.
    await inserirPedido(cliente, { id: "JA-CONCILIADO", diasAtras: 90, envio: "ENV-OK" });
    await cliente.query(
      `INSERT INTO workspace_marketplace_shipments
         (workspace_id, provider, connection_id, external_shipment_id, payload, synced_at)
       VALUES ($1,'mercado_livre',$2,'ENV-OK','{}'::jsonb, now())`,
      [WORKSPACE, CONEXAO],
    );

    const quente = await runWithWorkspace(WORKSPACE, () => enviosFaltandoNaJanela(CONEXAO, 40));
    const historico = await runWithWorkspace(WORKSPACE, () => contarFreteFaltandoNoHistorico(CONEXAO));

    await t.test("🔴 o caminho quente NAO varre o historico inteiro", () => {
      // Sem a janela, o pedido de 60 dias voltaria aqui — e voltar é justamente
      // o custo de 88 GB que a correção existe para cortar.
      assert.deepEqual(quente.map((l) => l.shipment_id), ["ENV-RECENTE"]);
    });

    await t.test("a janela nao cega o recente", () => {
      assert.equal(quente[0].order_ids.includes("RECENTE"), true);
    });

    await t.test("🔴 o que a janela deixa de fora o VIGIA conta", () => {
      // Se a varredura diária for removida ou passar a usar a mesma janela do
      // caminho quente, isto vira 0 — e o buraco fica silencioso.
      assert.equal(historico, 2, "os dois envios fora da janela tem de ser contados pelo vigia");
    });

    await t.test("nenhuma das duas acusa envio ja conciliado", () => {
      assert.equal(quente.some((l) => l.shipment_id === "ENV-OK"), false);
      // ENV-OK tem 90 dias e está fora da janela: se o vigia o contasse, o
      // alarme tocaria todo dia por dado que está certo — alarme que sempre
      // toca é alarme que ninguém lê.
      assert.equal(historico, 2);
    });

    await limpar(cliente);
  });
});

test("o alarme do vigia", async (t) => {
  await t.test("🔴 nao toca quando nao falta nada", () => {
    assert.equal(alarmeDeFreteForaDaJanela(CONEXAO, 0), null);
  });
  await t.test("🔴 toca com o numero e a janela, nunca mudo", () => {
    const texto = alarmeDeFreteForaDaJanela(CONEXAO, 7);
    assert.ok(texto, "faltando 7 envios, o alarme nao pode ser null");
    assert.match(texto, /7 envio/);
    assert.match(texto, new RegExp(String(JANELA_DE_FRETE_DIAS)));
  });
});

test("cadencia da varredura completa", async (t) => {
  const DIA = 24 * 60 * 60_000;
  await t.test("nunca varreu neste processo: varre", () => {
    assert.equal(deveVarrerHistoricoCompleto(undefined, 1_000_000), true);
  });
  await t.test("🔴 varreu ha 1 hora: NAO varre de novo", () => {
    // Sem esta trava a varredura completa volta a rodar a cada passo do sync —
    // que é exatamente o defeito de 88 GB, com outro nome.
    assert.equal(deveVarrerHistoricoCompleto(10 * DIA, 10 * DIA + 3_600_000), false);
  });
  await t.test("passou o dia: varre", () => {
    assert.equal(deveVarrerHistoricoCompleto(10 * DIA, 11 * DIA), true);
  });
});
