import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  coverageDescription,
  financialCards,
  historicalBacklogDescription,
  syncBacklogDescription,
  syncStateContent,
  tiktokPendencias,
  tiktokTaxSettingsHref,
  TIKTOK_TAX_SETTINGS_ANCHOR,
} from "../src/app/components/TikTokWorkspaceModel.ts";

// "Aguardando dados" e "Aguardando fechamento do extrato" descrevem a tela, nao
// o mundo: quem le nao sabe se o NEXO falhou, se a TikTok atrasou, ou se falta
// ela cadastrar custo/aliquota. Toda pendencia precisa dizer o DONO da espera e
// o que falta, com numero — e link so quando existe algo a fazer.

const metric = (changes = {}) => ({
  status: "partial", unit: "orders", applicable: 10, known: 0, missing: 0, pending: 0, ratio: 0, capturedValue: null, ...changes,
});
const completa = (unit = "orders", applicable = 10) =>
  metric({ status: "complete", unit, applicable, known: applicable, ratio: 1 });

/** Cenario realista: extrato aberto em 3 pedidos, 1 fechado sem taxas, custo e aliquota faltando. */
const requestedPeriod = {
  revenue: metric({ status: "complete", unit: "period", applicable: 1, known: 1, ratio: 1, capturedValue: 1000 }),
  fees: metric({ applicable: 10, known: 6, missing: 1, pending: 3, ratio: 0.6, capturedValue: 60 }),
  sellerShipping: metric({ applicable: 10, known: 7, missing: 0, pending: 3, ratio: 0.7 }),
  buyerShipping: completa(),
  shipping: metric({ unit: "shipping_components", applicable: 20, known: 17, missing: 0, pending: 3, ratio: 0.85 }),
  ads: metric({ applicable: 10, known: 7, missing: 0, pending: 3, ratio: 0.7 }),
  taxesWithheld: metric({ applicable: 10, known: 7, missing: 0, pending: 3, ratio: 0.7 }),
  refunds: metric({ applicable: 10, known: 7, missing: 0, pending: 3, ratio: 0.7 }),
  tax: metric({ unit: "period", applicable: 1, known: 0, missing: 1 }),
  cogs: metric({ unit: "units", applicable: 24, known: 12, missing: 12, ratio: 0.5 }),
  financials: metric({ unit: "period", applicable: 8, known: 5, missing: 3, ratio: 0.625 }),
};
const coverage = {
  requestedPeriod,
  historicalBacklog: metric({ applicable: 30, known: 23, pending: 7, ratio: 23 / 30 }),
  ...requestedPeriod,
};
const overviewVazio = {
  currency: "BRL", revenue: 1000, fees: null, sellerShipping: null, buyerShipping: 0, ads: null,
  taxesWithheld: null, refunds: null, tax: null, taxRate: null, cogs: null, profit: null, marginPct: null, roiPct: null,
};
const CONEXAO = "tiktok_shop:7495";

test("o que depende dela vem primeiro, com numero e link", () => {
  const pendencias = tiktokPendencias(coverage, CONEXAO);
  const dela = pendencias.filter((item) => item.espera === "vendedora");
  assert.deepEqual(dela.map((item) => item.key), ["cogs", "tax"]);
  assert.equal(pendencias.slice(0, 2).every((item) => item.espera === "vendedora"), true);

  const custo = dela.find((item) => item.key === "cogs");
  assert.match(custo.text, /12 unidade\(s\)/);
  assert.match(custo.text, /sem custo cadastrado/);
  assert.equal(custo.action.href, `/tiktok/produtos?connection_id=${encodeURIComponent(CONEXAO)}`);

  const imposto = dela.find((item) => item.key === "tax");
  assert.match(imposto.text, /Alíquota de imposto ainda não cadastrada/);
  assert.equal(imposto.action.href, tiktokTaxSettingsHref(CONEXAO));
  assert.match(imposto.action.href, new RegExp(`#${TIKTOK_TAX_SETTINGS_ANCHOR}$`));
});

