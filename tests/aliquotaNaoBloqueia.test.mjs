import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "../scripts/ts-resolver.mjs";

const { amazonFinancialCards } = await import("../src/app/amazon/amazonFinancialCards.ts");
const { calculateTiktokFinancialV2 } = await import("../src/lib/integrations/tiktokFinancialV2.ts");
const { SUFIXO_SEM_IMPOSTO, comSemImposto } = await import("../src/lib/semImposto.ts");

const fonte = (caminho) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");
const carta = (cards, key) => cards.find((c) => c.key === key);
// `Intl.NumberFormat` separa "R$" do numero com espaco NAO separavel (U+00A0).
const dinheiro = (texto) => texto.replace(/ /g, " ");
// Comentario que MENCIONA o rotulo nao e o mesmo que escreve-lo a mao.
const semComentarios = (texto) => texto.replace(/^\s*(\/\/|\*|\/\*).*$/gm, "");

// Decisão dela em 26/08/2026: alíquota de imposto NÃO cadastrada deixa de
// bloquear lucro e margem — os números aparecem rotulados "(sem imposto)".
//
// A nuance é o teste inteiro: só a alíquota (configuração da vendedora) sai do
// bloqueio. Tarifa, frete e custo do MARKETPLACE desconhecidos continuam
// bloqueando, porque aí o `null ≠ 0` é sobre dado que o canal não entregou.

test("o rótulo é um só, e não duplica", () => {
  assert.equal(SUFIXO_SEM_IMPOSTO, " (sem imposto)");
  assert.equal(comSemImposto("Margem", false), "Margem");
  assert.equal(comSemImposto("Margem", true), "Margem (sem imposto)");
  assert.equal(comSemImposto("Margem (sem imposto)", true), "Margem (sem imposto)");
});

// ── Amazon ──────────────────────────────────────────────────────────────────

const amazonBase = {
  finance: { currency: "BRL", revenue: 1000, fees: 100, refunds: 0, orderCount: 10, feeBreakdown: [] },
  cogs: 400, estimatedProfit: 500, unitsWithoutCost: 0, adsConectado: false,
};

test("Amazon: sem alíquota, lucro e margem aparecem com o rótulo", () => {
  const cards = amazonFinancialCards({ ...amazonBase, taxRate: null, taxes: null });
  const lucro = carta(cards, "profit");
  const margem = carta(cards, "marginPct");
  assert.equal(dinheiro(lucro.value), "R$ 500,00");
  assert.match(lucro.context, /\(sem imposto\)$/);
  assert.equal(margem.value, "50,0%");
  assert.match(margem.context, /\(sem imposto\)$/);
});

test("Amazon: com alíquota o rótulo some", () => {
  const cards = amazonFinancialCards({ ...amazonBase, taxRate: 8, taxes: 80, estimatedProfit: 420 });
  assert.doesNotMatch(carta(cards, "profit").context, /sem imposto/);
  assert.doesNotMatch(carta(cards, "marginPct").context, /sem imposto/);
});

test("Amazon: dado do canal ausente CONTINUA bloqueando, com ou sem alíquota", () => {
  // Repasse não postado: o extrato existe e está vazio.
  const semRepasse = amazonFinancialCards({
    ...amazonBase, finance: { ...amazonBase.finance, orderCount: 0 }, taxRate: null, taxes: null,
  });
  assert.equal(carta(semRepasse, "profit").value, "—");
  assert.equal(carta(semRepasse, "marginPct").value, "—");

  // Unidade vendida sem custo cadastrado.
  const semCusto = amazonFinancialCards({ ...amazonBase, unitsWithoutCost: 3, taxRate: null, taxes: null });
  assert.equal(carta(semCusto, "profit").value, "—");
  assert.match(carta(semCusto, "profit").context, /3 unidade/);

  // Ads conectado e sem métrica: gasto desconhecido ≠ zero.
  const semAds = amazonFinancialCards({ ...amazonBase, adsConectado: true, ads: null, taxRate: null, taxes: null });
  assert.equal(carta(semAds, "profit").value, "—");
});

// ── TikTok ──────────────────────────────────────────────────────────────────

const pedidoTiktok = (extra = {}) => ({
  revenue: 1000, fees: 100, sellerShipping: 50, ads: 0, taxesWithheld: 0, refunds: 0,
  buyerShipping: 0, statementSettled: true,
  items: [{ quantity: 1, unitCost: 400, unitDiscount: 0 }],
  ...extra,
});

test("TikTok: sem alíquota, lucro e margem saem calculados sem o imposto", () => {
  const { overview, coverage } = calculateTiktokFinancialV2({
    periodCovered: true, taxRate: null, orders: [pedidoTiktok()],
  });
  assert.notEqual(overview.profit, null, "sem alíquota o lucro tem que existir");
  assert.equal(overview.tax, null, "o imposto em si continua desconhecido — null, nunca zero");
  assert.equal(coverage.financials.status, "complete");
  assert.equal(coverage.tax.status, "partial", "a cobertura do imposto continua apontando o que falta");
  // 1000 − 100 − 50 − 400 = 450, sem imposto.
  assert.equal(overview.profit, 450);
  assert.equal(overview.marginPct, 45);
});

test("TikTok: tarifa desconhecida CONTINUA bloqueando mesmo com alíquota cadastrada", () => {
  const { overview, coverage } = calculateTiktokFinancialV2({
    periodCovered: true, taxRate: 8, orders: [pedidoTiktok({ fees: null })],
  });
  assert.equal(overview.profit, null);
  assert.equal(overview.marginPct, null);
  assert.notEqual(coverage.financials.status, "complete");
});

