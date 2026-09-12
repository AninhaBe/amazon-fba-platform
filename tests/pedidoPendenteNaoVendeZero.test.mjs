import { test } from "node:test";
import assert from "node:assert/strict";

const { valorDoPedidoRecente } = await import("../src/app/(app)/amazon/pedidoRecente.ts");

/**
 * REPROVA O DEFEITO DE 12/09/2026: "Pedidos recentes" da Amazon mostrou
 * `R$ 0,00` em seis pedidos `Pending` seguidos.
 *
 * O guard da tela era `pedido.orderTotal ? money(...) : "—"` — ele protegia
 * contra o campo AUSENTE, e a Amazon nao omite o campo: manda `"0.00"` ate o
 * envio. Guard contra ausencia nao protege contra zero vindo da fonte.
 */
test("pedido Pending com total zero e DESCONHECIDO — a Amazon ainda nao publicou", () => {
  assert.equal(valorDoPedidoRecente({ orderTotal: { Amount: "0.00", CurrencyCode: "BRL" }, orderStatus: "Pending" }), null);
});

test("pedido ja enviado com zero continua sendo zero — e fato da Amazon", () => {
  assert.deepEqual(
    valorDoPedidoRecente({ orderTotal: { Amount: "0.00", CurrencyCode: "BRL" }, orderStatus: "Shipped" }),
    { valor: 0, moeda: "BRL" },
  );
});

test("pedido Pending JA valorizado mostra o valor — nao e o status que esconde", () => {
  assert.deepEqual(
    valorDoPedidoRecente({ orderTotal: { Amount: "19.90", CurrencyCode: "BRL" }, orderStatus: "Pending" }),
    { valor: 19.9, moeda: "BRL" },
  );
});

test("campo ausente continua desconhecido", () => {
  assert.equal(valorDoPedidoRecente({ orderStatus: "Shipped" }), null);
});

/**
 * ⚠️ "TEM FUNCAO CERTA" NAO E "A TELA USA". As quatro asserções
 * acima ficariam TODAS verdes com o dashboard continuando a chamar
 * `money(parseFloat(o.orderTotal.Amount))` direto — foi exatamente assim que
 * este arquivo passou no primeiro commit, com `R$ 0,00` ainda na tela.
 *
 * Por isso a asserção ancora na CHAMADA inteira, e nao no identificador: um
 * `assert.match(fonte, /valorDoPedidoRecente/)` continua verde depois de alguem
 * apagar a chamada e deixar o import.
 */
test("o dashboard da Amazon usa a regra — a chamada, nao o nome importado", async () => {
  const { readFileSync } = await import("node:fs");
  const fonte = readFileSync("src/app/(app)/amazon/page.tsx", "utf8");
  assert.ok(
    fonte.includes("const v = valorDoPedidoRecente(o);"),
    "o bloco Pedidos recentes precisa passar pela regra; sem ela o zero da Amazon volta para a tela",
  );
  const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(
    !codigo.includes("money(parseFloat(o.orderTotal.Amount)"),
    "a formatacao crua do OrderTotal voltou — era ela que exibia R$ 0,00 em pedido Pending",
  );
});
