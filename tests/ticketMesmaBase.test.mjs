import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Ticket médio e faturamento têm de sair da MESMA base.
//
// Na Amazon a tela exibia R$ 39,80 de faturamento (transações, data de postagem)
// ao lado de um ticket de R$ 21,67 — que era 108,34/5, do orderMetrics. Números
// de dois universos na mesma linha, e a conta não fechava para ninguém.
//
// No Mercado Livre a mesma mistura estava lá, mais sutil: `revenue30d` soma
// aprovadas **+ canceladas** (de propósito, é o "Vendas brutas" do painel do ML),
// mas `paidOrders` conta só aprovadas. Medido em 15/08/2026 sobre dados reais:
//
//   conta 1191100170 — 6.870 aprovadas, 231 canceladas (R$ 9.368,80)
//     ticket exibido R$ 37,06  ×  correto R$ 35,69   → +3,8%
//   conta 648425194  — 50 aprovadas, 3 canceladas (R$ 108,13)
//     ticket exibido R$ 48,55  ×  correto R$ 46,39   → +4,7%
//
// Shopee e TikTok foram auditados no mesmo dia e já usavam base única.

const fonte = (caminho) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");

test("aritmetica: cancelada no numerador e fora do denominador infla o ticket", () => {
  const aprovadas = { pedidos: 50, receita: 2319.39 };
  const canceladas = { pedidos: 3, receita: 108.13 };
  const bruto = aprovadas.receita + canceladas.receita;

  const misturado = bruto / aprovadas.pedidos;          // o que a tela fazia
  const correto = aprovadas.receita / aprovadas.pedidos; // mesma base nos dois lados

  assert.equal(+misturado.toFixed(2), 48.55);
  assert.equal(+correto.toFixed(2), 46.39);
  assert.ok(misturado > correto, "misturar bases sempre infla, nunca reduz");
});

test("ML: o ticket sai das aprovadas, nao do faturamento bruto", () => {
  // A regra ja morou num modulo de cards que nunca chegou a ser ligado na tela;
  // o modulo foi apagado em 26/08/2026 e a garantia voltou a ser cobrada no
  // codigo VIVO, que e onde ela pode quebrar.
  // ⚠️ O TICKET SAIU DO DASHBOARD DO ML em 07/09/2026, com as metricas
  // secundarias: ele nao esta entre as 13 funcoes do canvas aprovado. A regra
  // — numerador e denominador na MESMA base — segue cobrada onde o ticket
  // existe, e a proibicao da mistura continua valendo se ele voltar.
  const s = fonte("src/app/components/MercadoLivreWorkspace.tsx");
  assert.doesNotMatch(s, /revenue30d \/ overview\.metrics\.paidOrders/, "essa era a mistura");
});

test("sem venda aprovada o ticket e desconhecido, nao zero", () => {
  // R$ 0,00 afirmaria que cada venda rendeu zero; sem venda nao ha ticket.
  const shopee = fonte("src/app/components/ShopeeWorkspace.tsx");
  assert.match(shopee, /paidOrders > 0[\s\S]{0,140}?: null/, "Shopee: ticket sem venda precisa ser null");
  assert.match(shopee, /ticket == null \? "—"/, "Shopee: a tela precisa exibir o traco");
  // ⚠️ O ML SAIU DESTA ASSERCAO com o ticket: sem o numero na tela, nao ha
  // traco a exibir. A Shopee, que continua com ele, segue cobrada acima.
});

test("Shopee soma receita e conta pedidos com o MESMO filtro de status", () => {
  const s = fonte("src/lib/integrations/shopeeOverviewCanonical.ts");
  // Ambos usam $6; se alguém trocar um dos dois por outro conjunto, some a paridade.
  assert.match(s, /COUNT\(\*\) FILTER \(WHERE status = ANY\(\$6::text\[\]\)\)::int AS paid_orders/);
  assert.match(s, /SUM\(gross\) FILTER \(WHERE status = ANY\(\$6::text\[\]\)\) AS paid_revenue/);
});

test("TikTok deriva receita e contagem do mesmo conjunto de pedidos", () => {
  const s = fonte("src/lib/integrations/tiktokOverviewCanonical.ts");
  assert.match(s, /const revenue=orders\.reduce\(\(n,order\)=>n\+Number\(order\.gross\),0\)/);
  assert.match(s, /ticket: orders\.length \? \+\(revenue\/orders\.length\)/);
});

test("Amazon: ticket e faturamento saem do par conciliado", () => {
  const s = fonte("src/app/(app)/amazon/page.tsx");
  assert.match(s, /faturamentoConciliado \/ vendasConciliadas/);
  // `revenue`/`salesCount` sao do orderMetrics — base diferente da exibida.
  assert.doesNotMatch(s, /const ticketMedio = salesCount > 0 \? revenue \/ salesCount/);
});
