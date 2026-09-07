import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { LOCAL_HOSTS } from "../scripts/migration-safety.mjs";
import { conferirEquivalencia, casosDaFronteira, decidirNoSql } from "../scripts/equivalenciaDoAcesso.mjs";

// UMA REGRA, UMA FONTE — ordem da dona do produto em 07/09/2026: o sync pausa
// exatamente quando o acesso esta bloqueado, "nada de segunda logica que possa
// divergir".
//
// A tranca decide em TypeScript, o scheduler decide em SQL. Como SQL nao roda em
// JavaScript, a unica prova de que sao a MESMA regra e a equivalencia medida:
// os mesmos casos, nos dois motores, comparados um a um.
//
// ⚠️ O DEFEITO QUE ISTO REPROVA E REAL E FOI DESTE ARQUIVO. A primeira versao do
// SQL protegia um cast com RegExp escrita dentro de template literal: "\d" virou
// "d", o filtro nasceu comparando com "^d{4}-d{2}-d{2}T" e a conta de trial
// vencido continuava sincronizando. Passou na leitura em voz alta; caiu na
// primeira execucao. E a mesma familia do "\b virando BACKSPACE" ja registrada
// no AGENTS.md.
//
// ⚠️ E SO LE. Os casos vivem num CTE que sombreia workspace_settings dentro da
// consulta — nada e gravado, entao nao ha o que reverter.

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  throw new Error(
    "TEST_DATABASE_URL ausente: o teste de EQUIVALENCIA ENTRE A TRANCA E A PAUSA DO SYNC nao rodou. " +
    "Isto e FALHA, nao ausencia de trabalho — sem ele, as duas metades da mesma regra podem divergir " +
    "em silencio, e o sintoma seria uma conta sem acesso continuando a queimar cota da API do canal."
  );
}
if (!LOCAL_HOSTS.has(new URL(url).hostname)) {
  throw new Error(`BLOCKED: TEST_DATABASE_URL aponta para "${new URL(url).hostname}", que nao e descartavel.`);
}

const cliente = new pg.Client({ connectionString: url });
await cliente.connect();
const consultar = (sql) => cliente.query(sql);

test.after(() => cliente.end());

test("o SQL do scheduler decide igual a tranca, em todos os casos da fronteira", async () => {
  const divergencias = await conferirEquivalencia(consultar);
  assert.deepEqual(divergencias, [], "SQL e TypeScript discordaram sobre quem tem acesso");
});

test("os quatro casos da ordem da Ana estao entre os conferidos", async () => {
  // Guarda contra a lista encolher sem ninguem notar: os quatro casos que a
  // decisao de 07/09/2026 nomeia tem de continuar sendo exercidos.
  const nomes = casosDaFronteira().map((c) => c.nome);
  for (const obrigatorio of [
    "admin sem registro nenhum",
    "admin com assinatura cortada",
    "cortada, sem trial",
    "sem assinatura, trial vencido",
    "sem assinatura, trial ativo",
    "sem registro nenhum",
  ]) {
    assert.ok(nomes.includes(obrigatorio), `o caso "${obrigatorio}" sumiu da fronteira`);
  }
});

test("trial vencido sem assinatura PAUSA — o caso novo de 07/09/2026", async () => {
  // Antes desta decisao este caso continuava sincronizando. Vale asserção
  // propria porque foi a unica mudanca de comportamento do dia.
  const caso = casosDaFronteira().find((c) => c.nome === "sem assinatura, trial vencido");
  assert.equal(await decidirNoSql(consultar, caso), false);
});

test("dado torto BLOQUEIA e nao derruba a consulta do canal inteiro", async () => {
  // Dois perigos numa linha so. O cast estouraria e pararia o canal para TODOS
  // os inquilinos. E a comparacao ingenua CONCEDERIA acesso, porque "sei la" e
  // maior que qualquer data ISO — desde que ausencia bloqueia (07/09/2026),
  // dado torto virando chave seria brecha, nao inconveniencia.
  const caso = casosDaFronteira().find((c) => c.nome === "trial com endsAt malformado");
  assert.equal(await decidirNoSql(consultar, caso), false);
});

test("conta de ADMIN entra mesmo cortada — chave-mestra por definicao", async () => {
  // Um corte acidental trancaria justamente quem precisa entrar para consertar.
  const caso = casosDaFronteira().find((c) => c.nome === "admin com assinatura cortada");
  assert.equal(await decidirNoSql(consultar, caso), true);
});

test("sem registro nenhum PAUSA — a classe que morreu em 07/09/2026", async () => {
  // Ate a manha deste dia esta era a classe que PASSAVA, e era o mundo inteiro.
  // Quem segura as contas reais agora e a excecao de admin, nao a omissao.
  const caso = casosDaFronteira().find((c) => c.nome === "sem registro nenhum");
  assert.equal(await decidirNoSql(consultar, caso), false);
});
