import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { LOCAL_HOSTS } from "../scripts/migration-safety.mjs";

// ═══ O CONTRATO DE VOCABULÁRIO É EXIGIDO DO PRODUTOR, NÃO SÓ DECLARADO ══════
//
// QUAL DEFEITO ESTE ARQUIVO REPROVA, com o número real: a migration 0022 criou
// `workspace_channel_order_fee_estimates` com o propósito declarado de previsto e
// real compartilharem o MESMO vocabulário — era o defeito nº 1 que motivou a
// tabela. Poucas horas depois, medido em 01/09/2026:
//
//   1.532 linhas gravadas, TODAS com fee_type = 'other'.
//   Zero 'commission'. Zero 'fulfillment'.
//
// O schema estava certo e o dado voltou a não casar, porque o CHECK aceitava
// `other` como escape e o escape virou 100% das linhas.
//
// ⚠️ **SCHEMA CERTO NÃO GARANTE DADO CERTO.** A 0022 foi desenhada, revisada,
// aprovada e aplicada com verificação — e nada disso alcançava o produtor. É por
// isso que este teste existe: ele não confere o texto da migration, confere o que
// o BANCO faz quando alguém tenta gravar sem natureza.
//
// COMO VER VERMELHO: reponha `'other'` na lista do CHECK (migration 0026) e rode.
// O caso "recusa fee_type sem natureza" passa a aceitar a linha e reprova.

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error(
    "TEST_DATABASE_URL ausente: o teste do VOCABULARIO DA ESTIMATIVA nao rodou. Isto e FALHA, nao " +
    "ausencia de trabalho. Suba um Postgres descartavel, rode `node scripts/ci-preparar-banco.mjs` e repita.",
  );
}
if (!LOCAL_HOSTS.has(new URL(url).hostname)) {
  throw new Error(
    `BLOCKED: TEST_DATABASE_URL aponta para "${new URL(url).hostname}", que nao e descartavel. ` +
    "Este teste ESCREVE em workspace_channel_order_fee_estimates.",
  );
}

// Workspace sintetico: nao existe em lugar nenhum, e o teste apaga o que cria.
const WORKSPACE = "00000000-0000-4000-8000-00000000voc1".replace("voc", "0c0");
const CONEXAO = "amazon:teste-vocabulario";

async function comCliente(fn) {
  const cliente = new pg.Client({ connectionString: url });
  await cliente.connect();
  try {
    return await fn(cliente);
  } finally {
    await cliente.end();
  }
}

/** Insere uma estimativa com o `fee_type` pedido. Devolve o erro, se houver. */
async function tentarGravar(cliente, feeType) {
  try {
    await cliente.query(
      `INSERT INTO workspace_channel_order_fee_estimates
         (workspace_id, provider, connection_id, external_order_id, line_no,
          fee_type, provider_fee_code, amount, currency, unit_price, qty)
       VALUES ($1, 'amazon', $2, $3, 1, $4, 'TesteFee', 1.23, 'BRL', 10.00, 1)`,
      [WORKSPACE, CONEXAO, `pedido-${feeType}`, feeType],
    );
    return null;
  } catch (erro) {
    return erro;
  }
}

test("o vocabulario da estimativa e exigido pelo BANCO, nao pela disciplina de quem grava", async (t) => {
  await comCliente(async (cliente) => {
    await cliente.query(
      `DELETE FROM workspace_channel_order_fee_estimates WHERE workspace_id = $1`, [WORKSPACE],
    );

    await t.test("aceita a natureza canonica — commission e fulfillment", async () => {
      // Se estes forem recusados, o CHECK apertou demais e o produtor legítimo
      // para de gravar. O teste protege os dois lados.
      assert.equal(await tentarGravar(cliente, "commission"), null);
      assert.equal(await tentarGravar(cliente, "fulfillment"), null);
    });

    await t.test("RECUSA fee_type sem natureza — era o escape que virou 100% das linhas", async () => {
      const erro = await tentarGravar(cliente, "other");
      assert.ok(erro, "gravar 'other' tinha de falhar: 1.532 linhas reais foram gravadas assim");
      assert.match(String(erro.message), /vocabulario_canonico|check/i);
    });

    await t.test("RECUSA a procedencia no lugar da natureza", async () => {
      // 'estimated' é procedência, não natureza. Foi exatamente esse embaralho
      // que a 0022 existiu para desfazer; deixá-lo entrar aqui recriaria o
      // defeito dentro da tabela que o consertou.
      assert.ok(await tentarGravar(cliente, "estimated"));
      assert.ok(await tentarGravar(cliente, "refund"));
    });

    await cliente.query(
      `DELETE FROM workspace_channel_order_fee_estimates WHERE workspace_id = $1`, [WORKSPACE],
    );
  });
});
