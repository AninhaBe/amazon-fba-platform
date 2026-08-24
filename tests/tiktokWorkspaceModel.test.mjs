import assert from "node:assert/strict";
import test from "node:test";
import { coverageDescription, effectiveTiktokDashboardPhase, financialCards, historicalBacklogDescription, orderedTiktokConnections, parseTaxRateDraft, productMatchesTiktokScope, resolveTiktokConnection, shouldCanonicalizeTiktokUrl, syncBacklogDescription, syncStateContent, tiktokConnectionError, tiktokOrderStatusLabel, tiktokOverviewQuery, tiktokPageHref, tiktokProductsHref, tiktokSettingsQuery } from "../src/app/components/TikTokWorkspaceModel.ts";

const complete = { status: "complete", applicable: 1, known: 1, missing: 0, pending: 0 };
const partial = { status: "partial", applicable: 1, known: 0, missing: 1, pending: 0 };
const pending = { status: "pending", applicable: 1, known: 0, missing: 0, pending: 1 };
const coverage = { revenue: complete, fees: pending, shipping: partial, tax: partial, cogs: partial, financials: partial };

test("mantém zero comprovado e não o confunde com ausência", () => {
  const cards = financialCards({ currency: "BRL", revenue: 0, fees: null, sellerShipping: null, buyerShipping: null, tax: null, taxRate: null, cogs: null, profit: null, marginPct: null, roiPct: null }, coverage);
  assert.match(cards.find((card) => card.key === "revenue").value, /0,00/);
  assert.equal(cards.find((card) => card.key === "fees").value, "—");
  assert.match(cards.find((card) => card.key === "fees").context, /extrato/);
});

test("mantém card oficial indisponível com cobertura parcial", () => {
  const partialRevenue = { ...coverage, revenue: { status: "partial", applicable: 1945, known: 1945, missing: 0, pending: 0 } };
  const cards = financialCards({ currency: "BRL", revenue: 34186.88, fees: null, sellerShipping: null, buyerShipping: null, ads: null, taxesWithheld: null, refunds: null, tax: null, taxRate: null, cogs: null, profit: null, marginPct: null, roiPct: null }, partialRevenue);
  assert.equal(cards.find((card) => card.key === "revenue").value, "—");
  assert.match(cards.find((card) => card.key === "revenue").context, /período/);
  for (const key of ["fees", "profit", "marginPct", "roiPct"]) assert.equal(cards.find((card) => card.key === key).value, "—");
});

test("explica cada null pelo componente que ainda falta", () => {
  const cards = financialCards({ currency: "BRL", revenue: null, fees: null, sellerShipping: null, buyerShipping: null, tax: null, taxRate: null, cogs: null, profit: null, marginPct: null, roiPct: null }, coverage);
  assert.match(cards.find((card) => card.key === "revenue").context, /período/);
  assert.match(cards.find((card) => card.key === "tax").context, /imposto/);
  assert.match(cards.find((card) => card.key === "cogs").context, /custos/);
  assert.match(cards.find((card) => card.key === "profit").context, /componentes/);
  assert.match(cards.find((card) => card.key === "roiPct").context, /lucro e custo/);
});

test("formata valores completos, margem e ROI", () => {
  const cards = financialCards({ currency: "BRL", revenue: 100, fees: 10, sellerShipping: 5, buyerShipping: 0, tax: 6, taxRate: 6, cogs: 40, profit: 39, marginPct: 39, roiPct: 97.5 }, { revenue: complete, fees: complete, shipping: complete, tax: complete, cogs: complete, financials: complete });
  assert.match(cards.find((card) => card.key === "profit").value, /39,00/);
  assert.equal(cards.find((card) => card.key === "marginPct").value, "39,00%");
  assert.equal(cards.find((card) => card.key === "roiPct").value, "97,50%");
});

// O status da cobertura deixou de ser um adjetivo ("Parcial") e passou a dizer
// de QUEM e a espera — ver tests/tiktokPendenciaDono.test.mjs.
test("traduz cobertura completa e nomeia o dono da espera em texto acessível", () => {
  const items = coverageDescription(coverage);
  assert.equal(items.find((item) => item.key === "revenue").status, "Completa");
  assert.equal(items.find((item) => item.key === "fees").status, "Aguardando a TikTok");
  assert.match(items.find((item) => item.key === "fees").detail, /aguardando extrato/);
  assert.equal(items.find((item) => item.key === "sellerShipping").status, "Aguardando a TikTok");
});

test("usa unidades semânticas, separa fretes e contextualiza valor capturado", () => {
  const items = coverageDescription({
    ...coverage,
    fees: { status: "partial", applicable: 10, known: 4, missing: 3, pending: 3, capturedValue: 12.5 },
    sellerShipping: { status: "partial", applicable: 10, known: 6, missing: 1, pending: 3 },
    buyerShipping: { status: "complete", applicable: 10, known: 10, missing: 0, pending: 0 },
    cogs: { status: "partial", applicable: 24, known: 18, missing: 6, pending: 0 },
  });
  assert.match(items.find((item) => item.key === "fees").detail, /4 de 10 pedidos conhecidos \(40%\)/);
  assert.match(items.find((item) => item.key === "fees").captured, /não é o total oficial/);
  assert.match(items.find((item) => item.key === "cogs").detail, /18 de 24 unidades conhecidas \(75%\)/);
  assert.equal(items.find((item) => item.key === "sellerShipping").status, "Aguardando a TikTok");
  assert.equal(items.find((item) => item.key === "buyerShipping").status, "Completa");
  assert.ok(items.every((item) => !item.detail.includes("itens")));
});

