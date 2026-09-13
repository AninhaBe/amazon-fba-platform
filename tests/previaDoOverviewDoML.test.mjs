import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LINHAS_DA_PREVIA } from "../src/lib/integrations/mercadoLivreOverviewCanonical.ts";

// A PREVIA DO OVERVIEW DO ML (13/09/2026).
//
// O DEFEITO QUE ESTE ARQUIVO REPROVA, com o numero real: o dashboard renderiza
// 5 linhas (ultimosPedidos) e recebia as 1000 — 567 KB dos 595 KB do payload
// eram lista que ninguem lia (medicao da Vitrine), pagos a cada troca de
// periodo em parse e memoria do navegador.
//
// Prova de equivalencia: scripts/_diff-previa-overview-ml.mjs — DIFF AO
// CENTAVO zero em todas as conexoes/janelas (rodado em 13/09/2026, inclusive
// CRYSTALFANCY 1000->5 linhas). As 3 quebras abaixo foram vistas VERMELHAS
// uma a uma em 13/09/2026.

const produtor = readFileSync(
  new URL("../src/lib/integrations/mercadoLivreOverviewCanonical.ts", import.meta.url), "utf8");
const rota = readFileSync(
  new URL("../src/app/api/integrations/mercado-livre/overview/route.ts", import.meta.url), "utf8");

test("a previa tem 5 linhas — o que o ultimosPedidos consome", () => {
  assert.equal(LINHAS_DA_PREVIA, 5);
});

test("so o MONITOR recebe a lista inteira; dashboard e estoque pedem a previa", () => {
  // Ancora DENTRO da chamada (nunca frase solta): e a rota quem escolhe.
  assert.match(rota, /getMercadoLivreOverviewFromCanonical\(connection, period, \{\s*detalhe: view === "monitor" \? "completo" : "previa",\s*\}\)/);
});

test("o corte e POR LINHA na emissao, e o escopo da previa sai do CONJUNTO INTEIRO", () => {
  // O corte: pedido de 3 itens ocupa 3 vagas (contrato com a Vitrine).
  assert.match(produtor, /profitabilityLines: detalhe === "previa" \? profitabilityLines\.slice\(0, LINHAS_DA_PREVIA\) : profitabilityLines,/);
  // O escopo: na previa vem do COUNT (escopoRows), NUNCA da lista cortada —
  // a frase "Exibindo os N mais recentes" e o unico aviso do recorte e
  // refletir 5 seria mentir.
  assert.match(produtor, /const pedidosDetalhados = detalhe === "previa"\s*\? \(escopoRows\?\.\[0\]\?\.pedidos_detalhados \?\? 0\)\s*: linesByOrder\.size;/);
  // E o COUNT cobre o mesmo teto do caminho completo (o conjunto inteiro).
  assert.match(produtor, /SELECT COUNT\(DISTINCT d\.external_order_id\)::int AS pedidos_detalhados/);
  assert.match(produtor, /\[\.\.\.scopeParams\(connection\.id, period\), REVENUE_STATUSES, DETAILED_ORDER_LIMIT\]\s*\)\s*: Promise\.resolve\(null\),/);
});

test("o caminho COMPLETO segue com o teto de 1000 — o monitor nao encolheu junto", () => {
  assert.match(produtor, /detalhe === "previa" \? LINHAS_DA_PREVIA : DETAILED_ORDER_LIMIT/);
});
