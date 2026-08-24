import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { agruparItens } from "../src/lib/integrations/tiktokCanonical.ts";

// Faturamento é SEMPRE o que o comprador pagou, nunca o preço de tabela.
//
// Na Amazon isso escorregou em silêncio: o caminho canônico fazia
// `ItemPrice − PromotionDiscount` (certo) enquanto o cálculo ao vivo usava
// `ItemPrice` cru. Duas vendas idênticas de R$ 19,90 exibiam margens de 59,16%
// e 65,73%, e ninguém percebeu por meses porque só aparece quando existe cupom.
//
// Auditoria de 15/08/2026 nos outros canais: ML, Shopee e TikTok já derivavam a
// receita do valor pago. Estes testes existem para que continue assim — o
// defeito é invisível até alguém dar desconto.

const fonte = (caminho) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");

test("Amazon: receita e o valor pago, nao o preco de tabela", () => {
  for (const modulo of [
    "src/lib/amazonProfitability.ts",          // calculo ao vivo (era o defeituoso)
    "src/lib/integrations/amazonCanonical.ts", // ingestao canonica
  ]) {
    const s = fonte(modulo);
    // Aceita as duas formas em uso (`listPrice - promotions` no cálculo ao vivo,
    // `moneyOf(ItemPrice) - moneyOf(PromotionDiscount)` na ingestão): o que o
    // teste cobra é que o desconto entre na conta da receita.
    assert.match(
      s,
      /const revenue = Math\.max\(0,[^;]*(promotions|PromotionDiscount)/,
      `${modulo}: receita precisa descontar o cupom`
    );
    assert.match(s, /PromotionDiscount/, `${modulo}: precisa ler o desconto da API`);
  }
});

test("TikTok: sale_price (pos-desconto) tem precedencia sobre original_price", () => {
  const s = fonte("src/lib/integrations/tiktokCanonical.ts");
  assert.match(s, /paraNumero\(linha\.sale_price\) \?\? paraNumero\(linha\.original_price\)/);

  // A checagem antiga comparava a POSICAO das duas strings no arquivo. Era um
  // proxy: qualquer helper novo que citasse `linha.original_price` mais acima
  // acusava uma inversao inexistente — foi o que aconteceu em 23/08/2026 com o
  // calculo de desconto. Trocado por comportamento, que e o que importa e nao
  // depende de onde o codigo mora.
  const [comDesconto] = agruparItens([
    { product_id: "p1", sku_id: "s1", seller_sku: "SKU-1", sale_price: "17.90", original_price: "19.90" },
  ]);
  assert.equal(comDesconto.unitPrice, 17.9, "faturamento tem que usar o valor pago, nao o preco de tabela");

  // Sem `sale_price`, o preco de tabela e o unico fato disponivel — e ai vale.
  const [semDesconto] = agruparItens([
    { product_id: "p2", sku_id: "s2", seller_sku: "SKU-2", original_price: "19.90" },
  ]);
  assert.equal(semDesconto.unitPrice, 19.9);
});

test("Shopee: model_discounted_price vem antes de model_original_price", () => {
  const s = fonte("src/lib/integrations/shopeeCanonical.ts");
  assert.match(s, /model_discounted_price \?\? line\.model_original_price/);
});

test("Mercado Livre nunca usa o preco cheio do item", () => {
  // `full_unit_price` e o preco ANTES do desconto. `unit_price` e o cobrado —
  // e foi com ele que a regra de faturamento bateu ao centavo com o painel do
  // ML (docs/api-mercado-livre.md).
  for (const modulo of [
    "src/lib/integrations/mercadoLivre.ts",
    "src/lib/integrations/mercadoLivreCanonical.ts",
    "src/lib/integrations/mercadoLivreOverviewCanonical.ts",
  ]) {
    assert.doesNotMatch(fonte(modulo), /full_unit_price/, `${modulo}: preco de tabela nao pode virar receita`);
  }
});

test("nenhum canal usa preco de ANUNCIO como receita de venda", () => {
  // O preco do anuncio nao reflete promocao ativa (documentado no ML: so o
  // endpoint sale_price reflete). Usa-lo como receita repetiria o erro da
  // Amazon numa escala maior, porque valeria para toda venda e nao so as com
  // cupom.
  const receitaDeAnuncio = /(revenue|faturamento|gross)\s*[+]?=\s*[^;\n]*\b(product|item|listing)\.price\b/i;
  for (const modulo of [
    "src/lib/integrations/mercadoLivre.ts",
    "src/lib/integrations/mercadoLivreOverviewCanonical.ts",
    "src/lib/integrations/shopeeOverviewCanonical.ts",
    "src/lib/integrations/amazonOverviewCanonical.ts",
  ]) {
    assert.doesNotMatch(fonte(modulo), receitaDeAnuncio, `${modulo}: receita saindo do preco do anuncio`);
  }
});

test("TikTok recusa item sem preco em vez de assumir zero", () => {
  // Fallback silencioso para 0 faria a venda parecer que nao rendeu nada.
  assert.match(fonte("src/lib/integrations/tiktokCanonical.ts"), /sem preço comprovável/);
});
