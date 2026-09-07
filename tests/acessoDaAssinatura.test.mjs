import test from "node:test";
import assert from "node:assert/strict";
import { decidirAcesso } from "../src/lib/billing/acesso.ts";

// A FRONTEIRA DA TRANCA, decidida pela dona do produto em 07/09/2026:
// vencida/cortada bloqueia tudo; quem nao tem registro nenhum passa.
//
// O defeito que estes testes reprovam tem numero: se "sem registro" bloquear,
// a conta da dona (1803d1fe), a do colega (22ae3d9d) e a de demonstracao
// (6c877b36) perdem o produto inteiro — nenhuma das tres tem linha de trial ou
// de assinatura, medido em producao em 07/09/2026. Ausencia e "nao se aplica",
// nunca "nao pagou".

test("sem registro nenhum PASSA — e o mundo de hoje", () => {
  const d = decidirAcesso({ assinatura: null, trial: null });
  assert.equal(d.liberado, true);
  assert.equal(d.motivo, "sem-registro");
});

test("trial ativo passa; trial vencido bloqueia", () => {
  assert.equal(decidirAcesso({ assinatura: null, trial: { expired: false } }).liberado, true);
  const vencido = decidirAcesso({ assinatura: null, trial: { expired: true } });
  assert.equal(vencido.liberado, false);
  assert.equal(vencido.motivo, "trial-vencido");
});

test("assinatura cortada bloqueia, mesmo com trial ainda valendo", () => {
  // Sem esta precedencia, cancelar deixaria a pessoa dentro ate o trial acabar.
  const d = decidirAcesso({ assinatura: { status: "cortada" }, trial: { expired: false } });
  assert.equal(d.liberado, false);
  assert.equal(d.motivo, "assinatura-cortada");
});

test("assinatura ativa passa, mesmo com trial vencido", () => {
  // O caso de quem pagou depois que a avaliacao acabou. Sem esta precedencia,
  // pagar nao abriria a conta — o defeito mais caro possivel nesta tela.
  const d = decidirAcesso({ assinatura: { status: "ativa" }, trial: { expired: true } });
  assert.equal(d.liberado, true);
  assert.equal(d.motivo, "assinatura-ativa");
});

test("o motivo distingue cortada de vencida — sao textos diferentes na tela", () => {
  const cortada = decidirAcesso({ assinatura: { status: "cortada" }, trial: null }).motivo;
  const vencida = decidirAcesso({ assinatura: null, trial: { expired: true } }).motivo;
  assert.notEqual(cortada, vencida);
});
