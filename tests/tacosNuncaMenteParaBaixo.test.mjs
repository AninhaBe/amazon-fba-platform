import test from "node:test";
import assert from "node:assert/strict";
import { tacosDoPeriodo } from "../src/lib/integrations/tacosDoCanal.ts";

// ⚠️ TACOS NUNCA MENTE PARA BAIXO — a garantia que veio da Amazon.
//
// TACOS = gasto de anuncio / faturamento. O denominador e o perigo: base MAIOR
// que a realidade produz percentual MENOR que a realidade, e TACOS baixo demais
// e a leitura que faz alguem AUMENTAR verba achando que sobra espaco.
//
// 📌 GARANTIA REPLICADA, MECANISMO NAO (regra da dona do produto). Na Amazon a
// recusa e `!semRepassePostado`, porque la a base do card e o APURADO e ele
// chega tarde. **Medido no ML em 06/09/2026: nao existe analogo.** A base do ML
// sai do proprio pedido, no instante em que ele existe, sem depender de
// liquidacao — implantar a recusa da Amazon aqui seria defesa contra um
// problema que este canal nao tem.
//
// ⚠️ O ML TEM OUTRO BURACO, e ele erra para o lado SEGURO: pedido nao cancelado
// sem valor (`gross IS NULL`) encolhe o denominador, o que AUMENTA o TACOS.
// Por isso ele e declarado (`pedidosSemValor` volta no payload) em vez de
// bloquear: a regra proibe errar para baixo, nao para cima.

test("a base do TACOS", async (t) => {
  await t.test("caso normal: gasto sobre faturamento", () => {
    assert.equal(tacosDoPeriodo({ gasto: 50, faturamento: 1000 }).pct, 5);
  });

  await t.test("🔴 gasto DESCONHECIDO nao vira zero", () => {
    // Zero afirmaria "nao anunciou", que e fato diferente de "nao sei quanto".
    const r = tacosDoPeriodo({ gasto: null, faturamento: 1000 });
    assert.equal(r.pct, null);
    assert.equal(r.motivo, "gasto-desconhecido");
  });

  await t.test("🔴 faturamento zero nao vira infinito nem 0%", () => {
    for (const base of [0, null]) {
      const r = tacosDoPeriodo({ gasto: 50, faturamento: base });
      assert.equal(r.pct, null, `faturamento ${base} tem de virar ausencia`);
      assert.equal(r.motivo, "sem-faturamento");
    }
  });

  // ⚠️ AS DUAS FRONTEIRAS FABRICADAS, e e a comparacao entre elas que prova a
  // garantia. Dado real nao serve: a conta nao tem os dois casos no mesmo dia.
  await t.test("🔴 base INFLADA produziria TACOS menor — e e isso que se proibe", () => {
    const gasto = 100;
    // Base correta do ML: pedido nao cancelado. 1.000.
    const certo = tacosDoPeriodo({ gasto, faturamento: 1000 }).pct;
    // Base com cancelada dentro (o `paid_revenue`, que espelha o painel): 1.500.
    const inflado = tacosDoPeriodo({ gasto, faturamento: 1500 }).pct;
    assert.equal(certo, 10);
    assert.equal(inflado, 6.67);
    assert.ok(inflado < certo,
      "denominador inflado SEMPRE produz TACOS menor — por isso a base e o nao-cancelado");
  });

  await t.test("pedido sem valor ENCOLHE a base e o TACOS sobe — lado seguro", () => {
    // 2 pedidos de 500; um sem valor conhecido => base 500 em vez de 1.000.
    const comTodos = tacosDoPeriodo({ gasto: 100, faturamento: 1000, pedidosSemValor: 0 }).pct;
    const comBuraco = tacosDoPeriodo({ gasto: 100, faturamento: 500, pedidosSemValor: 1 });
    assert.equal(comTodos, 10);
    assert.equal(comBuraco.pct, 20);
    assert.ok(comBuraco.pct > comTodos, "errar para CIMA e o lado que a regra permite");
    assert.equal(comBuraco.pedidosSemValor, 1, "e a tela precisa poder apontar quantos");
  });
});
