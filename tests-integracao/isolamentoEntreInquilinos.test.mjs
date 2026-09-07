import test from "node:test";
import assert from "node:assert/strict";
import { LOCAL_HOSTS } from "../scripts/migration-safety.mjs";

// ═══ O PORTAO MAIS IMPORTANTE QUE TEMOS ANTES DE ENTRAR CLIENTE ═════════════
//
// ELE EXISTE PORQUE A ANA PERGUNTOU, em 31/08/2026:
//
//   "Isso tem que ser verificado com urgencia e dado o retorno pra gente.
//    Integracoes diferentes nao podem misturar dados umas com as outras.
//    NOSSOS FUTUROS CLIENTES NAO PODEM TER ESSE PROBLEMA. Confirma se isso
//    esta existindo ou nao retorna."
//
// A auditoria daquele dia respondeu NAO — medida, tabela por tabela, com a
// consulta ao lado de cada zero. Mas ela mediu o BANCO DE HOJE. Este arquivo
// mede o COMPORTAMENTO, que e outra pergunta: se alguem escrever amanha uma
// consulta sem `WHERE workspace_id`, o dado de um cliente aparece para outro?
//
// ⚠️ POR QUE O PORTAO QUE JA EXISTE NAO BASTA. `tests/workspaceIdNaoDependeDeLembranca`
// le TODO o SQL de `src/` e exige o filtro — prova que o WHERE esta ESCRITO.
// Nao prova que ele ACONTECE: um filtro escrito com a variavel errada, um join
// que reabre o escopo, uma view sem o filtro, tudo isso passa por ele. E a mesma
// familia de "casar a existencia de um simbolo nao prova comportamento nenhum"
// (AGENTS.md). Aqui a pergunta e respondida pelo Postgres, com dado dos dois
// inquilinos escrito lado a lado.
//
// VERMELHO CONFERIDO EM 31/08/2026, e a primeira tentativa NAO reprovou — o que
// ensinou mais que o teste em si. Ver a nota no fim do arquivo.

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error(
    "TEST_DATABASE_URL ausente: o teste de ISOLAMENTO ENTRE INQUILINOS nao rodou. Isto e FALHA, " +
    "nao ausencia de trabalho. Suba um Postgres descartavel, rode `node scripts/ci-preparar-banco.mjs` " +
    "e repita. Teste que se omite fica verde sem ter testado nada — e este responde a pergunta " +
    "'o dado de um cliente pode aparecer para outro?'.",
  );
}
if (!LOCAL_HOSTS.has(new URL(url).hostname)) {
  throw new Error(
    `BLOCKED: TEST_DATABASE_URL aponta para "${new URL(url).hostname}", que nao e descartavel. ` +
    "Este teste ESCREVE pedidos, itens, tarifas, custos e metricas de anuncio.",
  );
}
if (url === process.env.DATABASE_URL) {
  throw new Error("BLOCKED: banco de teste e banco de aplicacao nao podem ser o mesmo.");
}

// ⚠️ O APP INTEIRO LE `DATABASE_URL`. Apontamos para o banco descartavel ANTES
// de importar qualquer modulo que abra pool — e depois das tres travas acima,
// nunca antes: a ordem e o que impede este arquivo de escrever em producao.
process.env.DATABASE_URL = url;

const { dbQuery } = await import("../src/lib/db.ts");
const { runWithWorkspace } = await import("../src/lib/workspaceScope.ts");
const { runWithAccount } = await import("../src/lib/accountContext.ts");
const { getAmazonOverviewFromCanonical } = await import("../src/lib/integrations/amazonOverviewCanonical.ts");
const { getCosts } = await import("../src/lib/costStore.ts");
const { getIntegrations } = await import("../src/lib/integrations/integrationStore.ts");

// Dois inquilinos sinteticos. Ids que nao existem em lugar nenhum: se este teste
// um dia rodar contra um banco com dado real, ele nao encosta em ninguem.
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
// ⚠️ OS DOIS INQUILINOS COMPARTILHAM O MESMO connection_id E O MESMO
// external_order_id, DE PROPOSITO — e este e o ponto do arquivo.
//
// A primeira versao deste teste deu uma conexao diferente a cada inquilino, e
// com isso ficou VERDE mesmo depois de eu neutralizar o filtro de workspace:
// quem separava os dados era o `connection_id`, nao o `workspace_id`. O teste
// media a proteção errada e teria dado a sensacao de cobertura sem cobrir nada.
//
// O caso abaixo e o REAL: em producao os dois workspaces de demonstracao
// compartilham `amazon:demo` e os MESMOS ids de pedido (medido em 31/08/2026).
// Ali, a UNICA coisa que separa o dado de um inquilino do outro e o
// `workspace_id` — que e exatamente a garantia que a Ana perguntou se existe.
const LOJA_COMPARTILHADA = "LOJA-COMPARTILHADA";
const CONN_COMPARTILHADA = `amazon:${LOJA_COMPARTILHADA}`;
const CONN_A = CONN_COMPARTILHADA;
const CONN_B = CONN_COMPARTILHADA;
const PEDIDO_COMPARTILHADO = "PEDIDO-MESMO-ID";
const HOJE = new Date();
const ONTEM = new Date(Date.now() - 24 * 3600_000);