test("TikTok: unidade sem custo CONTINUA bloqueando", () => {
  const { overview } = calculateTiktokFinancialV2({
    periodCovered: true, taxRate: null,
    orders: [pedidoTiktok({ items: [{ quantity: 1, unitCost: null, unitDiscount: 0 }] })],
  });
  assert.equal(overview.profit, null);
});

test("TikTok: os cards derivados do imposto ganham o rótulo, os outros não", () => {
  const modelo = fonte("src/app/components/TikTokWorkspaceModel.ts");
  assert.match(modelo, /DERIVAM_DO_IMPOSTO = new Set[\s\S]{0,120}"profit", "marginPct", "roiPct"/);
  assert.match(modelo, /comSemImposto\("Total oficial do período", overview\.taxRate == null/);
});

// ── Mercado Livre ───────────────────────────────────────────────────────────

test("ML: a alíquota saiu da condição de bloqueio e virou rótulo", () => {
  const tela = fonte("src/app/components/MercadoLivreWorkspace.tsx");
  assert.match(tela, /const resultIncomplete = resultParcial;/, "só dado do canal bloqueia");
  assert.doesNotMatch(tela, /resultIncomplete = semAliquota/, "a alíquota não pode voltar para o bloqueio");
  // Lucro e margem, no dashboard, no painel de baixo e no monitor.
  assert.match(tela, /comSemImposto\("Lucro estimado", semAliquota\)/);
  assert.match(tela, /comSemImposto\("Margem", semAliquota\)/);
  assert.match(tela, /comSemImposto\("Margem de contribuição", semAliquota\)/);
  assert.match(tela, /comSemImposto\("após todos os custos", semAliquota\)/);
  assert.match(tela, /comSemImposto\("sobre o faturamento", semAliquota\)/);
});

test("ML: o que bloqueia continua sendo pedido, custo e frete do canal", () => {
  const tela = fonte("src/app/components/MercadoLivreWorkspace.tsx");
  const bloco = tela.slice(tela.indexOf("const faltas"), tela.indexOf("const resultParcial"));
  assert.match(bloco, /pedido\(s\) sem conciliar/);
  assert.match(bloco, /unidade\(s\) sem custo/);
  assert.match(bloco, /frete de alguns pedidos/);
  assert.doesNotMatch(bloco, /aliquota|alíquota/i, "a alíquota não é falta de dado do canal");
});

test("ML: a pendência 'Cadastrar alíquota' continua na tela", () => {
  const tela = fonte("src/app/components/MercadoLivreWorkspace.tsx");
  // Mostrar o número com rótulo não dispensa apontar o que falta.
  assert.ok(tela.split("Cadastrar alíquota").length - 1 >= 2, "os CTAs de alíquota precisam sobreviver à mudança");
  assert.match(tela, /A alíquota de imposto ainda não está cadastrada/);
});

test("ML: o lucro do canônico já sai sem imposto quando não há alíquota", () => {
  const canonico = fonte("src/lib/integrations/mercadoLivreOverviewCanonical.ts");
  assert.match(canonico, /estimatedProfit = processedRevenue - fees - cogs - \(taxes \?\? 0\) - sellerShipping/);
});

// ── Shopee ──────────────────────────────────────────────────────────────────

test("Shopee: a alíquota saiu da condição de bloqueio, no agregado e por linha", () => {
  const canonico = fonte("src/lib/integrations/shopeeOverviewCanonical.ts");
  assert.match(canonico, /\[fees, sellerShipping, ads, taxesWithheld, refunds\]\.every/, "taxes saiu da lista");
  assert.match(canonico, /- \(taxes \?\? 0\) -/, "o lucro sai sem imposto em vez de virar null");
  assert.match(canonico, /const complete = lineFees != null && lineSellerShipping != null;/, "por linha idem");
  assert.doesNotMatch(canonico, /lineFees != null && lineSellerShipping != null && lineTax != null/);
});

test("Shopee: a tela rotula e mantém o CTA; dado do canal continua bloqueando", () => {
  const tela = fonte("src/app/components/ShopeeWorkspace.tsx");
  assert.doesNotMatch(tela, /overview\.profit\.taxes == null \|\| overview\.profit\.estimatedProfit/, "taxes saiu do resultIncomplete");
  assert.match(tela, /comSemImposto\("Lucro estimado", semAliquota\)/);
  assert.match(tela, /comSemImposto\("Margem", semAliquota\)/);
  assert.match(tela, /Cadastrar alíquota/);
  // O que segue bloqueando é dado da Shopee.
  assert.match(tela, /overview\.profit\.fees == null \|\| overview\.profit\.sellerShipping == null/);
  assert.match(tela, /overview\.profit\.cogs == null/);
});

// ── Os quatro juntos ────────────────────────────────────────────────────────

test("os quatro canais usam o MESMO rótulo, nenhum escreve o texto à mão", () => {
  const arquivos = [
    "src/app/amazon/amazonFinancialCards.ts",
    "src/app/components/MercadoLivreWorkspace.tsx",
    "src/app/components/ShopeeWorkspace.tsx",
    "src/app/components/TikTokWorkspaceModel.ts",
  ];
  for (const arquivo of arquivos) {
    const s = fonte(arquivo);
    assert.match(s, /from "(@\/lib|\.\.\/\.\.\/lib)\/semImposto"/, `${arquivo} precisa importar o rótulo compartilhado`);
    assert.doesNotMatch(semComentarios(s), /"\(sem imposto\)"/, `${arquivo} não pode escrever o rótulo à mão`);
  }
});

test("o módulo morto de cards do ML não voltou", () => {
  // Ele existia com 12 cards e teste próprio, sem NENHUMA página importando —
  // e codificava a regra oposta à que estava no ar. Apagado em 26/08/2026.
  assert.throws(() => fonte("src/app/components/mercadoLivreFinancialCards.ts"), /ENOENT/);
});
