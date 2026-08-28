import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { cruzarComMargem } from "../src/lib/integrations/amazonAdsPorProduto.ts";

// Painel "Anúncios por produto" (frente de Ads, 28/08/2026): ACOS/ROAS DA FONTE
// ao lado da margem real que só o NEXO tem, com o veredito. Desenho aprovado
// pelo cérebro com três ajustes — os três estão travados aqui.

test("o cruzamento é por SKU, e produto sem margem conhecida sai com null (nunca 0)", () => {
  const anuncios = [
    { productId: "B01", sku: "TOM-P", title: "Tomada P", impressions: 100, clicks: 4, cost: 12, sales: 0, purchases: 0, acos: null, roas: null, currency: "BRL" },
    { productId: "B02", sku: "PROT-4", title: "Protetor", impressions: 50, clicks: 2, cost: 5, sales: 80, purchases: 2, acos: 6.2, roas: 16, currency: "BRL" },
    { productId: "B03", sku: null, title: "Sem SKU", impressions: 10, clicks: 1, cost: 2, sales: 0, purchases: 0, acos: null, roas: null, currency: "BRL" },
  ];
  const cruzado = cruzarComMargem(anuncios, [{ sku: "PROT-4", marginPct: 22 }, { sku: "OUTRO", marginPct: 10 }]);
  assert.equal(cruzado[0].margemRealPct, null, "SKU sem custo cadastrado não ganha margem inventada");
  assert.equal(cruzado[1].margemRealPct, 22);
  assert.equal(cruzado[2].margemRealPct, null, "sem SKU não há como casar com custo");
});

test("ACOS/ROAS agregados são média PONDERADA e só com venda — nunca soma de razão", async () => {
  const fonte = await readFile(new URL("../src/lib/integrations/amazonAdsPorProduto.ts", import.meta.url), "utf8");
  // Ponderação: ACOS pelo gasto, ROAS pela venda.
  assert.match(fonte, /SUM\(acos \* cost\)[\s\S]{0,120}SUM\(cost\) FILTER/);
  assert.match(fonte, /SUM\(roas \* sales\)[\s\S]{0,120}SUM\(sales\) FILTER/);
  // Sem pedido atribuído, a razão não tem significado: vira null.
  assert.match(fonte, /CASE WHEN SUM\(purchases\) > 0 AND SUM\(cost\) > 0/);
  assert.match(fonte, /CASE WHEN SUM\(purchases\) > 0 AND SUM\(sales\) > 0/);
  // E a leitura nunca chama a Amazon — lê a tabela da 0016.
  assert.match(fonte, /workspace_ad_product_metrics/);
  assert.doesNotMatch(fonte, /fetch\(/);
});

test("ajuste 1: 'margem desconhecida' vira pendência com link para AQUELE SKU", async () => {
  const tela = await readFile(new URL("../src/app/components/AnunciosPorProduto.tsx", import.meta.url), "utf8");
  assert.match(tela, /Custo não cadastrado — cadastrar este produto/);
  assert.match(tela, /href=\{`\/produtos\?q=\$\{encodeURIComponent\(linha\.sku \?\? linha\.productId\)\}`\}/,
    "o link cai no produto, não na lista inteira");
  // E a página de produtos precisa saber ler esse parâmetro.
  const produtos = await readFile(new URL("../src/app/produtos/page.tsx", import.meta.url), "utf8");
  assert.match(produtos, /useSearchParams\(\)\.get\("q"\)/);
  assert.match(produtos, /useState\(buscaInicial\)/);
});

test("ajuste 2: o SKU que LUCRA continua na tela — corte é por tamanho, nunca por situação", async () => {
  const tela = await readFile(new URL("../src/app/components/AnunciosPorProduto.tsx", import.meta.url), "utf8");
  // A ordenação põe o pior primeiro, mas 'lucra' está no mapa de peso (aparece).
  assert.match(tela, /lucra: 3/);
  // O corte é "ver todos", não filtro de situação.
  assert.match(tela, /Ver todos os \$\{avaliadas\.length\} produtos/);
  assert.doesNotMatch(tela, /filter\(.*situacao !== "lucra"/);
  assert.match(tela, /nunca por situação/, "a razão fica escrita para quem mexer depois");
});

test("ajuste 3: a janela do gasto aparece NA TABELA, não só no card", async () => {
  const tela = await readFile(new URL("../src/app/components/AnunciosPorProduto.tsx", import.meta.url), "utf8");
  assert.match(tela, /contabilizadoAte && <p className="channel-module-method">/);
  assert.match(tela, /quem lê\s*\n?\s*a tabela pode não ter lido o card/);
});

test("os rótulos de origem ficam: ACOS/ROAS da Amazon, margem do NEXO", async () => {
  const tela = await readFile(new URL("../src/app/components/AnunciosPorProduto.tsx", import.meta.url), "utf8");
  assert.match(tela, /ACOS <small>da Amazon<\/small>/);
  assert.match(tela, /ROAS <small>da Amazon<\/small>/);
  assert.match(tela, /Margem real <small>do NEXO: custo \+ tarifas<\/small>/);
});

test("zero da fonte não vira '0%' na tela: sem pedido atribuído, mostra —", async () => {
  const tela = await readFile(new URL("../src/app/components/AnunciosPorProduto.tsx", import.meta.url), "utf8");
  assert.match(tela, /linha\.purchases > 0 && linha\.acos != null \? percento\(linha\.acos\) : "—"/);
  assert.match(tela, /linha\.purchases > 0 && linha\.roas != null/);
  // Venda atribuída com zero pedido também não vira "R$ 0,00 de venda".
  assert.match(tela, /linha\.purchases > 0 \? `\$\{dinheiro\(linha\.sales, linha\.currency\)\} · \$\{linha\.purchases\}` : "—"/);
});