async function semear(workspace, connection, seller, valor, sku) {
  await dbQuery(
    `INSERT INTO workspace_marketplace_syncs
       (workspace_id, provider, connection_id, status, target_from, target_to,
        cursor_from, cursor_to, covered_from, covered_to, last_success_at, updated_at)
     VALUES ($1,'amazon',$2,'complete',$3,$4,$3,$4,$3,$4,now(),now())
     ON CONFLICT (workspace_id, provider, connection_id)
       DO UPDATE SET covered_from = EXCLUDED.covered_from, covered_to = EXCLUDED.covered_to`,
    [workspace, connection, new Date(Date.now() - 30 * 24 * 3600_000), new Date(Date.now() + 3600_000)],
  );
  await dbQuery(
    `INSERT INTO workspace_channel_orders
       (workspace_id, provider, connection_id, external_order_id, status, provider_status, occurred_at, gross, ordered_gross, currency, fulfillment, buyer_shipping)
     VALUES ($1,'amazon',$2,$3,'shipped','Shipped',$4,$5,$5,'BRL','platform',0)
     ON CONFLICT (workspace_id, provider, connection_id, external_order_id)
       -- ⚠️ occurred_at TAMBEM, e a falta dele era uma BOMBA-RELOGIO
       -- (diagnosticada em 07/09/2026). O upsert renovava so o gross, entao a
       -- data da PRIMEIRA semeadura ficava para sempre — enquanto o periodo do
       -- teste e "os ultimos 7 dias", que anda com o relogio.
       --
       -- Resultado: o teste passava por 7 dias depois de o banco ser criado e
       -- falhava para sempre a partir dali, com revenueProcessed = 0. Medido:
       -- num banco antigo o pedido estava em 31/08 03:03 e a janela comecava
       -- em 31/08 13:45 — ONZE HORAS fora; num banco recriado no dia anterior,
       -- passava. Parecia residuo, parecia commit de outro agente, e nao era
       -- nenhum dos dois: era a fixture envelhecendo.
       --
       -- 📌 Guarda de ISOLAMENTO que falha por idade e pior que guarda nenhuma:
       -- ela ensina a suite a ser ignorada justamente onde o vermelho deveria
       -- parar tudo.
       DO UPDATE SET gross = EXCLUDED.gross, occurred_at = EXCLUDED.occurred_at`,
    [workspace, connection, PEDIDO_COMPARTILHADO, ONTEM, valor],
  );
  await dbQuery(
    `INSERT INTO workspace_channel_order_items
       (workspace_id, provider, connection_id, external_order_id, line_no, external_product_id, sku, title, qty, unit_price)
     VALUES ($1,'amazon',$2,$3,1,$4,$5,$6,1,$7)
     ON CONFLICT (workspace_id, provider, connection_id, external_order_id, line_no) DO UPDATE SET unit_price = EXCLUDED.unit_price`,
    [workspace, connection, PEDIDO_COMPARTILHADO, `ASIN-${seller}`, sku, `Produto ${seller}`, valor],
  );
  await dbQuery(
    `INSERT INTO workspace_channel_order_fees
       (workspace_id, provider, connection_id, external_order_id, fee_type, provider_fee_code, amount, currency)
     VALUES ($1,'amazon',$2,$3,'commission','Commission',$4,'BRL')
     ON CONFLICT (workspace_id, provider, connection_id, external_order_id, fee_type, provider_fee_code) DO UPDATE SET amount = EXCLUDED.amount`,
    [workspace, connection, PEDIDO_COMPARTILHADO, +(valor * 0.1).toFixed(2)],
  );
  await dbQuery(
    `INSERT INTO workspace_product_costs (workspace_id, id, sku, asin, title, cost, updated_at, history)
     VALUES ($1,$2,$2,$3,$4,$5,now(),$6::jsonb)
     ON CONFLICT (workspace_id, id) DO UPDATE SET cost = EXCLUDED.cost`,
    [workspace, sku, `ASIN-${seller}`, `Produto ${seller}`, 1, JSON.stringify([{ cost: 1, from: "2020-01-01T00:00:00.000Z" }])],
  );
  await dbQuery(
    `INSERT INTO workspace_ad_metrics (workspace_id, provider, connection_id, day, campaign_id, campaign_name, impressions, clicks, cost, purchases, sales, currency, synced_at)
     VALUES ($1,'amazon',$2,$3,$4,$5,1,1,$6,0,0,'BRL',now())
     ON CONFLICT (workspace_id, provider, connection_id, day, campaign_id) DO UPDATE SET cost = EXCLUDED.cost`,
    [workspace, connection, HOJE.toISOString().slice(0, 10), `CAMPANHA-${seller}`, `Campanha ${seller}`, valor],
  );
  await dbQuery(
    `INSERT INTO workspace_integrations (workspace_id, id, provider, external_account_id, display_name, mode, region, scopes, status, connected_at, updated_at, metadata)
     VALUES ($1,$2,'amazon',$3,$4,'local','BR','[]'::jsonb,'connected',now(),now(),'{}'::jsonb)
     ON CONFLICT (workspace_id, id) DO UPDATE SET status = EXCLUDED.status, external_account_id = EXCLUDED.external_account_id`,
    [workspace, connection, LOJA_COMPARTILHADA, `Loja ${seller}`],
  );
}

