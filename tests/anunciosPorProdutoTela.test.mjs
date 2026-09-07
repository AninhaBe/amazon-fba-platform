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
  assert.match(tela, /href=\{`\$\{baseDeProdutos\}\?q=\$\{encodeURIComponent\(linha\.sku \?\? linha\.productId\)\}`\}/,
    "o link cai no produto, não na lista inteira — e na página de custo DO CANAL");
  // E a página de produtos precisa saber ler esse parâmetro.
  const produtos = await readFile(new URL("../src/app/(app)/produtos/page.tsx", import.meta.url), "utf8");
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

test("os rótulos de origem ficam — e agora dizem O CANAL, porque o painel é o mesmo nos dois", async () => {
  const tela = await readFile(new URL("../src/app/components/AnunciosPorProduto.tsx", import.meta.url), "utf8");
  // O nome do canal entra no rótulo; a margem continua sendo nossa em todos.
  assert.match(tela, /ACOS <small>d\{canal === "Amazon" \? "a" : "o"\} \{canal\}<\/small>/);
  assert.match(tela, /ROAS <small>d\{canal === "Amazon" \? "a" : "o"\} \{canal\}<\/small>/);
  assert.match(tela, /Margem real <small>do NEXO: custo \+ tarifas<\/small>/);
  // E o padrão continua sendo Amazon, para a tela que já existia não mudar.
  assert.match(tela, /canal = "Amazon"/);
  assert.match(tela, /baseDeProdutos = "\/produtos"/);
});

test("TRÊS estados de vazio, porque eles não significam a mesma coisa", async () => {
  const tela = await readFile(new URL("../src/app/components/AnunciosPorProduto.tsx", import.meta.url), "utf8");
  // (3) O caso REAL da conta da vendedora: anúncios cadastrados, zero veiculação.
  assert.match(tela, /const tudoZerado = !semLinha && linhas\.every\(\(linha\) => linha\.cost <= 0 && linha\.clicks <= 0 && linha\.impressions <= 0\)/);
  assert.match(tela, /title="Anúncios sem veiculação no período"/);
  assert.match(tela, /nenhum recebeu impressão ou clique no período — não houve gasto/);
  // (2) Conectada, mas o sync ainda não trouxe métrica: é outra frase.
  assert.match(tela, /title="Nenhum dado de anúncio no período"/);
  assert.match(tela, /A sincronização ainda não trouxe métricas/);
  // O motivo de existirem três, escrito para quem mexer depois.
  assert.match(tela, /eles NÃO significam a mesma coisa/);
});

test("o ML mostra anuncios com a origem e a pagina de custo do canal", async () => {
  // ⚠️ INTENCAO REDIRECIONADA (07/09/2026), nao afrouxada. Ate aqui
  // esta guarda exigia que o ML usasse o painel COMPARTILHADO
  // `AnunciosPorProduto`. O canvas do Caminho do Dinheiro trocou o painel pelo
  // card `AnunciosPagos`, que le os MESMOS campos do mesmo produtor e ainda
  // acrescenta o TACOS.
  //
  // O QUE ELA PROTEGE NAO MUDOU: a pagina de custo e a do CANAL (custo e por
  // (canal, SKU) — mandar para a pagina do canal errado seria pior que nao
  // linkar), e conta sem anuncio nao ganha secao vazia.
  const ml = await readFile(new URL("../src/app/components/MercadoLivreWorkspace.tsx", import.meta.url), "utf8");
  assert.match(ml, /href="\/mercado-livre\/produtos"/,
    "custo é por (canal, SKU): mandar para a página do canal errado seria pior que não linkar");
  assert.match(ml, /anunciosDoPeriodo\.length === 0 \? null :/,
    "conta que não anuncia voltou a ganhar seção vazia no dashboard");

  // O painel compartilhado continua de pe para quem ainda o usa.
  const amazon = await readFile(new URL("../src/app/(app)/amazon/page.tsx", import.meta.url), "utf8");
  assert.match(amazon, /<AnunciosPorProduto/, "a Amazon perdeu o painel compartilhado");

  // A leitura no servidor é a mesma, parametrizada por provider.
  const leitura = await readFile(new URL("../src/lib/integrations/amazonAdsPorProduto.ts", import.meta.url), "utf8");
  assert.match(leitura, /provider = "amazon"/, "o padrão preserva a chamada da Amazon");
  const rota = await readFile(new URL("../src/app/api/integrations/mercado-livre/overview/route.ts", import.meta.url), "utf8");
  assert.match(rota, /anunciosPorProdutoNoPeriodo\([\s\S]{0,80}"mercado_livre"\)/);
});

test("zero da fonte não vira '0%' na tela: sem pedido atribuído, mostra —", async () => {
  const tela = await readFile(new URL("../src/app/components/AnunciosPorProduto.tsx", import.meta.url), "utf8");
  assert.match(tela, /linha\.purchases > 0 && linha\.acos != null \? percento\(linha\.acos\) : "—"/);
  assert.match(tela, /linha\.purchases > 0 && linha\.roas != null/);
  // Venda atribuída com zero pedido também não vira "R$ 0,00 de venda".
  assert.match(tela, /linha\.purchases > 0 \? `\$\{dinheiro\(linha\.sales, linha\.currency\)\} · \$\{linha\.purchases\}` : "—"/);
});
