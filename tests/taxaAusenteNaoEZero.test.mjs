import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { amazonFinancialCards } from "../src/app/(app)/amazon/amazonFinancialCards.ts";

// O DEFEITO (achado por ela em 30/08/2026): a tela da Amazon mostrava
// "Taxas R$ 0,00 · Total do período conciliado" num dia com 63 vendas.
//
// Medido no banco naquele dia: NENHUM pedido tinha linha em
// `workspace_channel_order_fees` — nem os enviados. A rota somava com
// `reduce(..., 0)`, entao zero linhas viravam zero AFIRMADO, e `0` nao e `null`.
//
// ⚠️ E o preco nao era um card errado: `netProceeds = revenueProcessed - fees` e
// o lucro sai de `revenueProcessed - fees - cogs`. Tarifa fabricada em zero SOBRA
// como lucro que nao existe — no print dela, o lucro vinha de uma base sem
// tarifa nenhuma.
//
// Shopee (`feesComplete` + `fees: number | null`), Mercado Livre (`commissionKnown`
// por pedido) e TikTok (SUM devolve NULL sem linha) ja tratavam isso. A Amazon
// era a unica que fabricava.

const carta = (cards, key) => cards.find((c) => c.key === key);
const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");

const BASE = {
  currency: "BRL", revenue: 398.63, refunds: 0, buyerShipping: 0, orderCount: 63,
};
const input = (finance) => ({ finance, cogs: 135.04, estimatedProfit: 229.69, unitsWithoutCost: 0 });

test("sem NENHUMA linha de tarifa, Taxas e travessao — nunca R$ 0,00", () => {
  const cards = amazonFinancialCards(input({ ...BASE, fees: null, feeBreakdown: [] }));
  assert.equal(carta(cards, "fees").value, "—");
  assert.equal(carta(cards, "fees").raw, null, "`null` != `0`: o valor cru tambem nao pode virar zero");
});

test("periodo COM extrato e tarifa zerada continua sendo R$ 0,00 — zero e noticia", () => {
  // A distincao que o conserto tinha que preservar: a promocao de vendedor novo
  // realmente zera comissao e logistica. "Nao cobraram" e um fato, e apagar esse
  // fato seria trocar um defeito por outro.
  const cards = amazonFinancialCards(input({ ...BASE, fees: 0, feeBreakdown: [{ type: "commission", amount: 0 }] }));
  assert.equal(carta(cards, "fees").raw, 0);
  assert.match(carta(cards, "fees").value, /0,00/);
});

test("sem extrato, os cards DERIVADOS tambem nao afirmam zero", () => {
  // A fabricacao estava replicada: `somaTipos(..., f != null)` tratava "a rota
  // respondeu" como "existe extrato", e logistica, comissao e anuncio saiam como
  // R$ 0,00 com o contexto "A Amazon nao cobrou no periodo".
  const cards = amazonFinancialCards(input({ ...BASE, fees: null, feeBreakdown: [] }));
  for (const key of ["fbaShipping", "commission"]) {
    assert.equal(carta(cards, key).raw, null, `${key} nao pode afirmar zero sem extrato`);
    assert.doesNotMatch(carta(cards, key).context, /não cobrou/i, `${key} nao pode dizer que nao cobraram`);
  }
});

test("a rota nao pode voltar a somar tarifa a partir de zero", async () => {
  // A trava contra a regressao no lugar onde ela nasceu. O `reduce` continua
  // existindo — o que nao pode voltar e ele rodar quando NAO ha linha nenhuma.
  const rota = await fonte("src/app/api/amazon/dashboard/route.ts");
  assert.match(rota, /feeRows\.length === 0\s*\n?\s*\?\s*null/, "ausencia de linha tem que virar `null` na origem");
  assert.match(rota, /netProceeds: fees == null \? null :/, "repasse desconhecido enquanto a tarifa for desconhecida");
});
