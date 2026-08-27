import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lerResultadoDoCron } from "../src/lib/schedulerResult.ts";

const fonte = (caminho) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");

// HTTP 200 NÃO É SINAL DE SUCESSO.
//
// As rotas de cron rodam passos best-effort: uma falha não derruba o ciclo, e a
// rota responde 200 com `ok:false` + `falhas{}`. O agendador só lia `res.status`
// e logava "HTTP 200 em 14s" — foi assim que `warm` e `insights` da Amazon
// ficaram um mês quebrados sem nunca virar alarme. Mesmo princípio do contador
// do ledger do TikTok: falha que vira número silencioso não existe para ninguém.

test("200 com ok:false e falhas{} é ERRO, e o log nomeia os passos", () => {
  const r = lerResultadoDoCron(200, {
    ok: false,
    processed: 3,
    falhas: { warm: "Workspace autenticado ausente.", insights: "Workspace autenticado ausente." },
  });
  assert.equal(r.falhou, true);
  assert.match(r.detalhe, /warm: Workspace autenticado ausente\./);
  assert.match(r.detalhe, /insights: Workspace autenticado ausente\./);
});

test("200 com ok:true segue sendo log normal", () => {
  assert.deepEqual(lerResultadoDoCron(200, { ok: true, processed: 3, warmed: 1, insights: 2 }), { falhou: false, detalhe: null });
});

test("rota que ainda não reporta passos não vira alarme falso", () => {
  // ML, Shopee, TikTok e retenção respondem só `ok:true`; corpo ilegível também
  // não é afirmação de falha — o `catch` do agendador cobre erro de rede.
  assert.equal(lerResultadoDoCron(200, { ok: true }).falhou, false);
  assert.equal(lerResultadoDoCron(200, null).falhou, false);
  assert.equal(lerResultadoDoCron(204, {}).falhou, false);
});

test("status fora da faixa 2xx é erro mesmo com corpo silencioso", () => {
  assert.deepEqual(lerResultadoDoCron(500, { ok: true }), { falhou: true, detalhe: "HTTP 500" });
  assert.equal(lerResultadoDoCron(401, null).falhou, true);
});

test("ok:false sem detalhe ainda alarma, dizendo que não detalhou", () => {
  const r = lerResultadoDoCron(200, { ok: false });
  assert.equal(r.falhou, true);
  assert.match(r.detalhe, /sem detalhar/);
});

test("falhas{} presente alarma mesmo se ok vier ausente", () => {
  const r = lerResultadoDoCron(200, { falhas: { adsSync: "429" } });
  assert.equal(r.falhou, true);
  assert.match(r.detalhe, /adsSync: 429/);
});

test("o agendador usa o leitor e loga como erro, sem mexer em cadência", () => {
  const agendador = fonte("src/instrumentation.ts");
  assert.match(agendador, /lerResultadoDoCron\(res\.status, corpo\)/);
  assert.match(agendador, /console\.error\(`\[scheduler\] \$\{rota\}: HTTP \$\{res\.status\} em \$\{segundos\}s — \$\{detalhe\}`\)/);
  // A cadência e os orçamentos ficam como estavam.
  assert.match(agendador, /SCHEDULER_SYNC_INTERVAL_MS \|\| 2 \* 60_000/);
  assert.match(agendador, /AbortSignal\.timeout\(5 \* 60_000\)/);
});