// ⚠️ VALORES PROPOSITALMENTE INCONFUNDIVEIS. Se o isolamento falhar, o numero do
// inquilino B (999,00) aparece inteiro no total do A (10,00) — nao ha
// arredondamento nem coincidencia que explique.
const VALOR_A = 10;
const VALOR_B = 999;

const periodo = {
  startISO: new Date(Date.now() - 7 * 24 * 3600_000).toISOString(),
  endISO: new Date(Date.now() + 3600_000).toISOString(),
  days: 7,
  key: "isolamento",
  custom: false,
};

const comoInquilino = (workspace, seller, fn) =>
  runWithWorkspace(workspace, () => runWithAccount({ workspaceId: workspace, sellerId: seller }, fn));

test("prepara dois inquilinos com dado inconfundivel", async () => {
  await semear(A, CONN_A, "SELLER-A", VALOR_A, "SKU-DO-A");
  await semear(B, CONN_B, "SELLER-B", VALOR_B, "SKU-DO-B");
  const linhas = await dbQuery(
    `SELECT workspace_id::text w, SUM(gross)::text total FROM workspace_channel_orders
      WHERE workspace_id::text IN ($1,$2) GROUP BY 1 ORDER BY 1`, [A, B]);
  assert.equal(linhas.length, 2, "os dois inquilinos precisam existir para a pergunta fazer sentido");
});

test("o overview do inquilino A NUNCA alcanca o pedido do B", async () => {
  const overview = await comoInquilino(A, LOJA_COMPARTILHADA, () => getAmazonOverviewFromCanonical(periodo));
  assert.ok(overview, "o overview do A precisa existir");
  // O total do A e 10,00. Se o isolamento falhar, vira 1.009,00.
  assert.equal(overview.profit.revenueProcessed, VALOR_A);
  assert.ok(
    overview.profit.revenueProcessed < VALOR_B,
    `receita do A veio ${overview.profit.revenueProcessed} — o dado do B vazou`,
  );
  // E nenhum identificador do B pode aparecer em lugar nenhum do payload.
  const serializado = JSON.stringify(overview);
  for (const marca of ["ASIN-SELLER-B", "SKU-DO-B", "Produto SELLER-B"]) {
    assert.ok(!serializado.includes(marca), `"${marca}" apareceu no payload do inquilino A`);
  }
});

test("e o do B nunca alcanca o do A — a simetria importa", async () => {
  const overview = await comoInquilino(B, LOJA_COMPARTILHADA, () => getAmazonOverviewFromCanonical(periodo));
  assert.equal(overview.profit.revenueProcessed, VALOR_B);
  const serializado = JSON.stringify(overview);
  for (const marca of ["ASIN-SELLER-A", "SKU-DO-A", "Produto SELLER-A"]) {
    assert.ok(!serializado.includes(marca), `"${marca}" apareceu no payload do inquilino B`);
  }
});

test("o custo cadastrado de um inquilino nao vaza para o outro", async () => {
  const custosDeA = await comoInquilino(A, LOJA_COMPARTILHADA, () => getCosts());
  const idsDeA = Object.keys(custosDeA);
  assert.ok(idsDeA.includes("SKU-DO-A"), "o A precisa ver o proprio custo");
  assert.ok(!idsDeA.includes("SKU-DO-B"), "o custo do B apareceu para o A");
});

