import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { amazonFinancialCards, gastoComAnuncioDoPeriodo } from "../src/app/amazon/amazonFinancialCards.ts";

// O DEFEITO (relatado por ela em 29/08/2026): a mesma tela da Amazon exibia
// DOIS numeros chamados lucro com sinais OPOSTOS — -R$ 35,61 na faixa de cards e
// +R$ 365,53 no painel de composicao, com selo verde de "Composicao completa".
// A diferenca era exatamente a maior despesa do periodo: o anuncio.
//
// A causa: a decisao dela de 25/08 ("o card de lucro passa a descontar tambem o
// ads") foi aplicada ao CARD e nao ao PAINEL. Ela relatou uma vez, recebeu
// metade do conserto, e achou a outra metade quatro dias depois.
//
// Estes testes existem para que a conta so possa morar em UM lugar.

const FINANCE = {
  currency: "BRL",
  revenue: 1000,
  fees: 0,
  refunds: 0,
  buyerShipping: 0,
  orderCount: 16,
  feeBreakdown: [{ type: "commission", amount: 0 }],
};
const ADS = { cost: 312.98, sales: 496.16, purchases: 16, ateDia: "2026-08-24", esperadoAte: "2026-08-24" };
const base = { finance: FINANCE, cogs: 200, estimatedProfit: 295.65, unitsWithoutCost: 0, adsConectado: true };

const carta = (cards, key) => cards.find((c) => c.key === key);
const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");

test("o lucro do painel sai da MESMA funcao do card", () => {
  const { gastoComAnuncio } = gastoComAnuncioDoPeriodo({ ...base, ads: ADS });
  const lucroDoPainel = +(base.estimatedProfit - gastoComAnuncio).toFixed(2);
  assert.equal(lucroDoPainel, carta(amazonFinancialCards({ ...base, ads: ADS }), "profit").raw);
  assert.ok(lucroDoPainel < 0, "com R$ 312,98 de anuncio sobre R$ 295,65, o resultado e negativo");
});

test("anuncio postado no extrato nao e descontado duas vezes", () => {
  // Se a Amazon algum dia postar anuncio como tarifa de pedido, o valor ja saiu
  // de `estimatedProfit`. Descontar a Ads API por cima contaria o mesmo dinheiro
  // duas vezes — e agora sao DOIS lugares que dependem dessa guarda.
  const comExtrato = {
    ...base,
    ads: ADS,
    finance: { ...FINANCE, feeBreakdown: [{ type: "AdvertisingFee", amount: 312.98 }] },
  };
  const r = gastoComAnuncioDoPeriodo(comExtrato);
  assert.equal(r.jaNoExtrato, true);
  assert.equal(r.gastoComAnuncio, 0, "o extrato ja levou o anuncio embora");
  assert.equal(r.desconhecido, false);
});

test("Ads conectado sem metrica e DESCONHECIDO — para os dois lugares", () => {
  // `null` != `0` (AGENTS.md). Sem esta flag na funcao, o card dizia "—" e o
  // painel exibia um lucro que assume zero de anuncio: o mesmo defeito de novo,
  // so que por outro caminho.
  const r = gastoComAnuncioDoPeriodo({ ...base, ads: null });
  assert.equal(r.desconhecido, true);
  assert.equal(carta(amazonFinancialCards({ ...base, ads: null }), "profit").raw, null);
});

test("sem Ads conectado, ausencia de anuncio e fato, nao lacuna", () => {
  const r = gastoComAnuncioDoPeriodo({ ...base, ads: null, adsConectado: false });
  assert.equal(r.desconhecido, false, "quem nao anuncia tem lucro conhecido");
  assert.equal(r.gastoComAnuncio, 0);
  assert.equal(carta(amazonFinancialCards({ ...base, ads: null, adsConectado: false }), "profit").raw, 295.65);
});

test("a tela da Amazon nao recalcula o anuncio por conta propria", async () => {
  // A trava contra o defeito voltar: a pagina tem que CHAMAR a funcao, e nao
  // reescrever a subtracao. Duas copias da conta foi o que deixou uma para tras.
  const page = await fonte("src/app/amazon/page.tsx");
  assert.match(page, /gastoComAnuncioDoPeriodo\(\{/, "o painel precisa usar a fonte unica do gasto");
  assert.ok(
    !/estimatedProfit\s*-\s*\(?\s*(profit\??\.)?ads/.test(page),
    "descontar `ads` direto na tela recria a segunda copia da conta"
  );
});
