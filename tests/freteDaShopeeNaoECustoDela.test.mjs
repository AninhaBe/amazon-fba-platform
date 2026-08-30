import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { canonicalShopeeFees } from "../src/lib/integrations/shopeeCanonical.ts";

// ⚠️ 30/08/2026 — o defeito que fez a tela dizer PREJUIZO onde havia LUCRO.
//
// `actual_shipping_fee` era mapeado como `shipping_seller` e descontado do
// lucro. Medido contra a loja real, 160 pedidos em quatro faixas de idade: a
// diferenca entre escrow_amount e (bruto - comissao - servico) NUNCA foi igual
// ao actual_shipping_fee (0 de 80 divergentes); nas faixas recentes a identidade
// fecha exata (80 de 80). E o corpo do escrow mostra buyer_paid_shipping_fee
// 9,62 com final_shipping_fee -9,62: o comprador paga, a Shopee estorna.
//
// Num unico dia isso descontava R$ 3.542,80 — 33% do faturamento — e levava a
// margem de +20,35% para -12,64%.

const ESCROW_REAL = {
  // pedido 260830NJV6G0MB, lido da loja em 30/08/2026
  original_price: 69.9, commission_fee: 12.58, service_fee: 5.4,
  actual_shipping_fee: 27.51, buyer_paid_shipping_fee: 7.51, escrow_amount: 51.92,
};

test("o frete que o comprador paga NAO vira custo da vendedora", () => {
  const fees = canonicalShopeeFees(ESCROW_REAL, "BRL");
  const frete = fees.filter((fee) => fee.feeType === "shipping_seller");
  assert.deepEqual(frete, [], "actual_shipping_fee de volta na conta = prejuizo inventado");
});

test("as tarifas que SAO dela continuam sendo cobradas", () => {
  const fees = canonicalShopeeFees(ESCROW_REAL, "BRL");
  const comissao = fees.filter((fee) => fee.feeType === "commission").reduce((s, f) => s + f.amount, 0);
  assert.equal(+comissao.toFixed(2), 17.98, "comissao + servico continuam descontadas");
  // A identidade da propria Shopee: bruto - comissao - servico = escrow_amount.
  assert.equal(+(ESCROW_REAL.original_price - comissao).toFixed(2), ESCROW_REAL.escrow_amount);
});

test("frete de DEVOLUCAO continua sendo custo — nao foi medido, nao foi mexido", () => {
  // Tirar `reverse_shipping_fee` por analogia seria repetir o erro que criou o
  // defeito: mapear sem conferir contra o escrow real.
  const fees = canonicalShopeeFees({ ...ESCROW_REAL, reverse_shipping_fee: 12.5 }, "BRL");
  const devolucao = fees.filter((fee) => fee.feeType === "shipping_seller");
  assert.equal(devolucao.length, 1);
  assert.equal(devolucao[0].providerFeeCode, "reverse_shipping_fee");
});

test("o mapa nao volta a tratar actual_shipping_fee como custo", async () => {
  const fonte = await readFile(new URL("../src/lib/integrations/shopeeCanonical.ts", import.meta.url), "utf8");
  assert.ok(!/\{ field: "actual_shipping_fee", type: "shipping_seller" \}/.test(fonte),
    "o mapeamento voltou — ver o comentario acima do FEE_MAP e os 160 pedidos medidos");
});