test("a lista de conexoes de um inquilino nao mostra a loja do outro", async () => {
  // ⚠️ Aqui o `id` da conexao e o MESMO nos dois inquilinos (ver a nota no topo),
  // entao comparar id nao prova nada. O que distingue e o dono: cada inquilino
  // registra o proprio `external_account_id`. Se o escopo falhar, o A ve DUAS
  // conexoes e uma delas e do vendedor B.
  const conexoes = await comoInquilino(A, LOJA_COMPARTILHADA, () => getIntegrations("amazon"));
  assert.equal(conexoes.length, 1, `o A deveria ver 1 conexao e viu ${conexoes.length}`);
  assert.equal(conexoes[0].displayName, "Loja SELLER-A");
  assert.ok(
    !conexoes.some((c) => c.displayName === "Loja SELLER-B"),
    "a loja do inquilino B apareceu para o A",
  );
});

test("ler sem inquilino autenticado FALHA, em vez de devolver tudo", async () => {
  // ⚠️ O MODO DE FALHA CERTO, e ele e o oposto do que a gente matou hoje: sem
  // escopo, `currentWorkspaceId()` LANCA. Se algum dia devolver um default,
  // uma leitura fora de contexto passa a ver o banco inteiro — falha silenciosa
  // no lugar exato onde ela custa mais caro.
  await assert.rejects(
    () => getAmazonOverviewFromCanonical(periodo),
    /Workspace autenticado ausente/,
  );
});

test("nenhum connection_id real vive em dois inquilinos", async () => {
  // A mesma consulta da auditoria de 31/08/2026, agora como portao permanente:
  // ela responde por orders, items, fees, produtos, syncs e as duas de anuncio.
  const linhas = await dbQuery(
    `WITH t AS (
       SELECT 'orders' tabela, connection_id, workspace_id::text w FROM workspace_channel_orders
       UNION ALL SELECT 'items', connection_id, workspace_id::text FROM workspace_channel_order_items
       UNION ALL SELECT 'fees', connection_id, workspace_id::text FROM workspace_channel_order_fees
       UNION ALL SELECT 'syncs', connection_id, workspace_id::text FROM workspace_marketplace_syncs
       UNION ALL SELECT 'ad_metrics', connection_id, workspace_id::text FROM workspace_ad_metrics)
     SELECT tabela, connection_id, COUNT(DISTINCT w)::int workspaces
       FROM t WHERE connection_id NOT LIKE '%:demo' AND connection_id <> 'amazon:LOJA-COMPARTILHADA'
      GROUP BY 1,2 HAVING COUNT(DISTINCT w) > 1`, []);
  assert.deepEqual(linhas, [], `connection_id em mais de um inquilino: ${JSON.stringify(linhas)}`);
});

// ═══ COMO ESTE ARQUIVO FOI VISTO VERMELHO, E O QUE A PRIMEIRA TENTATIVA ENSINOU
//
// ⚠️ NA PRIMEIRA VERSAO ELE FICOU VERDE COM O ISOLAMENTO QUEBRADO. Eu havia dado
// um `connection_id` DIFERENTE a cada inquilino; neutralizei os 13 filtros de
// `workspace_id` do `amazonOverviewCanonical.ts` e os sete testes seguiram
// passando — porque quem separava os dados era o `connection_id`, nao o
// `workspace_id`. O teste media a protecao errada e teria entregue sensacao de
// cobertura sem cobrir nada, que e o defeito que o AGENTS.md descreve.
//
// A correcao foi por os dois inquilinos na MESMA loja (mesmo `seller_id`, logo
// mesmo `connection_id`) e nos MESMOS ids de pedido — o caso real dos dois
// workspaces de demonstracao em producao, onde so o `workspace_id` separa.
//
// COM ISSO O VERMELHO APARECEU, e com o numero certo:
//   - filtros de `amazonOverviewCanonical.ts` neutralizados -> a receita do
//     inquilino A veio 2018 no lugar de 10 (o dado dos dois somado);
//   - filtro de `costStore.ts` neutralizado -> "o custo do B apareceu para o A";
//   - filtro de `integrationStore.ts` neutralizado -> a loja do B na lista do A.
// Todas as quebras desfeitas em seguida.
//
// 📌 A LICAO, para quem escrever o proximo teste de isolamento: monte o cenario
// em que o `workspace_id` e a UNICA coisa que separa. Se qualquer outra coluna
// distinguir os inquilinos, o teste passa a medir essa outra coluna.
