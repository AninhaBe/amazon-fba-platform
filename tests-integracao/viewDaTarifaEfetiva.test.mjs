import test from "node:test";
import assert from "node:assert/strict";
import { LOCAL_HOSTS } from "../scripts/migration-safety.mjs";

// ═══ A VIEW DA 0022: O REAL GANHA DO ESTIMADO, E ISSO PRECISA SER MEDIDO ════
//
// Requisito escrito pelo Delta junto da migration `0022_previsto_e_real_convivendo`,
// e a razao dele para NAO escrever este teste e a certa: ele nao podia provar
// comportamento porque nao ha Postgres na maquina dele. Assercao sobre o texto do
// `.sql` — "a view contem NOT EXISTS" — nao prova nada: um `NOT EXISTS` com a
// coluna errada, um join que reabre a linha, um UNION que soma duas vezes, tudo
// isso passa por uma assercao textual e quebra em producao. Aqui quem responde e
// o Postgres.
//
// O QUE A ADR-027 PROMETE E ESTE ARQUIVO COBRA:
//   - toda venda nasce com tarifa calculada (estimativa entra na leitura);
//   - quando a OFICIAL chega, ela SUBSTITUI — uma linha, basis 'actual';
//   - a estimativa NUNCA e apagada: e ela que permite medir a pontaria.
//
// E a substituicao e a razao de existir da decisao: medido no Gestor Seller em
// 31/08/2026, o concorrente calcula a tarifa no minuto do pedido e NUNCA
// reconcilia — o pedido `702-9124025-9780207`, aprovado ha tres semanas, seguia
// com 12,01% de tabela. Se a Amazon cobrar diferente, o lucro dele fica errado
// para sempre. O nosso conserta aqui.

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error(
    "TEST_DATABASE_URL ausente: o teste da VIEW DA TARIFA EFETIVA nao rodou. Isto e FALHA, nao " +
    "ausencia de trabalho. Suba um Postgres descartavel, rode `node scripts/ci-preparar-banco.mjs` " +
    "e repita.",
  );
}
if (!LOCAL_HOSTS.has(new URL(url).hostname)) {
  throw new Error(
    `BLOCKED: TEST_DATABASE_URL aponta para "${new URL(url).hostname}", que nao e descartavel. ` +
    "Este teste ESCREVE tarifas e estimativas.",
  );
}
if (url === process.env.DATABASE_URL) {
  throw new Error("BLOCKED: banco de teste e banco de aplicacao nao podem ser o mesmo.");
}
process.env.DATABASE_URL = url;

const { dbQuery } = await import("../src/lib/db.ts");

const WS = "33333333-3333-4333-8333-333333333333";
const CONN = "amazon:VIEW-TESTE";

const real = (pedido, tipo, codigo, valor) => dbQuery(
  `INSERT INTO workspace_channel_order_fees
     (workspace_id, provider, connection_id, external_order_id, fee_type, provider_fee_code, amount, currency)
   VALUES ($1,'amazon',$2,$3,$4,$5,$6,'BRL')
   ON CONFLICT (workspace_id, provider, connection_id, external_order_id, fee_type, provider_fee_code)
     DO UPDATE SET amount = EXCLUDED.amount`,
  [WS, CONN, pedido, tipo, codigo, valor],
);

const estimada = (pedido, linha, tipo, codigo, valor) => dbQuery(
  `INSERT INTO workspace_channel_order_fee_estimates
     (workspace_id, provider, connection_id, external_order_id, line_no, fee_type, provider_fee_code,
      amount, currency, unit_price, qty)
   VALUES ($1,'amazon',$2,$3,$4,$5,$6,$7,'BRL',$8,1)
   ON CONFLICT (workspace_id, provider, connection_id, external_order_id, line_no, fee_type)
     DO UPDATE SET amount = EXCLUDED.amount`,
  [WS, CONN, pedido, linha, tipo, codigo, valor, 28.9],
);

const efetivas = (pedido) => dbQuery(
  `SELECT fee_type, amount::text, basis FROM workspace_channel_order_fees_efetivas
    WHERE workspace_id = $1 AND provider = 'amazon' AND connection_id = $2 AND external_order_id = $3
    ORDER BY fee_type`,
  [WS, CONN, pedido],
);

test("limpa o cenario", async () => {
  for (const tabela of ["workspace_channel_order_fees", "workspace_channel_order_fee_estimates"]) {
    await dbQuery(`DELETE FROM ${tabela} WHERE workspace_id = $1`, [WS]);
  }
  assert.deepEqual(await efetivas("P-1"), []);
});

test("so estimativa: a view devolve a estimativa, marcada como tal", async () => {
  await estimada("P-1", 1, "commission", "ReferralFee", 3.47);
  await estimada("P-1", 1, "fulfillment", "FBAFees", 5.65);
  const linhas = await efetivas("P-1");
  assert.deepEqual(linhas, [
    { fee_type: "commission", amount: "3.47", basis: "estimated" },
    { fee_type: "fulfillment", amount: "5.65", basis: "estimated" },
  ]);
});