test("o que depende da TikTok nomeia o canal e nao oferece botao", () => {
  const doCanal = tiktokPendencias(coverage, CONEXAO).filter((item) => item.espera === "canal");
  assert.equal(doCanal.every((item) => item.action === undefined), true, "espera de terceiro nao vira botao");

  const extrato = doCanal.find((item) => item.key === "statement");
  assert.match(extrato.text, /3 pedido\(s\) ainda sem extrato fechado na TikTok Shop/);

  // Extrato aberto e um fato do pedido: nao se repete uma vez por componente.
  assert.equal(doCanal.filter((item) => item.key === "statement").length, 1);

  // Extrato FECHADO sem o componente e outra coisa, e tem linha propria.
  const taxas = doCanal.find((item) => item.key === "fees");
  assert.match(taxas.text, /A TikTok fechou o extrato de 1 pedido\(s\) sem informar taxas/);
  assert.equal(doCanal.some((item) => item.key === "ads"), false, "componente sem buraco nao vira pendencia");
});

// `periodCovered` vem de `checkpointsCoverPeriod`, que recusa qualquer janela
// terminando depois de `closedFinancialBoundary` (meia-noite de Brasilia). Ou
// seja: "Hoje", "7 dias" e "30 dias" — os padroes da tela — nascem descobertos
// TODO dia. Atribuir isso a TikTok era alarme falso permanente.
test("periodo que termina hoje nao vira pendencia atribuida a TikTok", () => {
  const naoConciliado = { ...coverage, revenue: metric({ unit: "period", applicable: 1, known: 0, missing: 1 }) };
  naoConciliado.requestedPeriod = { ...requestedPeriod, revenue: naoConciliado.revenue };
  const pendencias = tiktokPendencias(naoConciliado, CONEXAO);
  const pendencia = pendencias.find((item) => item.key === "revenue");

  assert.equal(pendencia.espera, "conciliacao");
  assert.notEqual(pendencia.espera, "canal", "janela nossa nao pode virar espera do canal");
  assert.doesNotMatch(pendencia.text, /TikTok/, "nao se culpa o marketplace por conciliacao nossa");
  assert.match(pendencia.text, /não foi conciliado/);
  assert.match(pendencia.text, /meia-noite de Brasília/);
  assert.equal(pendencia.action, undefined);

  // E nao pode aparecer na lista "Aguardando a TikTok Shop" da tela.
  assert.equal(pendencias.filter((item) => item.espera === "canal").some((item) => item.key === "revenue"), false);

  const cards = financialCards(overviewVazio, naoConciliado);
  const faturamento = cards.find((card) => card.key === "revenue").context;
  assert.doesNotMatch(faturamento, /TikTok/);
  assert.match(faturamento, /não foi conciliado/);

  const cobertura = coverageDescription(naoConciliado).find((item) => item.key === "revenue");
  assert.equal(cobertura.status, "Aguardando conciliação");
  assert.doesNotMatch(cobertura.detail, /TikTok/);
});

// `order.buyer_shipping` vem do PEDIDO; em tiktokFinancialV2 a cobertura dele e
// montada com `pending: 0` e o extrato nao entra na conta. Falar em "extrato
// fechado sem informar" inventava um documento que nunca carregou esse campo.
test("lacuna do frete do comprador nao e descrita como falha de extrato", () => {
  const pendencia = tiktokPendencias(coverage, CONEXAO).find((item) => item.key === "buyerShipping");
  assert.equal(pendencia, undefined, "cobertura completa nao gera pendencia");

  const semFrete = { ...coverage, buyerShipping: metric({ applicable: 10, known: 6, missing: 4, ratio: 0.6 }) };
  semFrete.requestedPeriod = { ...requestedPeriod, buyerShipping: semFrete.buyerShipping };

  const item = tiktokPendencias(semFrete, CONEXAO).find((entry) => entry.key === "buyerShipping");
  assert.equal(item.espera, "canal");
  assert.match(item.text, /não informou o frete pago pelo comprador em 4 pedido\(s\)/);
  assert.doesNotMatch(item.text, /extrato/i, "o extrato nunca carregou esse campo");

  const contexto = financialCards(overviewVazio, semFrete).find((card) => card.key === "buyerShipping").context;
  assert.match(contexto, /frete pago pelo comprador/);
  assert.doesNotMatch(contexto, /extrato/i);

  const cobertura = coverageDescription(semFrete).find((entry) => entry.key === "buyerShipping");
  assert.match(cobertura.detail, /4 pedido\(s\) sem o valor do frete pago pelo comprador/);
  assert.doesNotMatch(cobertura.detail, /extrato/i);

  // A contagem de "sem extrato fechado" tambem nao pode absorver esse pedido.
  const extrato = tiktokPendencias(semFrete, CONEXAO).find((entry) => entry.key === "statement");
  assert.match(extrato.text, /3 pedido\(s\) ainda sem extrato fechado/);
});

