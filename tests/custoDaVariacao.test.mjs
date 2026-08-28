import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// ADR-029 + parecer do Delta (28/08/2026): a decisão é que o custo cadastrado
// num anúncio multi-variação vira SUGESTÃO A CONFIRMAR — nunca é replicado nem
// descartado. O Delta tentou furar essa decisão e achou duas portas laterais que
// a anulariam em silêncio. Nenhuma das duas dispara hoje; as duas estão "a uma
// linha de distância".
//
// ⚠️ Decisão que depende de ninguém escrever uma linha não é decisão, é sorte.
// Estes testes são a linha que ninguém escreve sem quebrar a suíte.

// ⚠️ TODO NO LOTE DA IMPLEMENTAÇÃO DO ADR-029 — a PORTA 1 vira teste DE
// COMPORTAMENTO, e este aqui deixa de bastar.
//
// Reparo do Delta em 28/08/2026, e ele está certo: o teste abaixo afirma o
// FORMATO da chave e o precedente do TikTok, mas NÃO afirma o que a Condição 1
// exige de fato — que o `productId` que CHEGA ao `shopeeCostId`, numa linha de
// variação, seja o composto. Se alguém implementar o catálogo por variação
// passando o id BASE, estes testes continuam verdes e a porta reabre em
// silêncio. Hoje isso é intestável: o código que passaria o id ainda não existe.
//
// A asserção que realmente tranca, para escrever quando ele existir:
//   dado um custo gravado em `item:<anúncio>` e uma linha de catálogo de
//   variação SEM `model_sku`, a busca de custo tem que devolver UNDEFINED —
//   nunca herdar o custo do anúncio.
//
// Enquanto isso não existe, o que está abaixo documenta a intenção. O risco de
// deixar assim sem dizer é o pior tipo: sensação de cobertura.
test("PORTA 1: a chave de custo da variação usa o id COMPOSTO, nunca o id base do anúncio", async () => {
  const fonte = await readFile(new URL("../src/lib/integrations/shopeeOverviewCanonical.ts", import.meta.url), "utf8");
  // A chave só tem dois formatos: `sku:<sku>` quando há SKU, `item:<produto>` quando não há.
  assert.match(fonte, /sku \? `sku:\$\{sku\}` : `item:\$\{productId\}`/);

  // O perigo: variação SEM model_sku cairia no fallback `item:<anuncio>` e
  // herdaria o custo do anúncio em silêncio — (b) degradando para (a) invisível
  // justamente nos 77% do catálogo que não têm SKU no nível do item.
  //
  // A trava é o id composto: quando o produto canônico for a variação, o
  // `productId` que chega aqui JÁ é o composto, então o fallback `item:` aponta
  // para a variação, não para o anúncio. Quem passar o id base quebra isto.
  const tiktok = await readFile(new URL("../src/lib/integrations/tiktokCanonical.ts", import.meta.url), "utf8");
  assert.match(tiktok, /externalProductId: tiktokVariantProductId\(productId, skuId\)/,
    "o TikTok é o precedente: id composto no catálogo E no item de pedido");
});

test("PORTA 2: a varredura de resgate NÃO atravessa o sub-namespace", async () => {
  for (const [caminho, prefixo] of [
    ["../src/lib/integrations/shopeeOverviewCanonical.ts", "\\$\\{namespace\\}:\\$\\{connectionId\\}:sku:"],
    ["../src/lib/integrations/mercadoLivre.ts", "mercado_livre:\\$\\{connectionId\\}:sku:"],
  ]) {
    const fonte = await readFile(new URL(caminho, import.meta.url), "utf8");
    // Tem que terminar em `sku:` — sem isso, uma entrada `item:` que carregue o
    // campo `sku` seria devolvida para a busca de uma variação, e o custo do
    // anúncio passaria a valer sem ninguém confirmar.
    assert.match(fonte, new RegExp(`entry\\.id\\.startsWith\\(\`${prefixo}\`\\)`),
      `${caminho}: a varredura precisa ficar dentro do sub-namespace sku:`);
    // E não pode existir a versão frouxa em lugar nenhum do arquivo.
    assert.doesNotMatch(fonte, /entry\.id\.startsWith\(`[^`]*\$\{connectionId\}:`\)/,
      `${caminho}: varredura entre sub-namespaces reaberta — ela herda custo sem confirmação`);
  }
});

test("as duas travas estão explicadas no código, não só no ADR", async () => {
  const shopee = await readFile(new URL("../src/lib/integrations/shopeeOverviewCanonical.ts", import.meta.url), "utf8");
  assert.match(shopee, /sugestão a confirmar|sugestao a confirmar/i);
  assert.match(shopee, /ADR-029/);
  const ml = await readFile(new URL("../src/lib/integrations/mercadoLivre.ts", import.meta.url), "utf8");
  assert.match(ml, /ADR-029/);
});

test("a decisão e as duas condições estão NA DECISÃO do ADR, não no rodapé", async () => {
  const adr = await readFile(new URL("../docs/adr/ADR-029-produto-canonico-e-a-variacao.md", import.meta.url), "utf8");
  const decisao = adr.slice(adr.indexOf("## Decisão"), adr.indexOf("## Consequências"));
  assert.ok(decisao.length > 0, "o ADR precisa ter uma seção de Decisão");
  assert.match(decisao, /id composto/i, "condição 1 fora da decisão");
  assert.match(decisao, /sub-namespace|namespace/i, "condição 2 fora da decisão");
  // O caso real que prova que a regra preserva trabalho com valor.
  assert.match(decisao, /2\.631/, "o custo órfão do anúncio com 2.631 vendas é o exemplo que sustenta o (b)");
});
