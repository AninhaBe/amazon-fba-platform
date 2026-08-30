import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { oQueFaltaParaOResultado, rodapeDasTaxas } from "../src/app/components/oQueFaltaNoResultado.ts";

// ⚠️ 30/08/2026 — dois textos da tela da Shopee eram FALSOS, nao vagos.
//
// Print da Ana, filtro HOJE: "Taxas R$ 2.770,98 — aguardando fechamento do
// extrato financeiro" e "Margem — aguardando conciliacao completa". Medido no
// mesmo instante: 219 de 219 pedidos COM tarifa, cinco componentes nao-nulos,
// periodo coberto. Nao havia extrato pendente nem conciliacao aguardando: o que
// faltava era o custo de TRES unidades de 240, cadastro dela, dois minutos.
//
// A tela culpava a Shopee por uma pendencia da propria vendedora — e por isso
// ela nao tinha como agir.

const CENARIO_DA_ANA = {
  unitsWithoutCost: 3,
  ordersWithFees: 219,
  ordersProcessed: 219,
  paidOrders: 219,
  hrefDeCustos: "/shopee/produtos",
};

test("o cenario real da Ana aponta o CUSTO, com numero e link — nao a Shopee", () => {
  const falta = oQueFaltaParaOResultado(CENARIO_DA_ANA);
  assert.equal(falta.texto, "3 unidade(s) sem custo cadastrado");
  assert.equal(falta.href, "/shopee/produtos");
  // A frase antiga culpava a conciliacao, que estava COMPLETA.
  assert.doesNotMatch(falta.texto, /concilia|extrato|aguardando/i);
});

test("o que a vendedora resolve vem ANTES do que depende de nos", () => {
  // Com custo faltando E tarifa faltando, ela precisa ver o que pode agir.
  // Listar os dois faria a acao dela competir com informacao que nao usa.
  const falta = oQueFaltaParaOResultado({ ...CENARIO_DA_ANA, ordersWithFees: 60 });
  assert.match(falta.texto, /sem custo cadastrado/);
  assert.equal(falta.href, "/shopee/produtos");
});

test("sem pendencia de custo, a tarifa parcial aparece COM NUMERO e sem link", () => {
  const falta = oQueFaltaParaOResultado({ ...CENARIO_DA_ANA, unitsWithoutCost: 0, ordersWithFees: 60 });
  assert.equal(falta.texto, "tarifa de 60 de 219 vendas");
  // Sem link de proposito: isto e fila NOSSA, ela nao tem o que clicar.
  assert.equal(falta.href, undefined);
});

test("nada faltando devolve null — o campo nao inventa pendencia", () => {
  assert.equal(oQueFaltaParaOResultado({ ...CENARIO_DA_ANA, unitsWithoutCost: 0 }), null);
});

test("o rodape das Taxas nunca fala em espera quando esta completo", () => {
  const completo = rodapeDasTaxas({ feesComplete: true, ordersWithFees: 219, ordersProcessed: 219 });
  assert.doesNotMatch(completo, /aguardando|fechamento|extrato/i);
  const parcial = rodapeDasTaxas({ feesComplete: false, ordersWithFees: 320, ordersProcessed: 9841 });
  assert.equal(parcial, "tarifa de 320 de 9841 vendas");
  assert.doesNotMatch(parcial, /aguardando/i);
});

test("as duas frases mentirosas nao voltam para a tela", async () => {
  const tela = await readFile(new URL("../src/app/components/ShopeeWorkspace.tsx", import.meta.url), "utf8");
  assert.ok(!tela.includes("aguardando conciliação completa"),
    "a margem culpava a conciliacao, que estava completa");
  assert.ok(!tela.includes("aguardando fechamento do extrato financeiro"),
    "as Taxas anunciavam espera com o valor completo ao lado");
});