test("cobertura completa nao inventa pendencia", () => {
  const completo = {
    revenue: completa("period", 1), fees: completa(), sellerShipping: completa(), buyerShipping: completa(),
    shipping: completa("shipping_components", 20), ads: completa(), taxesWithheld: completa(), refunds: completa(),
    tax: completa("period", 1), cogs: completa("units", 24), financials: completa("period", 8),
  };
  assert.deepEqual(tiktokPendencias({ requestedPeriod: completo, historicalBacklog: completa(), ...completo }, CONEXAO), []);
});

test("sem connection_id a pendencia continua verdadeira, apenas sem link", () => {
  const custo = tiktokPendencias(coverage).find((item) => item.key === "cogs");
  assert.match(custo.text, /12 unidade\(s\)/);
  assert.equal(custo.action, undefined);
});

test("cada card diz o que falta e de quem e a espera", () => {
  const cards = financialCards(overviewVazio, coverage);
  const contexto = (key) => cards.find((card) => card.key === key).context;

  assert.match(contexto("cogs"), /Você ainda não cadastrou os custos de 12 unidade\(s\)/);
  assert.match(contexto("tax"), /Você ainda não cadastrou a alíquota de imposto/);
  assert.match(contexto("fees"), /3 pedido\(s\) aguardando o extrato da TikTok Shop/);
  assert.match(contexto("fees"), /1 fechado\(s\) sem taxas/);
  assert.match(contexto("ads"), /3 pedido\(s\) aguardando o extrato da TikTok Shop/);
  // Resultado final lista quem esta segurando, com numero, em vez de "aguardando dados".
  assert.match(contexto("profit"), /custos de 12 unidade\(s\)/);
  assert.match(contexto("profit"), /alíquota de imposto/);
  assert.match(contexto("roiPct"), /lucro e custo/);
  // Card completo continua dizendo que o total e oficial.
  assert.equal(cards.find((card) => card.key === "buyerShipping").context, "Total oficial do período");
});

test("a cobertura da janela rotula o dono da espera em vez de um adjetivo", () => {
  const itens = coverageDescription(coverage, "BRL");
  const item = (key) => itens.find((entry) => entry.key === key);

  assert.equal(item("cogs").status, "Falta você cadastrar");
  assert.match(item("cogs").detail, /12 unidade\(s\) sem custo cadastrado/);
  assert.equal(item("tax").status, "Falta você cadastrar");
  assert.match(item("tax").detail, /alíquota de imposto não cadastrada/);

  assert.equal(item("fees").status, "Aguardando a TikTok");
  assert.match(item("fees").detail, /3 aguardando extrato da TikTok/);
  assert.match(item("fees").detail, /1 pedido\(s\) com extrato fechado sem taxas/);
  assert.equal(item("buyerShipping").status, "Completa");

  // Resultado final nao tem dono proprio: herda de quem esta segurando.
  assert.equal(item("financials").status, "Falta você cadastrar");
  const semCusto = { ...coverage, cogs: completa("units", 24), tax: completa("period", 1) };
  semCusto.requestedPeriod = { ...requestedPeriod, cogs: semCusto.cogs, tax: semCusto.tax };
  assert.equal(coverageDescription(semCusto).find((entry) => entry.key === "financials").status, "Aguardando a TikTok");
});

test("backlog historico e a fila de sincronizacao dizem que a espera e da TikTok", () => {
  assert.equal(historicalBacklogDescription(coverage).status, "Aguardando a TikTok");
  const fila = syncBacklogDescription({ ordersComplete: true, productsComplete: true, financialBacklog: 7, processedOrders: 12, progress: 1, activeProducts: 4, productsTotal: 5 });
  assert.equal(fila.find((item) => item.key === "financial").status, "Aguardando a TikTok");
});

// ---------------------------------------------------------------------------
// AGENTS.md: "Nunca escrever 'parcial' na tela". Vale para "incompleto" e para
// qualquer adjetivo que se desculpe em vez de apontar o que falta.
// ---------------------------------------------------------------------------
const ADJETIVO_PROIBIDO = /parcial|parcia|incomplet/i;