test("🔑 estimada + real no MESMO pedido: UMA linha, e ela e 'actual'", async () => {
  // O requisito, textual, do Delta. Sem isto, a leitura soma as duas e o lucro
  // cai por um custo que nao existe — foi o defeito que a coluna `estimated`
  // tinha na tabela antiga e que a 0022 existe para tornar impossivel.
  await estimada("P-2", 1, "commission", "ReferralFee", 3.47);
  await real("P-2", "commission", "Commission", 3.10);
  const linhas = await efetivas("P-2");
  assert.equal(linhas.length, 1, `esperava UMA linha e vieram ${linhas.length}: ${JSON.stringify(linhas)}`);
  assert.deepEqual(linhas[0], { fee_type: "commission", amount: "3.10", basis: "actual" });
});

test("a estimativa CONTINUA na tabela depois de substituida — e ela mede a pontaria", async () => {
  const guardadas = await dbQuery(
    `SELECT amount::text FROM workspace_channel_order_fee_estimates
      WHERE workspace_id = $1 AND external_order_id = 'P-2' AND fee_type = 'commission'`,
    [WS],
  );
  assert.deepEqual(guardadas, [{ amount: "3.47" }], "a previsao foi apagada — a pontaria fica sem contra-prova");
});

test("⚠️ a substituicao e por PEDIDO, nao por tipo de tarifa", async () => {
  // COMPORTAMENTO MEDIDO, e ele nao e obvio: basta UMA tarifa real de qualquer
  // tipo da lista para TODAS as estimativas daquele pedido sairem da leitura.
  //
  // Isto e uma decisao com consequencia: se a Amazon postar so a comissao e
  // ainda nao a logistica, o pedido passa a exibir SO a comissao real — a
  // logistica estimada some, e o custo de canal fica MENOR do que era um
  // instante antes. O lucro sobe sozinho e volta a cair na liquidacao completa.
  //
  // Fica registrado aqui porque e o tipo de coisa que vira "o numero mudou
  // sozinho" na tela da vendedora. Se um dia doer, a correcao e tornar a
  // supersessao por (pedido, fee_type) — e este teste e que vai mudar de
  // intencao, com a anterior escrita.
  await estimada("P-3", 1, "commission", "ReferralFee", 3.47);
  await estimada("P-3", 1, "fulfillment", "FBAFees", 5.65);
  await real("P-3", "commission", "Commission", 3.10);
  const linhas = await efetivas("P-3");
  assert.deepEqual(linhas, [{ fee_type: "commission", amount: "3.10", basis: "actual" }]);
  assert.ok(
    !linhas.some((l) => l.fee_type === "fulfillment"),
    "se a logistica estimada voltou a aparecer, a supersessao mudou de grao — releia a nota acima",
  );
});

test("o banco RECUSA gravar 'estimated' como natureza da tarifa", async () => {
  // A procedencia nao pode voltar a ocupar o lugar da natureza: era isso que
  // fazia previsto e real nao terem chave comum ('ReferralFee' virava 'other',
  // 'Commission' virava 'commission') e transformava a substituicao num
  // mapeamento a mao em JS.
  await assert.rejects(
    () => estimada("P-4", 1, "estimated", "ReferralFee", 1),
    /check|constraint/i,
  );
});

test("estimativa de um inquilino nao aparece na leitura de outro", async () => {
  // A view nao tem filtro de workspace dentro dela — quem filtra e quem le. Este
  // teste existe para que a view nunca vire a porta dos fundos do isolamento.
  const outro = "44444444-4444-4444-8444-444444444444";
  await dbQuery(
    `INSERT INTO workspace_channel_order_fee_estimates
       (workspace_id, provider, connection_id, external_order_id, line_no, fee_type, provider_fee_code,
        amount, currency, unit_price, qty)
     VALUES ($1,'amazon',$2,'P-1',1,'commission','ReferralFee',999,'BRL',999,1)
     ON CONFLICT DO NOTHING`,
    [outro, CONN],
  );
  const linhas = await efetivas("P-1");
  assert.ok(
    !linhas.some((l) => l.amount === "999.00"),
    "a estimativa do outro inquilino apareceu na leitura deste",
  );
  await dbQuery(`DELETE FROM workspace_channel_order_fee_estimates WHERE workspace_id = $1`, [outro]);
});

// ═══ VERMELHO CONFERIDO EM 31/08/2026 ═══════════════════════════════════════
//
// Trocado o `NOT EXISTS` da view por `EXISTS` (uma palavra), o teste da chave
// reprovou com DUAS linhas para o pedido P-2 — estimada e real somando, que e
// exatamente o defeito que a migration existe para impedir. View restaurada em
// seguida.
