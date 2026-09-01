import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { LOCAL_HOSTS } from "../scripts/migration-safety.mjs";

// ═══ ETAPA 0 DA ADR-036 — a barreira de inquilino é do BANCO, não do WHERE ════
//
// QUAL DEFEITO ESTE ARQUIVO REPROVA. Medido em 01/09/2026, produção: 32 tabelas
// com RLS ativo, ZERO policies, `relforcerowsecurity = false`, e a aplicação
// conectando como `postgres`, que tem `rolbypassrls = true` e é DONA das 32
// tabelas. Ou seja: a separação entre clientes dependia inteiramente do
// `WHERE workspace_id` da aplicação, e não havia nada abaixo.
//
// ⚠️ ESTE ARQUIVO É DIFERENTE DE `isolamentoEntreInquilinos.test.mjs`, e os dois
// precisam existir. Aquele prova que a CONSULTA DA APLICAÇÃO filtra. Este prova
// que, se a consulta NÃO filtrar, o BANCO segura. São as duas metades: um mede a
// disciplina, o outro mede a barreira.
//
// ⚠️ COMO ELE VÊ VERMELHO — E VÊ DENTRO DA PRÓPRIA EXECUÇÃO.
//
// O `AGENTS.md` exige quebrar o código de propósito e ver o teste vermelho antes
// de confiar nele. Aqui isso não é um passo manual que alguém promete ter feito:
// o teste **roda o estado sem barreira primeiro** e AFIRMA que ele vaza. Se
// algum dia esse `assert` de vazamento parar de valer — porque o Postgres mudou,
// porque a role ganhou uma policy por outro caminho —, o arquivo fica vermelho e
// avisa que o resto das asserções deixou de significar o que significava.
//
// Um teste que só prova o estado bom não distingue "a barreira funciona" de "não
// havia nada para barrar". Este distingue, e é por isso que a fase VERMELHA é
// uma asserção e não um comentário.

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error(
    "TEST_DATABASE_URL ausente: o teste da BARREIRA DE INQUILINO nao rodou. Isto e FALHA, nao " +
    "ausencia de trabalho. Suba um Postgres descartavel, rode `node scripts/ci-preparar-banco.mjs` " +
    "e repita. Teste que se omite fica verde sem ter testado nada.",
  );
}
// Ele CRIA ROLE e liga RLS. Em banco de vendedora isso seria imperdoável.
if (!LOCAL_HOSTS.has(new URL(url).hostname)) {
  throw new Error(
    `BLOCKED: TEST_DATABASE_URL aponta para "${new URL(url).hostname}", que nao e descartavel. ` +
    "Este teste CRIA ROLE, LIGA RLS e ESCREVE; so aceita localhost/127.0.0.1/::1.",
  );
}
if (url === process.env.DATABASE_URL) {
  throw new Error("BLOCKED: banco de teste e banco de aplicacao nao podem ser o mesmo.");
}

// Dois inquilinos sintéticos. Nenhum deles existe em lugar nenhum.
const INQUILINO_A = "00000000-0000-4000-8000-0000000ba001";
const INQUILINO_B = "00000000-0000-4000-8000-0000000ba002";
const TABELA = "teste_barreira_inquilino";
const ROLE = "teste_runtime_sem_bypass";
const SENHA = "barreira-de-teste-nao-e-segredo";

/** Conexão da role de runtime — a que NÃO pode ignorar RLS. */
function urlDaRole(base) {
  const u = new URL(base);
  u.username = ROLE;
  u.password = SENHA;
  return u.toString();
}

async function comCliente(connectionString, fn) {
  const cliente = new pg.Client({ connectionString });
  await cliente.connect();
  try {
    return await fn(cliente);
  } finally {
    await cliente.end();
  }
}

/** Lê como a role de runtime, opcionalmente carimbando o workspace. */
async function lerComo(workspaceId) {
  return comCliente(urlDaRole(url), async (cliente) => {
    await cliente.query("BEGIN");
    if (workspaceId !== undefined) {
      await cliente.query("SELECT set_config('app.workspace_id', $1, true)", [workspaceId]);
    }
    // ⚠️ SEM `WHERE workspace_id`, DE PROPÓSITO. É exatamente a consulta que um
    // dev distraído escreveria — e é ela que o banco tem de barrar.
    const { rows } = await cliente.query(`SELECT workspace_id, valor FROM ${TABELA} ORDER BY valor`);
    await cliente.query("COMMIT");
    return rows;
  });
}

