import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  baseDoVariantProductId,
  tituloDaVariacao,
  variacaoDoProductId,
  variantProductId,
} from "../src/lib/integrations/variantProductId.ts";
import { tiktokVariantProductId } from "../src/lib/integrations/tiktokCanonical.ts";

// ADR-029, passo 2: um dialeto só de id de variação para todos os canais.

test("o formato é EXATAMENTE o que o TikTok já gravou em produção", () => {
  // Se divergir, o catálogo do TikTok para de casar com as vendas dele — e são
  // 43 de 43 casando hoje justamente porque os dois lados usam este formato.
  assert.equal(variantProductId("123", "456"), tiktokVariantProductId("123", "456"));
  assert.equal(variantProductId("123", "456"), "123::sku:456");
});

test("sem variação, o id do anúncio passa INTACTO", () => {
  // É isto que mantém o histórico dos anúncios simples casando depois do lote.
  for (const vazio of [null, undefined, "", "   "]) {
    assert.equal(variantProductId("23697969853", vazio), "23697969853");
  }
});

test("compor duas vezes não duplica o sufixo", () => {
  // `a::sku:b::sku:b` não casaria com nada dos dois lados.
  const uma = variantProductId("a", "b");
  assert.equal(variantProductId(uma, "b"), uma);
  assert.equal(variantProductId(uma, "outra"), uma);
});

test("id de anúncio vazio é erro, não id torto", () => {
  assert.throws(() => variantProductId("", "b"), TypeError);
  assert.throws(() => variantProductId("   ", "b"), TypeError);
});

test("dá para voltar do composto para o anúncio e para a variação", () => {
  assert.equal(baseDoVariantProductId("123::sku:456"), "123");
  assert.equal(variacaoDoProductId("123::sku:456"), "456");
  // Id simples: base é ele mesmo, variação é null (não "" e não inventada).
  assert.equal(baseDoVariantProductId("123"), "123");
  assert.equal(variacaoDoProductId("123"), null);
});

test("o título da variação é LEGÍVEL — nome, depois SKU, depois o aviso", async () => {
  const titulo = "Papel de Parede 10 Metros";
  // Nome da variação é o melhor: diz o que a pessoa vê no anúncio.
  assert.equal(tituloDaVariacao(titulo, "Madeira Preta", "PP-MAD-PT", 3), "Papel de Parede 10 Metros · Madeira Preta");
  // Sem nome, o SKU serve — é feio, mas identifica.
  assert.equal(tituloDaVariacao(titulo, null, "PP-MAD-PT", 3), "Papel de Parede 10 Metros · PP-MAD-PT");
  // ⚠️ Sem nenhum dos dois, NUNCA repetir o título: N linhas idênticas na tela
  // e a dona sem saber qual é qual.
  assert.equal(tituloDaVariacao(titulo, null, null, 3), "Papel de Parede 10 Metros · variação sem nome");
  assert.equal(tituloDaVariacao(titulo, "  ", "  ", 3), "Papel de Parede 10 Metros · variação sem nome");
  // Variação única não ganha sufixo — não há o que distinguir.
  assert.equal(tituloDaVariacao(titulo, "Madeira Preta", "PP", 1), titulo);
});

test("a atomicidade está escrita onde quem for implementar vai ler", async () => {
  const fonte = await readFile(new URL("../src/lib/integrations/variantProductId.ts", import.meta.url), "utf8");
  assert.match(fonte, /41 de 41|41\/41/);
  assert.match(fonte, /MESMO lote/);
});