test("nenhum texto de card, cobertura ou pendencia usa 'parcial'/'incompleto'", () => {
  const variar = (changes) => {
    const janela = { ...requestedPeriod, ...changes };
    return { requestedPeriod: janela, historicalBacklog: coverage.historicalBacklog, ...janela };
  };
  const coberturas = [
    coverage,
    { requestedPeriod, historicalBacklog: completa(), ...requestedPeriod },
    variar({ revenue: metric({ unit: "period", applicable: 1, known: 0, missing: 1 }) }),
    variar({ buyerShipping: metric({ applicable: 10, known: 6, missing: 4, ratio: 0.6 }) }),
    variar({ cogs: completa("units", 24), tax: completa("period", 1) }),
  ];
  const textos = [];
  for (const item of coberturas) {
    for (const card of financialCards(overviewVazio, item)) textos.push(card.label, card.value, card.context);
    for (const linha of coverageDescription(item, "BRL")) textos.push(linha.status, linha.detail, linha.captured ?? "");
    for (const pendencia of tiktokPendencias(item, CONEXAO)) textos.push(pendencia.text, pendencia.short, pendencia.action?.label ?? "");
    const backlog = historicalBacklogDescription(item);
    textos.push(backlog.label, backlog.status, backlog.detail, backlog.context);
  }
  for (const fase of ["first_sync", "partial", "ready", "retryable_error", "reauth_required", "unavailable"]) {
    const conteudo = syncStateContent(fase);
    textos.push(conteudo.title, conteudo.description);
  }
  for (const sync of [
    { ordersComplete: false, productsComplete: false, financialBacklog: 7, processedOrders: 0, progress: 0.4, activeProducts: 0, productsTotal: 5 },
    { ordersComplete: true, productsComplete: true, financialBacklog: 0, processedOrders: 12, progress: 1, activeProducts: 5, productsTotal: 5 },
  ]) for (const item of syncBacklogDescription(sync)) textos.push(item.label, item.status, item.detail);

  for (const texto of textos) assert.doesNotMatch(texto, ADJETIVO_PROIBIDO, `texto proibido: "${texto}"`);
});

test("o fonte do painel TikTok nao reintroduz o adjetivo nem perde o link da pendencia", async () => {
  const semComentarios = (fonte) => fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  const model = semComentarios(await readFile(new URL("../src/app/components/TikTokWorkspaceModel.ts", import.meta.url), "utf8"));
  const tela = semComentarios(await readFile(new URL("../src/app/components/TikTokWorkspace.tsx", import.meta.url), "utf8"));

  assert.doesNotMatch(model, ADJETIVO_PROIBIDO);
  assert.doesNotMatch(tela, ADJETIVO_PROIBIDO);

  // As duas listas separadas por dono, e o link so no lado dela.
  assert.match(tela, /title="Falta você cadastrar"/);
  assert.match(tela, /title="Aguardando a TikTok Shop"/);
  assert.match(tela, /title="Aguardando o fechamento do período"/);
  assert.match(tela, /pendenciasDaVendedora/);
  assert.match(tela, /pendenciasDoCanal/);
  assert.match(tela, /pendenciasDaConciliacao/);
  assert.match(tela, /item\.action \? <>/);
  // A ancora do painel de aliquota precisa existir, senao o link cai no vazio.
  assert.match(tela, /id=\{TIKTOK_TAX_SETTINGS_ANCHOR\}/);
});

test("status novo da API continua nomeado e sem 'tentar novamente'", async () => {
  // Guarda de nao-regressao: `tiktokSyncErrorContent` entrou na mesma rodada.
  const { tiktokSyncErrorContent } = await import("../src/app/components/TikTokWorkspaceModel.ts");
  const conteudo = tiktokSyncErrorContent({
    code: "TIKTOK_STATUS_NAO_MAPEADO",
    message: "TIKTOK_STATUS_NAO_MAPEADO: ON_THE_WAY [3]",
    retryable: false,
    unmappedStatuses: [{ status: "ON_THE_WAY", orders: 3 }],
  });
  assert.equal(conteudo.retryable, false);
  assert.match(conteudo.description, /ON_THE_WAY \(3\)/);
  assert.doesNotMatch(conteudo.description, ADJETIVO_PROIBIDO);
});
