import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// TOP PRODUTOS DO ML SEM O TETO DE 1000 (13/09/2026).
//
// O DEFEITO QUE ESTE ARQUIVO REPROVA, com o numero que ele teve no mundo real:
// a apuracao por produto acumulava dentro do laco das linhas DETALHADAS
// (DETAILED_ORDER_LIMIT = 1000). Quando a conta passou do teto (medido: 1240
// pedidos em 7d, 5388 em 30d), processedRevenue por produto nunca alcancava
// revenue e o portao `complete` nunca abria — o Top 8 INTEIRO ficou sem margem,
// inclusive produto com custo cadastrado (print da dona, 13/09/2026).
//
// A prova de COMPORTAMENTO (dado fabricado dos dois lados do teto e rateio
// pelo pedido inteiro) vive em tests-integracao/topProdutosRateiaPeloPedidoInteiro
// — exige Postgres. Aqui ficam as ancoras de fonte, DENTRO das clausulas.

const fonte = readFileSync(
  new URL("../src/lib/integrations/mercadoLivreOverviewCanonical.ts", import.meta.url),
  "utf8",
);

test("a apuracao por produto vem do SQL do periodo inteiro, nao do laco detalhado", () => {
  // Ancora DENTRO da consulta: o denominador do rateio e a janela POR PEDIDO —
  // e o recorte por pedido que faz a janela ver o pedido INTEIRO (armadilha do
  // ABC, 12/09/2026).
  assert.match(fonte, /SUM\(i\.qty \* i\.unit_price\) OVER \(PARTITION BY i\.external_order_id\) AS receita_pedido/);
  // O completo do produto exige tarifa E frete de TODOS os pedidos que o tocam.
  assert.match(fonte, /BOOL_AND\(commission IS NOT NULL AND seller_shipping IS NOT NULL\) AS completo/);
  // E o consumidor liga o resultado ao productTotals — a chamada, nao a frase.
  assert.match(fonte, /for \(const row of porProdutoRows\) \{/);
  assert.match(fonte, /alvo\.calculationsComplete = completo;/);
});

test("o laco das linhas detalhadas NAO acumula mais a apuracao por produto", () => {
  // Proibicao olha o fonte SEM comentarios — o comentario que explica a
  // remocao cita exatamente o que e proibido (regra da casa, 01/09/2026).
  const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  // A forma da regressao e voltar a somar processedRevenue por linha detalhada:
  assert.ok(
    !/current\.processedRevenue \+=/.test(codigo),
    "a apuracao por produto voltou para o laco dos 1000 detalhados — e o teto volta a matar a margem do Top",
  );
  assert.ok(
    !/current\.calculationsComplete = current\.calculationsComplete &&/.test(codigo),
    "o E logico por linha detalhada voltou — complete por produto deixa de cobrir o periodo inteiro",
  );
});

test("o rateio com receita zerada divide igual pelas linhas, nunca descarta a tarifa", () => {
  // Fronteira teorica mas barata de travar: pedido de R$ 0,00 com tarifa.
  assert.match(fonte, /ELSE commission \/ linhas_pedido END/);
  assert.match(fonte, /ELSE seller_shipping \/ linhas_pedido END/);
});
