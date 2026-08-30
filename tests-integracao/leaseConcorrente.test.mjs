import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { LOCAL_HOSTS } from "../scripts/migration-safety.mjs";

// O TESTE QUE A SUÍTE COMUM NÃO CONSEGUE FAZER: concorrência de verdade.
//
// `tests/leaseParaAntesDeChamarOCanal.test.mjs` prova ESTRUTURA — a guarda
// existe, vem antes das chamadas, o SQL é o certo. Prova isso lendo o arquivo, e
// isso é tudo que dá para fazer sem banco.
//
// Aqui a pergunta é outra e só o Postgres responde: **dois workers disputando a
// mesma linha, um ganha, o outro recebe zero linhas e desiste.** Se a exclusão
// mútua do `UPDATE ... WHERE lease_until < now() RETURNING` não for real, é aqui
// que aparece — e em lugar nenhum antes da segunda máquina subir em produção.
//
// ⚠️ ELE NÃO PULA QUANDO NÃO HÁ BANCO. Teste que se omite sozinho fica verde sem
// ter testado nada: é sensação de cobertura sem cobertura, e o custo dela é
// descobrir no pior dia. Sem `TEST_DATABASE_URL` este arquivo FALHA e diz por quê.
//
// ⚠️ POR ISSO ELE VIVE FORA DE `tests/`. O `npm test` roda `tests/*.test.mjs`;
// este mora em `tests-integracao/` e sai por `npm run test:integracao`, que é o
// que o CI chama ALÉM da suíte. Local segue verde para quem não tem Postgres; o
// portão automático roda os dois. A separação é para o "falha alto" valer onde
// ele enforça de verdade, sem deixar o gate vermelho para quem está codando.

// ⚠️ A GUARDA É DE TOPO, E NÃO UM TESTE COM `skip`.
//
// Se ela fosse um teste e os demais tivessem `{ skip: !url }`, a saída sem banco
// seria "1 falha, 5 puladas" — e cinco puladas ao lado de uma falha ainda leem
// como cobertura parcial. Aqui o módulo LANÇA na importação: o arquivo inteiro
// entra como falho, com uma mensagem só, e não existe estado intermediário que
// alguém possa confundir com "quase verde". Nenhum `skip` neste arquivo, de
// propósito.
const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error(
    "TEST_DATABASE_URL ausente: o teste de concorrencia NAO rodou. Isto e FALHA, nao ausencia de " +
    "trabalho. Suba um Postgres descartavel, rode `node scripts/ci-preparar-banco.mjs` e repita. " +
    "No CI isto quebra o portao de proposito: teste que se omite fica verde sem ter testado nada.",
  );
}
// E ele nunca aponta para producao, nem por engano: escrever lease de conta real
// de vendedora para provar que o lease funciona seria a pior troca do mes.
if (!LOCAL_HOSTS.has(new URL(url).hostname)) {
  throw new Error(
    `BLOCKED: TEST_DATABASE_URL aponta para "${new URL(url).hostname}", que nao e descartavel. ` +
    "Este teste ESCREVE em workspace_marketplace_syncs e so aceita localhost/127.0.0.1/::1.",
  );
}
if (url === process.env.DATABASE_URL) {
  throw new Error("BLOCKED: banco de teste e banco de aplicacao nao podem ser o mesmo.");
}

// Linha sintética: workspace e conexão que não existem em lugar nenhum. O teste
// nunca toca a linha de um vendedor, nem no banco descartável.
const WORKSPACE = "00000000-0000-4000-8000-00000000ce01";
const PROVIDER = "amazon";
const CONEXAO = "test:lease-concorrente";

const conectar = () => new pg.Client({ connectionString: url, ssl: false });

/** O claim EXATO do código de produção — copiar a forma é o ponto do teste. */
const CLAIM = `
  UPDATE workspace_marketplace_syncs
     SET lease_until = now() + interval '5 minutes', updated_at = now()
   WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
     AND (lease_until IS NULL OR lease_until < now())
  RETURNING lease_until::text AS ownership_token`;

const RENOVAR = `
  UPDATE workspace_marketplace_syncs
     SET lease_until = now() + interval '5 minutes', updated_at = now()
   WHERE workspace_id = $1 AND provider = $2 AND connection_id = $3
     AND lease_until::text = $4 AND lease_until > now()
  RETURNING lease_until::text AS ownership_token`;

