import test from "node:test";
import assert from "node:assert/strict";
import { decidirAcesso, textoDoBloqueio } from "../src/lib/billing/acesso.ts";

// A FRONTEIRA DA TRANCA — modelo v3, decidido pela dona do produto em
// 07/09/2026: "nao tem mais trial, todos os planos passam a valer com o
// pagamento, mas sera os 7 dias de garantia caso a pessoa queira cancelar".
//
// ⚠️ ESTE ARQUIVO JA MUDOU DE INTENCAO DUAS VEZES NO MESMO DIA, e o registro
// fica aqui porque teste que inverte sem dizer por que e o primeiro a ser
// afrouxado quando ficar vermelho por outro motivo:
//
//   v1 (manha):  "sem registro nenhum PASSA — e o mundo de hoje". Era verdade:
//                nenhuma conta tinha linha de assinatura, e bloquear teria
//                derrubado o produto inteiro.
//   v2 (tarde):  sem registro BLOQUEIA; admin e trial ativo passam.
//   v3 (agora):  o TRIAL sai da decisao. So admin e assinatura ativa entram.
//                O que substitui a avaliacao e a garantia de 7 dias — dinheiro
//                de volta, nao acesso adiantado (ver garantiaDeSeteDias.ts).

test("admin sempre entra — inclusive cortado, inclusive sem registro", () => {
  // Chave-mestra por definicao. Se admin dependesse do estado da assinatura, um
  // corte acidental trancaria justamente quem precisa entrar para consertar.
  for (const assinatura of [null, { status: "cortada" }, { status: "ativa" }]) {
    const d = decidirAcesso({ admin: true, assinatura });
    assert.equal(d.liberado, true);
    assert.equal(d.motivo, "admin");
  }
});

test("so assinatura ATIVA entra", () => {
  assert.equal(decidirAcesso({ admin: false, assinatura: { status: "ativa" } }).liberado, true);
  assert.equal(decidirAcesso({ admin: false, assinatura: { status: "cortada" } }).liberado, false);
});

test("sem assinatura nenhuma BLOQUEIA", () => {
  const d = decidirAcesso({ admin: false, assinatura: null });
  assert.equal(d.liberado, false);
  assert.equal(d.motivo, "sem-assinatura");
});

test("status DESCONHECIDO bloqueia — desconhecido para tudo", () => {
  // O tipo so admite "ativa" e "cortada", mas o valor vem de JSON no banco. Se
  // um dia chegar "pausada" ou string vazia, o desconhecido PARA em vez de
  // abrir — a mesma escolha do currentWorkspaceId(), que lanca em vez de
  // devolver um padrao.
  for (const status of ["pausada", "", "ATIVA", "inadimplente", "trialing"]) {
    assert.equal(
      decidirAcesso({ admin: false, assinatura: { status } }).liberado,
      false,
      `status "${status}" abriu a conta`
    );
  }
});

test("TRIAL nao entra mais na decisao — nem para abrir, nem para fechar", () => {
  // ⚠️ O defeito que isto reprova e de OMISSAO: as colunas de trial continuam no
  // banco e o src/lib/trial.ts continua existindo, dormentes. Se alguem religar
  // a leitura "porque estava la", contas antigas voltam a entrar sem pagar.
  // A assinatura de decidirAcesso nao tem campo de trial, e este teste falha se
  // alguem devolver um.
  const entrada = { admin: false, assinatura: null, trial: { expired: false } };
  assert.equal(decidirAcesso(entrada).liberado, false, "trial ativo abriu a conta no modelo v3");
  assert.equal(decidirAcesso({ ...entrada, trial: { expired: true } }).motivo, "sem-assinatura");
});

test("cada caso conta uma historia diferente na tela", () => {
  const motivos = [
    decidirAcesso({ admin: true, assinatura: null }).motivo,
    decidirAcesso({ admin: false, assinatura: { status: "ativa" } }).motivo,
    decidirAcesso({ admin: false, assinatura: { status: "cortada" } }).motivo,
    decidirAcesso({ admin: false, assinatura: null }).motivo,
  ];
  assert.equal(new Set(motivos).size, motivos.length);
  // E quem nunca assinou nao pode ler "sua assinatura foi encerrada".
  assert.ok(!/encerrad/i.test(textoDoBloqueio("sem-assinatura")));
  assert.match(textoDoBloqueio("assinatura-cortada"), /encerrada/);
});
