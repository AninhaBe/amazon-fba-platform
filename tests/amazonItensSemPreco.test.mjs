import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// DEFEITO QUE ESTA GUARDA REPROVA (20/09/2026, conta A15NQMF7A6J1Y0): pedido da
// Amazon tem os itens conciliados ainda `Pending`, SEM preço, e nunca mais era
// buscado — 628 linhas de pedidos ENVIADOS com `unit_price` nulo em 15 dias e
// ~97% dos enviados desde 31/08 valendo R$ 0,00, com a Amazon publicando o valor.
//
// ⚠️ O QUE ELA NÃO PROVA: comportamento. Quem prova que o valor entra é
// tests-integracao/itensSemPrecoNaoZeramOPedido (Postgres) e
// tests/amazonCanonical (normalização). Aqui só se garante que as três peças
// não somem num refactor. Comparação literal, sem regex montada, sobre o fonte
// SEM comentários de JS — o comentário que explica o defeito cita o defeito.
const semComentarios = (fonte) => fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const sync = semComentarios(readFileSync(new URL("../src/lib/integrations/amazonSync.ts", import.meta.url), "utf8"));
const store = semComentarios(readFileSync(new URL("../src/lib/integrations/canonicalStore.ts", import.meta.url), "utf8"));

test("syncMissingOrderItems re-busca pedido que saiu de pending e ainda tem linha sem preço", () => {
  const inicio = sync.indexOf("async function syncMissingOrderItems(");
  const fim = sync.indexOf("const applications: OrderItemsApplication[] = [];", inicio);
  assert.ok(inicio > 0 && fim > inicio, "a função mudou de forma; releia esta guarda antes de afrouxá-la");
  const consulta = sync.slice(inicio, fim);
  assert.ok(consulta.includes("AND i.unit_price IS NULL"), "sem esta perna o preço nunca é buscado depois do envio");
  assert.ok(consulta.includes("o.status <> 'pending'"), "pendente não devolve preço: re-buscar pendente só queima rate limit");
  assert.ok(consulta.includes("o.occurred_at > now() - ($5 || ' days')::interval"), "sem janela, pedido que a Amazon nunca precifica ocupa o lote para sempre");
  assert.ok(consulta.includes("String(REPRECIFICAR_DIAS)]"), "a janela tem que chegar à consulta como $5");
});

test("header só é barrado por gross JÁ REFINADO (> 0), não pela mera existência de linhas", () => {
  assert.ok(store.includes(") AND workspace_channel_orders.gross > 0\n               THEN workspace_channel_orders.gross ELSE EXCLUDED.gross END`;"));
});

test("linhas sem preço não apagam o valor que o pedido já tem", () => {
  assert.ok(store.includes("SET gross = COALESCE(refined.gross, orders.gross),"));
  assert.ok(store.includes("buyer_shipping = COALESCE(refined.buyer_shipping, orders.buyer_shipping),"));
});
