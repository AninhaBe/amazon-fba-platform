import test from "node:test"; import assert from "node:assert/strict"; import fs from "node:fs";
import { shopeeModuleError, shopeeModuleHref, shopeeModuleQuery } from "../src/app/components/ShopeeModulesModel.ts";
test("Shopee module query isolates the selected workspace connection",()=>{const query=new URLSearchParams(shopeeModuleQuery("q=sku&days=15&unsafe=x&connection_id=old","shopee:new","inventory"));assert.equal(query.get("connection_id"),"shopee:new");assert.equal(query.get("q"),"sku");assert.equal(query.get("days"),"15");assert.equal(query.has("unsafe"),false)});
test("Shopee links preserve only supported visible state",()=>{const url=new URL(shopeeModuleHref("/shopee/catalogo","q=x&days=7&unsafe=x","shopee:1"),"http://x");assert.equal(url.searchParams.get("connection_id"),"shopee:1");assert.equal(url.searchParams.get("q"),"x");assert.equal(url.searchParams.has("unsafe"),false)});
test("Shopee connection and cost failures have explicit messages",()=>{assert.match(shopeeModuleError("CONNECTION_NOT_FOUND"),/workspace/);assert.match(shopeeModuleError("INVALID_COST"),/maior ou igual a zero/)});
test("Shopee navigation exposes only implemented module routes",()=>{const nav=fs.readFileSync(new URL("../src/app/components/Nav.tsx",import.meta.url),"utf8");for(const route of ["/shopee/monitor","/shopee/catalogo","/shopee/produtos","/shopee/estoque","/shopee/abc"])assert.match(nav,new RegExp(route));for(const unsupported of ["/shopee/ads","/shopee/calculadora","/shopee/criar"])assert.doesNotMatch(nav,new RegExp(unsupported))});
// ⚠️ 29/08/2026 — a assercao do `role="alert"` LITERAL saiu, e nao por
// afrouxamento: o editor deixou de recarregar a tela ao salvar e o aviso passou
// a ser um <small aria-live="polite"> que ESCALA para alerta so quando falha
// (antes, o alerta existia sempre no fonte). Procurar a string literal
// reprovaria o desenho novo sem provar nada sobre o comportamento — o mesmo
// erro registrado no ADR-017. O que se trava agora e a intencao: existe um
// campo de status anunciado, e a falha vira alerta.
test("Shopee cost editor preserves unknown values and exposes inline errors",()=>{
  const ui=fs.readFileSync(new URL("../src/app/components/ShopeeModulePage.tsx",import.meta.url),"utf8");
  // O CostEditor fica DEPOIS da Table no arquivo, entao a fatia vai dele ate o
  // fim — cortar em "function Table" dava intervalo negativo e string vazia,
  // e uma assercao sobre string vazia reprova sem informar nada.
  const inicio=ui.indexOf("function CostEditor");
  assert.notEqual(inicio,-1,"nao achei o CostEditor");
  const editor=ui.slice(inicio);
  assert.match(ui,/row\.cost==null\?""/);
  assert.match(editor,/aria-live="polite"/,"o estado do salvamento precisa ser anunciado");
  assert.match(editor,/role=\{falhou\?"alert":undefined\}/,"a falha precisa escalar para alerta");
  assert.match(editor,/aria-invalid=\{falhou\}/);
  assert.match(ui,/Custo desconhecido permanece/);
});
test("Shopee monitor forwards pagination and states exact incomplete coverage",()=>{const query=new URLSearchParams(shopeeModuleQuery("days=15&limit=100&offset=900","shopee:1","monitor"));assert.equal(query.get("limit"),"100");assert.equal(query.get("offset"),"900");const ui=fs.readFileSync(new URL("../src/app/components/ShopeeModulePage.tsx",import.meta.url),"utf8");assert.match(ui,/Exibindo/);assert.match(ui,/não representa o conjunto completo/);assert.match(ui,/body\.page\.returned/)});
test("Shopee dashboard selects connections and exposes profitability completeness",()=>{const ui=fs.readFileSync(new URL("../src/app/components/ShopeeWorkspace.tsx",import.meta.url),"utf8");assert.match(ui,/aria-label="Loja Shopee"/);assert.match(ui,/query\.set\("connection_id", selected\.id\)/);assert.match(ui,/profitabilityPage\.hasMore/);assert.match(ui,/Exibindo/);assert.match(ui,/next\.set\("offset", "0"\)/)});
test("Shopee modules distinguish provider issue from a genuinely empty workspace",()=>{const ui=fs.readFileSync(new URL("../src/app/components/ShopeeModulePage.tsx",import.meta.url),"utf8");assert.match(ui,/setProviderIssue\(issue\)/);assert.match(ui,/setConnections\(issue\?\[\]/);assert.match(ui,/issueContent\?<EmptyState/);assert.match(ui,/href="\/integracoes"/);const issueBranch=ui.slice(ui.indexOf("issueContent?<EmptyState"),ui.indexOf(":!selected&&!error"));assert.doesNotMatch(issueBranch,/Conecte uma loja|Conectar loja/)});

// ⚠️ 29/08/2026 — o filtro de atividade entrou no servidor e NINGUEM o
// alimentava: `shopeeModuleQuery` nao encaminhava `atividade`, entao o seletor
// e o "Ver todos" mudavam a URL e o servidor seguia aplicando o padrao.
// Filtro que so existe na barra de endereco e filtro que nao existe.
test("o filtro de atividade chega ao servidor nas telas de catalogo, estoque e custo", () => {
  for (const kind of ["catalog", "inventory", "costs"]) {
    const q = new URLSearchParams(shopeeModuleQuery("atividade=todos&offset=50", "shopee:1", kind));
    assert.equal(q.get("atividade"), "todos", `${kind}: atividade nao encaminhada`);
    // E a paginacao continua junto — foi assim que o defeito apareceu na tela:
    // a pessoa troca o recorte, a lista nao muda, e "Proxima" parece nao andar.
    assert.equal(q.get("offset"), "50", `${kind}: offset nao encaminhado`);
  }
  // "ativos" e o padrao do servidor: a tela o representa OMITINDO o parametro,
  // entao ausencia aqui e correto e nao deve virar `atividade=ativos`.
  const padrao = new URLSearchParams(shopeeModuleQuery("offset=50", "shopee:1", "costs"));
  assert.equal(padrao.has("atividade"), false);
  // A curva ABC nao pagina nem filtra por atividade — nao deve receber nenhum dos dois.
  const abc = new URLSearchParams(shopeeModuleQuery("atividade=todos&offset=50", "shopee:1", "abc"));
  assert.equal(abc.has("atividade"), false);
  assert.equal(abc.has("offset"), false);
});

// Pedido da dona (29/08/2026): "que na tela de produtos tenha um filtro de
// selecionar em ordem de maior pro menor por volume de vendas nos ultimos 30
// dias pra ficarem no topo todos os SKUs que eu preciso cadastrar custo".
test("a ordenacao por volume e o PADRAO e a antiga continua disponivel", async () => {
  const { readFile } = await import("node:fs/promises");
  const servidor = await readFile(new URL("../src/lib/integrations/shopeeModules.ts", import.meta.url), "utf8");
  // Padrao = volume; so "titulo" tira dele.
  assert.match(servidor, /params\.get\("ordenacao"\) === "titulo" \? "titulo" : "volume"/);
  // ⚠️ A protecao que custou uma rodada de teste: ORDER BY x DESC no Postgres e
  // NULLS FIRST, entao sem COALESCE os anuncios SEM VENDA subiam ao topo — o
  // exato oposto do pedido. Este assert impede a regressao.
  assert.match(servidor, /ORDER BY unidades_30d DESC/);
  assert.doesNotMatch(servidor, /ORDER BY v\.unidades DESC/);
  // A coluna que ordena e COALESCE'd na propria definicao, entao nao existe NULL
  // para subir ao topo. A protecao mudou de lugar, nao sumiu.
  assert.match(servidor, /COALESCE\(CASE WHEN NULLIF\(TRIM\(p\.sku\)[\s\S]*?\)::int unidades_30d/);

  // ⚠️ 29/08/2026 — A VENDA SE PRENDE AO SKU, NAO AO ID DO ANUNCIO.
  // Juntar por external_product_id quebrou quando o catalogo passou a ter uma
  // linha por variacao com id composto: o item de pedido antigo tem o id BASE, e
  // so 401 de 22.589 itens (1,8%) estavam no formato novo. MESA-INFANTIL-ROSA
  // mostrava 13 unidades quando o real sao 576 — e como este numero ORDENA a
  // tela, o TAPETE de 62 ficava acima da VERDE de 747.
  assert.match(servidor, /LEFT JOIN por_sku s ON s\.sku = NULLIF\(TRIM\(p\.sku\),''\)/);
  assert.doesNotMatch(
    servidor,
    /AND i\.external_product_id=p\.external_product_id/,
    "juntar venda com anuncio por id volta a enxergar so 1,8% da venda do periodo"
  );
  // A contagem sai do NOSSO canonico, nunca da Shopee, e so de venda que valeu.
  assert.match(servidor, /workspace_channel_order_items/);
  assert.match(servidor, /interval '30 days'/);
  assert.match(servidor, /ARRAY\['paid','shipped','delivered'\]/);

  const tela = await readFile(new URL("../src/app/components/ShopeeModulePage.tsx", import.meta.url), "utf8");
  // O numero que ordena aparece NA LINHA — ordem que nao se explica nao se usa.
  assert.match(tela, /\["unidades30d","Vendidas \(30 dias\)"\]/);
  // "N variacoes" e informacao, NAO bloqueio: o campo de custo continua editavel.
  assert.match(tela, /variacoes>1&&/);
  assert.match(tela, /variações neste anúncio/);
  assert.doesNotMatch(tela, /disabled=\{[^}]*variacoes/);
  // O seletor mantem a ordem antiga.
  assert.match(tela, /<option value="titulo">Nome do produto<\/option>/);
});