async function comLinhaLimpa(fn) {
  const admin = conectar();
  await admin.connect();
  try {
    await admin.query(
      // `target_*` e `cursor_*` são NOT NULL na tabela; valores fixos porque o
      // teste é sobre o LEASE e nada mais lê essas colunas aqui.
      `INSERT INTO workspace_marketplace_syncs
            (workspace_id, provider, connection_id, status, lease_until,
             target_from, target_to, cursor_from, cursor_to)
            VALUES ($1, $2, $3, 'pending', NULL,
             now() - interval '30 days', now(), now() - interval '30 days', now())
       ON CONFLICT (workspace_id, provider, connection_id)
       DO UPDATE SET status = 'pending', lease_until = NULL`,
      [WORKSPACE, PROVIDER, CONEXAO],
    );
    return await fn(admin);
  } finally {
    await admin.query(
      `DELETE FROM workspace_marketplace_syncs WHERE workspace_id=$1 AND provider=$2 AND connection_id=$3`,
      [WORKSPACE, PROVIDER, CONEXAO],
    );
    await admin.end();
  }
}

test("dois workers disputam o mesmo lease e SÓ UM ganha", async () => {
  await comLinhaLimpa(async () => {
    const a = conectar();
    const b = conectar();
    await Promise.all([a.connect(), b.connect()]);
    try {
      // Disparados juntos de conexões diferentes: é a corrida real, não uma
      // simulação sequencial que passaria mesmo com o claim quebrado.
      const [r1, r2] = await Promise.all([
        a.query(CLAIM, [WORKSPACE, PROVIDER, CONEXAO]),
        b.query(CLAIM, [WORKSPACE, PROVIDER, CONEXAO]),
      ]);
      const ganhos = [r1, r2].filter((r) => r.rowCount === 1);
      const perdas = [r1, r2].filter((r) => r.rowCount === 0);
      assert.equal(ganhos.length, 1, "exatamente um worker pode assumir a linha");
      assert.equal(perdas.length, 1, "o outro precisa receber ZERO linhas — é o sinal de 'desista'");
    } finally {
      await Promise.all([a.end(), b.end()]);
    }
  });
});

test("o PERDEDOR recebe zero linhas — que é o sinal de não chamar o canal", async () => {
  await comLinhaLimpa(async (admin) => {
    // Primeiro toma o lease; o segundo claim é o do perdedor.
    const dono = await admin.query(CLAIM, [WORKSPACE, PROVIDER, CONEXAO]);
    assert.equal(dono.rowCount, 1);

    const perdedor = conectar();
    await perdedor.connect();
    try {
      const r = await perdedor.query(CLAIM, [WORKSPACE, PROVIDER, CONEXAO]);
      // Zero linhas é o que `if (!conciliacao[0]) return;` lê em amazonSync.ts.
      // Enquanto isto valer, o perdedor não alcança nenhuma chamada à SP-API.
      assert.equal(r.rowCount, 0, "lease ocupado tem que devolver zero linhas");
    } finally {
      await perdedor.end();
    }
  });
});

test("o VENCEDOR consegue renovar, e a renovação troca o token", async () => {
  await comLinhaLimpa(async (admin) => {
    const dono = await admin.query(CLAIM, [WORKSPACE, PROVIDER, CONEXAO]);
    const token = dono.rows[0].ownership_token;

    const renovado = await admin.query(RENOVAR, [WORKSPACE, PROVIDER, CONEXAO, token]);
    assert.equal(renovado.rowCount, 1, "o dono precisa conseguir renovar");
    assert.notEqual(
      renovado.rows[0].ownership_token,
      token,
      "a renovação troca o token: é isso que impede o dono ANTIGO de escrever depois",
    );
  });
});

test("renovar com token velho afeta ZERO linhas — 'perdeu, aborta'", async () => {
  await comLinhaLimpa(async (admin) => {
    const dono = await admin.query(CLAIM, [WORKSPACE, PROVIDER, CONEXAO]);
    const tokenVelho = dono.rows[0].ownership_token;
    await admin.query(RENOVAR, [WORKSPACE, PROVIDER, CONEXAO, tokenVelho]); // token muda aqui

    const comVelho = await admin.query(RENOVAR, [WORKSPACE, PROVIDER, CONEXAO, tokenVelho]);
    // É o fencing: quem segurou o token anterior deixa de poder escrever. Sem
    // isto, um worker lento voltaria do HTTP e gravaria por cima do dono novo.
    assert.equal(comVelho.rowCount, 0, "token velho não renova — o worker expirado tem que abortar");
  });
});

test("lease VENCIDO é assumível por outro worker", async () => {
  await comLinhaLimpa(async (admin) => {
    // Sem isto, um worker morto travaria a conexão para sempre: o lease existe
    // para expirar, e o teste prova que ele expira de verdade.
    await admin.query(
      `UPDATE workspace_marketplace_syncs SET lease_until = now() - interval '1 second'
        WHERE workspace_id=$1 AND provider=$2 AND connection_id=$3`,
      [WORKSPACE, PROVIDER, CONEXAO],
    );
    const novo = await admin.query(CLAIM, [WORKSPACE, PROVIDER, CONEXAO]);
    assert.equal(novo.rowCount, 1, "lease vencido tem que poder ser assumido");
  });
});
