import assert from "node:assert/strict";
import test from "node:test";
import {
  effectiveTiktokDashboardPhase,
  financialCards,
  tiktokMotivoSemLucro,
  tiktokResultadoFechado,
} from "../src/app/components/TikTokWorkspaceModel.ts";
import { applyTiktokLedgerAuthority, calculateTiktokFinancialV2 } from "../src/lib/integrations/tiktokFinancialV2.ts";

// A MESMA TELA NÃO PODE DIZER DUAS COISAS (27/08/2026).
//
// Depois que o lucro do TikTok passou a sair com o extrato fechado, o QA achou o
// dashboard se contradizendo na conta demo: a faixa de cima mostrava
// "Lucro R$ 2.691,83 / Margem 18,08%" e o painel "Repasses, taxas e resultado"
// logo abaixo dizia "Lucro indisponível —", "Composição pendente".
//
// Causa: as duas superfícies decidiam por autoridades diferentes. A faixa lê a
// cobertura do PERÍODO (`financials`, escrita pelo ledger); o painel lia a FASE
// do dashboard, que cai para "partial" por `financialBacklog` — pedidos sem
// extrato da CONEXÃO INTEIRA, de qualquer data, indiferentes ao período exibido.
// Na demo eram 225 pedidos fora da janela derrubando um período conciliado.

const pedido = (extra = {}) => ({
  revenue: 1000, fees: 100, sellerShipping: 50, ads: 0, taxesWithheld: 0, refunds: 0,
  buyerShipping: 0, statementSettled: true,
  items: [{ quantity: 1, unitCost: 400, unitDiscount: 0 }],
  ...extra,
});

const extratoLiquidado = (extra = {}) => ({
  covered: true,
  aggregate: {
    revenue: 1000, fees: 100, sellerShipping: 50, buyerShipping: 0,
    ads: 0, taxesWithheld: 0, refunds: 0, adjustments: 0,
    currency: "BRL", finalTransactions: 12, estimatedTransactions: 0, ...extra,
  },
});

const fechado = () =>
  applyTiktokLedgerAuthority(calculateTiktokFinancialV2({ periodCovered: true, taxRate: null, orders: [pedido()] }), extratoLiquidado());

// Janela aberta = o que `readTiktokLedgerSnapshot` devolve sem cobertura: o
// agregado cai para o fallback por pedido, onde anúncio, retenção e estorno
// continuam DESCONHECIDOS (`null`), nunca zero.
const aberto = () =>
  applyTiktokLedgerAuthority(
    calculateTiktokFinancialV2({ periodCovered: false, taxRate: null, orders: [pedido()] }),
    { covered: false, aggregate: { ...extratoLiquidado().aggregate, ads: null, taxesWithheld: null, refunds: null, finalTransactions: 0 } }
  );

const cardDe = (resultado, key) => financialCards(resultado.overview, resultado.coverage).find((card) => card.key === key);

test("extrato fechado: painel e faixa concordam — as duas afirmam o lucro", () => {
  const r = fechado();
  assert.equal(tiktokResultadoFechado(r.overview, r.coverage), true);
  assert.notEqual(cardDe(r, "profit").value, "—");
  assert.notEqual(cardDe(r, "marginPct").value, "—");
});

test("backlog financeiro da conexão NÃO derruba o resultado do período exibido", () => {
  const r = fechado();
  // É exatamente o estado da conta demo: sync "complete" com backlog > 0, que
  // `deriveTiktokSyncPhase` traduz em "partial" — e a fase seguia mandando no
  // painel enquanto a faixa já mostrava o lucro.
  assert.equal(effectiveTiktokDashboardPhase("partial", "AVAILABLE", "complete"), "partial");
  assert.equal(tiktokResultadoFechado(r.overview, r.coverage), true, "o período conciliado não depende de pedido de fora dele");
});

test("janela aberta continua travessão nas DUAS superfícies", () => {
  const r = aberto();
  assert.equal(r.overview.profit, null);
  assert.equal(tiktokResultadoFechado(r.overview, r.coverage), false);
  assert.equal(cardDe(r, "profit").value, "—");
});

test("ledger bloqueado neste ambiente nunca vira resultado fechado", () => {
  const r = fechado();
  assert.equal(tiktokResultadoFechado(r.overview, r.coverage, true), false);
});

test("cobertura de `financials` não afirma e desmente ao mesmo tempo", () => {
  const r = fechado();
  // Antes o status virava "complete" mas known/missing continuavam os de ANTES
  // do ledger (2 de 7), e a mesma métrica que rotula o card alimentava a frase
  // "5 componente(s) sem valor".
  assert.equal(r.coverage.financials.status, "complete");
  assert.equal(r.coverage.financials.missing, 0);
  assert.equal(r.coverage.financials.known, r.coverage.financials.applicable);
  assert.equal(r.coverage.financials.ratio, 1);

  const a = aberto();
  assert.equal(a.coverage.financials.status, "partial");
  assert.equal(a.coverage.financials.missing, 3, "anúncio, retenção e estorno seguem desconhecidos");
  assert.equal(a.coverage.financials.known + a.coverage.financials.missing, a.coverage.financials.applicable);
});

test("motivo do travessão aponta o que falta, e a unidade sem custo vem primeiro", () => {
  assert.match(tiktokMotivoSemLucro(3), /3 unidade\(s\)/);
  assert.match(tiktokMotivoSemLucro(0), /extrato da TikTok Shop ainda não fechou/);
  // Nunca a palavra proibida, nem um adjetivo que se desculpe.
  for (const texto of [tiktokMotivoSemLucro(3), tiktokMotivoSemLucro(0)]) {
    assert.doesNotMatch(texto, /parcial|incompleto/i);
  }
});

test("o dashboard liga painel e narrador na mesma decisão, não na fase do sync", async () => {
  const { readFile } = await import("node:fs/promises");
  const tela = await readFile(new URL("../src/app/components/TikTokWorkspace.tsx", import.meta.url), "utf8");
  assert.match(tela, /const resultReady = tiktokResultadoFechado\(data\.overview, data\.coverage, financialBlocked\)/);
  assert.match(tela, /complete=\{resultReady\}/, "o painel de composição usa a mesma decisão");
  assert.match(tela, /lucro=\{resultReady \? \(data\.overview\?\.profit \?\? null\) : null\}/, "o narrador do canal também");
  assert.match(tela, /motivoSemLucro=\{resultReady \? null : tiktokMotivoSemLucro\(/, "e o travessão vai com o motivo junto");
  assert.doesNotMatch(tela, /phase === "ready" && !financialBlocked/, "a fase do sync não decide mais sobre lucro");
});

test("a central manda a causa do travessão do TikTok, e não um zero no lugar do desconhecido", async () => {
  const { readFile } = await import("node:fs/promises");
  const [central, visao] = await Promise.all([
    readFile(new URL("../src/app/centralChannels.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/(app)/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(central, /if \(tiktok\.profit == null\) \{\s*\n\s*tiktok\.motivoSemLucro = tiktokMotivoSemLucro\(/);
  assert.match(visao, /faturamento30d: totals\.revenueSources \? totals\.revenue : null/);
  assert.match(visao, /motivoSemLucro: c\.profit == null \? c\.motivoSemLucro \?\? null : null/);
});