test("a barreira de inquilino vive no banco, e nao na lembranca de quem escreve a consulta", async (t) => {
  await comCliente(url, async (dono) => {
    // ── Montagem ────────────────────────────────────────────────────────────
    await dono.query(`DROP TABLE IF EXISTS ${TABELA}`);
    await dono.query(`
      CREATE TABLE ${TABELA} (
        workspace_id TEXT NOT NULL,
        valor        INTEGER NOT NULL
      )`);
    await dono.query(`INSERT INTO ${TABELA} VALUES ($1, 1), ($1, 2), ($2, 99)`,
      [INQUILINO_A, INQUILINO_B]);

    await dono.query(`DROP ROLE IF EXISTS ${ROLE}`);
    // NOBYPASSRLS e NÃO dona da tabela: as duas condições importam. Dono de
    // tabela pula RLS pelo caminho nativo, mesmo sem bypass.
    await dono.query(`CREATE ROLE ${ROLE} LOGIN PASSWORD '${SENHA}' NOBYPASSRLS`);
    await dono.query(`GRANT SELECT, INSERT ON ${TABELA} TO ${ROLE}`);

    await t.test("VERMELHO: sem policy, a consulta sem WHERE ve o dado do vizinho", async () => {
      const linhas = await lerComo(INQUILINO_A);
      // Esta asserção existe para provar que o teste TOCA comportamento real.
      // Se ela parar de valer, as asserções verdes abaixo deixam de significar
      // "a barreira funciona" e passam a significar "não havia nada para barrar".
      assert.equal(linhas.length, 3, "sem policy a role deveria enxergar os dois inquilinos");
      assert.ok(linhas.some((l) => l.workspace_id === INQUILINO_B),
        "sem policy o dado do inquilino B tem de aparecer — e o defeito que a ADR-036 conserta");
    });

    // ── A barreira ──────────────────────────────────────────────────────────
    await dono.query(`ALTER TABLE ${TABELA} ENABLE ROW LEVEL SECURITY`);
    await dono.query(`ALTER TABLE ${TABELA} FORCE ROW LEVEL SECURITY`);
    await dono.query(`
      CREATE POLICY inquilino ON ${TABELA}
        USING      (workspace_id = current_setting('app.workspace_id', true))
        WITH CHECK (workspace_id = current_setting('app.workspace_id', true))`);

    await t.test("VERDE: com policy, a MESMA consulta sem WHERE so ve o proprio inquilino", async () => {
      const linhas = await lerComo(INQUILINO_A);
      assert.equal(linhas.length, 2);
      assert.ok(linhas.every((l) => l.workspace_id === INQUILINO_A),
        "o banco tem de filtrar mesmo quando a consulta nao filtra");
    });

    await t.test("FAIL-CLOSED: sem app.workspace_id, ninguem ve NADA", async () => {
      const linhas = await lerComo(undefined);
      // Fail-closed, e não fail-open: esquecer de carimbar não pode mostrar
      // dado de outro. `current_setting(..., true)` devolve NULL, a comparação
      // vira NULL e a linha some.
      assert.equal(linhas.length, 0,
        "sem workspace carimbado a leitura tem de ser vazia, nunca o banco inteiro");
    });

    await t.test("WITH CHECK: a role nao consegue ESCREVER linha de outro inquilino", async () => {
      // Barreira que só protege leitura não é barreira. Sem WITH CHECK, esta
      // escrita passaria e carimbaria dado no workspace do vizinho.
      await assert.rejects(
        () => comCliente(urlDaRole(url), async (cliente) => {
          await cliente.query("BEGIN");
          await cliente.query("SELECT set_config('app.workspace_id', $1, true)", [INQUILINO_A]);
          await cliente.query(`INSERT INTO ${TABELA} VALUES ($1, 1234)`, [INQUILINO_B]);
          await cliente.query("COMMIT");
        }),
        /row-level security|violates/i,
        "escrever com o workspace do vizinho tem de ser recusado pelo banco",
      );
    });

    await t.test("o carimbo NAO vaza para a proxima transacao da mesma conexao", async () => {
      // ⚠️ O CRITÉRIO 1 DA ADR-036, exercitado. A aplicação fala com o pooler em
      // modo `transaction`: a conexão volta ao pool a cada transação e pode
      // servir OUTRO inquilino. Se o carimbo fosse de sessão em vez de
      // `SET LOCAL`, ele sobreviveria — e o mecanismo de defesa viraria o
      // vazamento. Aqui a mesma conexão é reusada de propósito.
      await comCliente(urlDaRole(url), async (cliente) => {
        await cliente.query("BEGIN");
        await cliente.query("SELECT set_config('app.workspace_id', $1, true)", [INQUILINO_A]);
        const dentro = await cliente.query(`SELECT count(*)::int n FROM ${TABELA}`);
        await cliente.query("COMMIT");
        assert.equal(dentro.rows[0].n, 2);

        await cliente.query("BEGIN");
        const depois = await cliente.query(`SELECT count(*)::int n FROM ${TABELA}`);
        await cliente.query("COMMIT");
        assert.equal(depois.rows[0].n, 0,
          "o carimbo da transacao anterior nao pode sobreviver: seria vazamento entre inquilinos no pooler");
      });
    });

    // ── Desmontagem ─────────────────────────────────────────────────────────
    await dono.query(`DROP TABLE IF EXISTS ${TABELA}`);
    await dono.query(`DROP ROLE IF EXISTS ${ROLE}`);
  });
});