test("backlog histórico não cria razão contra o período selecionado", () => {
  const item = historicalBacklogDescription({ historicalBacklog: { unit: "orders", status: "partial", applicable: 30, known: 23, missing: 0, pending: 7, ratio: 23 / 30, capturedValue: null } });
  assert.match(item.detail, /7 pedido/);
  assert.match(item.context, /não usa nem compara o denominador do período/);
  assert.doesNotMatch(item.detail, /23 de 30/);
});

test("define texto operacional para todas as fases do contrato", () => {
  for (const phase of ["first_sync", "partial", "ready", "retryable_error", "reauth_required", "unavailable"]) {
    const content = syncStateContent(phase);
    assert.ok(content.title);
    assert.ok(content.description);
  }
  assert.match(syncStateContent("retryable_error").title, /nova tentativa/);
  assert.match(syncStateContent("reauth_required").title, /Reconecte/);
  assert.match(syncStateContent("unavailable").title, /indisponível/);
});

test("dashboard não anuncia ready enquanto o ledger está parcial ou bloqueado", () => {
  assert.equal(effectiveTiktokDashboardPhase("ready", "AVAILABLE", "complete"), "ready");
  assert.equal(effectiveTiktokDashboardPhase("ready", "AVAILABLE", "partial"), "partial");
  assert.equal(effectiveTiktokDashboardPhase("ready", "BLOCKED", "blocked"), "partial");
  assert.equal(effectiveTiktokDashboardPhase("retryable_error", "AVAILABLE", "complete"), "retryable_error");
});

test("dashboard traduz status canônico sem alterar status desconhecido", () => {
  assert.equal(tiktokOrderStatusLabel("delivered"), "Entregue");
  assert.equal(tiktokOrderStatusLabel("provider_review"), "provider review");
});

test("ordena lojas por shopId e resolve URL válida ou fallback determinístico", () => {
  const connections = [{ id: "tiktok_shop:20", externalAccountId: "20" }, { id: "tiktok_shop:10", externalAccountId: "10" }];
  assert.deepEqual(orderedTiktokConnections(connections).map((item) => item.id), ["tiktok_shop:10", "tiktok_shop:20"]);
  assert.equal(resolveTiktokConnection(connections, "tiktok_shop:20")?.id, "tiktok_shop:20");
  assert.equal(resolveTiktokConnection(connections, "tiktok_shop:removida")?.id, "tiktok_shop:10");
  assert.equal(resolveTiktokConnection([], null), null);
});

test("preserva query da página e envia período mais connection_id no overview", () => {
  assert.equal(tiktokPageHref("foo=bar&from=2026-08-01&to=2026-08-10", "tiktok_shop:10"), "/tiktok?from=2026-08-01&to=2026-08-10&connection_id=tiktok_shop%3A10");
  assert.equal(tiktokOverviewQuery("from=2026-08-01&to=2026-08-10", "tiktok_shop:10"), "from=2026-08-01&to=2026-08-10&connection_id=tiktok_shop%3A10");
});

test("mantém URL sem parâmetro com uma loja e canoniza múltiplas ou seleção inválida", () => {
  assert.equal(shouldCanonicalizeTiktokUrl(1, null, "tiktok_shop:10"), false);
  assert.equal(shouldCanonicalizeTiktokUrl(2, null, "tiktok_shop:10"), true);
  assert.equal(shouldCanonicalizeTiktokUrl(2, "tiktok_shop:20", "tiktok_shop:20"), false);
  assert.equal(shouldCanonicalizeTiktokUrl(1, "tiktok_shop:removida", "tiktok_shop:10"), true);
});

test("traduz erros de conexão sem expor detalhes internos", () => {
  assert.match(tiktokConnectionError("CONNECTION_ID_REQUIRED"), /Selecione/);
  assert.match(tiktokConnectionError("INVALID_CONNECTION_ID"), /não está mais disponível/);
  assert.match(tiktokConnectionError("CONNECTION_NOT_FOUND"), /gerencie/);
  assert.equal(tiktokConnectionError("OUTRO"), null);
});

test("preserva loja na configuração e no atalho de custos TikTok", () => {
  assert.equal(tiktokSettingsQuery("tiktok_shop:10"), "connection_id=tiktok_shop%3A10");
  assert.equal(tiktokProductsHref("tiktok_shop:10"), "/tiktok/produtos?connection_id=tiktok_shop%3A10");
  assert.equal(productMatchesTiktokScope({ id: "tiktok:tiktok_shop:10:sku:A", source: "tiktok" }, "tiktok_shop:10"), true);
  assert.equal(productMatchesTiktokScope({ id: "tiktok:tiktok_shop:20:sku:A", source: "tiktok" }, "tiktok_shop:10"), false);
  assert.equal(productMatchesTiktokScope({ id: "A", source: "listing" }, null), false);
});

test("alíquota vazia continua desconhecida e zero explícito é válido", () => {
  assert.equal(parseTaxRateDraft(""), null);
  assert.equal(parseTaxRateDraft("0"), 0);
  assert.equal(parseTaxRateDraft("6,25"), 6.25);
  assert.equal(parseTaxRateDraft("101"), null);
});

test("separa cobertura de pedidos, produtos e backlog financeiro", () => {
  const items = syncBacklogDescription({ ordersComplete: true, productsComplete: false, financialBacklog: 7, processedOrders: 12, progress: 1, activeProducts: 4, productsTotal: 5 });
  assert.equal(items.find((item) => item.key === "orders").status, "Completa");
  assert.equal(items.find((item) => item.key === "products").status, "Em andamento");
  assert.match(items.find((item) => item.key === "financial").detail, /7 pedido/);
  assert.match(items.find((item) => item.key === "financial").detail, /não é a cobertura do período/);
});
