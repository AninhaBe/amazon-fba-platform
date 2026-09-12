import { test } from "node:test";
import assert from "node:assert/strict";

const { rateioDaTarifa } = await import("../src/lib/amazonProfitability.ts");

/**
 * REPROVA O DEFEITO VISTO EM PRODUCAO EM 12/09/2026: a tabela de vendas da
 * Amazon exibia, na MESMA linha, "Venda —" e "Tarifa 0,00".
 *
 * Os dois campos eram desconhecidos pelo mesmo motivo — pedido `Pending`, a
 * Amazon ainda nao publicou — mas um dizia "nao sei" e o outro AFIRMAVA que a
 * Amazon nao cobrou nada. Zero e fato da fonte; ausencia e `null`. Com o zero,
 * a margem daquela venda nascia inflada.
 *
 * A causa era um tipo que nao distinguia: `fees: number` no acumulador por
 * pedido, inicializado em 0 e somado. Pedido sem NENHUM componente de tarifa
 * saia identico a pedido com tarifa zero de verdade.
 */
test("pedido sem nenhum componente de tarifa tem tarifa DESCONHECIDA, nao zero", () => {
  const semTarifa = { fees: 0, refunds: 0, currency: "BRL", porTipo: {}, refundPostedAt: null };
  assert.equal(rateioDaTarifa(semTarifa, [19.9, 10]), null);
});

test("zero DECOMPOSTO pela Amazon continua sendo zero — e um fato, nao ausencia", () => {
  // A Amazon postou componentes que se anulam (uma cobranca e o estorno dela).
  // Aqui ela DISSE que o saldo de tarifa e zero; a tela pode exibir R$ 0,00.
  const zeroDeVerdade = {
    fees: 0, refunds: 0, currency: "BRL",
    porTipo: { Commission: 2.5, PromotionMetaDataDefinitionValue: -2.5 },
    refundPostedAt: null,
  };
  assert.deepEqual(rateioDaTarifa(zeroDeVerdade, [10, 10]), [0, 0]);
});

test("tarifa real segue rateada por receita, como antes", () => {
  const comTarifa = { fees: 3, refunds: 0, currency: "BRL", porTipo: { Commission: 3 }, refundPostedAt: null };
  assert.deepEqual(rateioDaTarifa(comTarifa, [10, 20]), [1, 2]);
});

test("pedido ausente da conciliacao continua desconhecido", () => {
  assert.equal(rateioDaTarifa(undefined, [10]), null);
});
