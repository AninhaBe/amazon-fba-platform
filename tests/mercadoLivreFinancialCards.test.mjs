import test from "node:test";
import assert from "node:assert/strict";
import { mercadoLivreFinancialCards } from "../src/app/components/mercadoLivreFinancialCards.ts";

const brl = (v) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
const carta = (cards, key) => cards.find((c) => c.key === key);

// Números reais da conta 648425194 em 15/08/2026 (30 dias).
const BASE = {
  currency: "BRL",
  revenue30d: 2427.52, approvedRevenue: 2319.39, cancelledRevenue: 108.13,
  cancelledOrders: 3, paidOrders: 50,
  fees: 300, cogs: 900, sellerShipping: 120, buyerShipping: 0,
  taxes: null, taxRate: null,
  estimatedProfit: 999.39, marginPct: 43.1,
  unitsWithoutCost: 0, shippingCostsComplete: true,
};

test("a grade tem doze cards, como Amazon e TikTok", () => {
  assert.equal(mercadoLivreFinancialCards(BASE).length, 12);
});

test("o ticket sai das aprovadas, nao do faturamento com canceladas", () => {
  const t = carta(mercadoLivreFinancialCards(BASE), "ticket");
  assert.equal(t.raw, 2319.39 / 50);
  assert.notEqual(t.raw, 2427.52 / 50, "esta era a mistura de bases corrigida hoje");
});

test("SKU sem custo invalida custo, lucro, margem e ROI", () => {
  const cards = mercadoLivreFinancialCards({ ...BASE, unitsWithoutCost: 4 });
  for (const k of ["cogs", "profit", "marginPct", "roiPct"]) {
    assert.equal(carta(cards, k).value, "—", `${k} nao pode afirmar resultado com custo faltando`);
    assert.match(carta(cards, k).context, /4 unidade/);
  }
  // O que nao depende de custo continua visivel.
  assert.equal(carta(cards, "revenue").raw, 2427.52);
  assert.equal(carta(cards, "fees").raw, 300);
});

test("frete incompleto nao vira total", () => {
  // Exibir parcial como total faria a pessoa precificar com custo menor que o real.
  const cards = mercadoLivreFinancialCards({ ...BASE, shippingCostsComplete: false });
  assert.equal(carta(cards, "sellerShipping").value, "—");
  assert.match(carta(cards, "sellerShipping").context, /Aguardando o custo de frete/);
});

test("sem aliquota o lucro avisa que esta sem imposto", () => {
  const cards = mercadoLivreFinancialCards(BASE);
  assert.equal(carta(cards, "tax").value, "—");
  assert.match(carta(cards, "tax").context, /Configure a alíquota/);
  assert.match(carta(cards, "profit").context, /sem imposto/);
});

test("com aliquota o imposto mostra valor e o lucro deixa de avisar", () => {
  const cards = mercadoLivreFinancialCards({ ...BASE, taxRate: 6, taxes: 139.16 });
  assert.equal(carta(cards, "tax").value, brl(139.16));
  assert.match(carta(cards, "tax").context, /6,0% sobre o faturamento/);
  assert.doesNotMatch(carta(cards, "profit").context, /sem imposto/);
});

test("zero tem significado proprio e e explicado", () => {
  const cards = mercadoLivreFinancialCards({ ...BASE, cancelledRevenue: 0, cancelledOrders: 0, buyerShipping: 0 });
  assert.equal(carta(cards, "cancelled").raw, 0);
  assert.match(carta(cards, "cancelled").context, /Nenhum cancelamento/);
  assert.match(carta(cards, "buyerShipping").context, /Nenhum frete pago pelo comprador/);
});

test("sem venda aprovada o ticket e desconhecido, nao zero", () => {
  const cards = mercadoLivreFinancialCards({ ...BASE, paidOrders: 0, approvedRevenue: 0 });
  assert.equal(carta(cards, "ticket").value, "—");
});
