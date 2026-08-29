import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// ⚠️ POR QUE ESTE TESTE EXISTE (29/08/2026)
//
// A fila do escrow perguntava do pedido MAIS ANTIGO para o mais novo. Com ~16.700
// na fila e ~250 tentativas/hora, o pedido de hoje esperava ~2,8 dias — e ao
// chegar a vez dele ja havia mais 2,8 dias de pedidos novos atras. A tela que a
// vendedora mais olha (filtro HOJE) nunca teria margem. Nao era atraso: era fome
// por construcao.
//
// Medido contra a loja real, 20 pedidos em quatro faixas: get_escrow_detail
// devolveu order_income COM VALOR em 20 de 20, inclusive nos cinco do proprio
// dia (status paid, nada repassado). A Shopee informa a taxa no dia do pedido.
//
// Uma palavra (ASC -> DESC) e a diferenca entre margem hoje e margem nunca. Um
// teste que le a direcao da ordenacao parece bobo ate alguem "arrumar" o ORDER BY.

const fonte = await readFile(new URL("../src/lib/integrations/shopeeSync.ts", import.meta.url), "utf8");

test("a fila do escrow pergunta pelo pedido RECENTE primeiro", () => {
  const i = fonte.indexOf("ORDER BY o.settlement_attempt_at");
  assert.ok(i > 0, "a ordenacao da fila de escrow sumiu");
  const ordem = fonte.slice(i, fonte.indexOf("\n", i));
  assert.match(ordem, /o\.occurred_at DESC/,
    "sem DESC a janela recente volta a esperar a fila inteira — ver o comentario acima da consulta");
});

test("quem nunca foi perguntado continua vindo antes de quem ja foi", () => {
  // A inversao e do DESEMPATE por data, nao do criterio principal. Se alguem
  // trocar o NULLS FIRST, pedido nunca perguntado passa a competir com pedido
  // ja tentado, e a fila volta a repetir trabalho.
  const i = fonte.indexOf("ORDER BY o.settlement_attempt_at");
  const ordem = fonte.slice(i, fonte.indexOf("\n", i));
  assert.match(ordem, /settlement_attempt_at ASC NULLS FIRST/);
  assert.ok(ordem.indexOf("NULLS FIRST") < ordem.indexOf("occurred_at DESC"),
    "a marca de tentativa tem que continuar sendo o criterio principal");
});

test("existe UMA fila de escrow, e a inversao vale para ela", () => {
  // Se aparecer uma segunda ordenacao, ela precisa entrar neste teste tambem —
  // senao metade do dreno volta ao comportamento antigo sem ninguem ver.
  const ocorrencias = fonte.match(/ORDER BY o\.settlement_attempt_at/g) ?? [];
  assert.equal(ocorrencias.length, 1, "mais de uma fila de escrow: revise a inversao em todas");
});
