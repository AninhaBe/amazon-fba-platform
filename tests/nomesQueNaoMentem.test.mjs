import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// ⚠️ NOME QUE PROMETE UMA COISA E GUARDA OUTRA CUSTA UMA VERIFICACAO FALHADA POR
// VEZ. Tres ocorrencias em dois dias (31/08 e 01/09/2026), cada uma com um custo
// diferente e nenhuma delas apanhada por teste ou por tipo:
//
//  1. `billing` — parecia "faturamento", e era a receita que o NOSSO BANCO
//     consegue valorizar. O ticket medio dividiu essa receita PARCIAL por TODAS
//     as vendas: R$ 12,89 / 19 = R$ 0,68 na tela, ao lado de um Faturamento de
//     R$ 348,07. O ticket real era R$ 18,32;
//  2. `workspace_ad_metrics` — parecia a tabela geral de anuncio, e o Mercado
//     Livre mora so em `workspace_ad_product_metrics`. Custou uma verificacao
//     de cura respondida como "nao consigo confirmar" quando a resposta certa
//     era "olhei a tabela errada";
//  3. `workspace_channel_offer_history.external_product_id` — o nome promete
//     ASIN e a coluna guarda SKU (CADARCO-BRANCO, nao B0GWFRV9RN). Um UPDATE
//     casado por ASIN atualizou ZERO linhas com 78 precos na mao, e NAO levantou
//     erro: UPDATE que nao casa nada e sucesso para o Postgres.
//
// O padrao dos tres: o nome e plausivel, o tipo nao distingue, e a falha e
// silenciosa. So a medicao do EFEITO denuncia — foi o contador de "linhas
// atualizadas" que pegou o terceiro.

const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
const semComentario = (texto) =>
  texto
    .split("\n")
    .map((l) => l.replace(/\r$/, "").replace(/\s*\/\/.*$/, "").replace(/\s*--.*$/, ""))
    .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("/*"))
    .join("\n");

test("o campo que NAO e faturamento nao se chama mais billing", async () => {
  const rota = semComentario(await fonte("src/app/api/amazon/dashboard/route.ts"));
  assert.match(rota, /receitaValorizadaPeloBanco: \{ revenue: faturamento/,
    "o produtor precisa emitir o nome que diz o que o numero e");
  assert.doesNotMatch(rota, /^\s*billing: \{/m,
    "o nome antigo prometia faturamento e entregava a receita que o banco valoriza");
});

test("a pagina consome o nome novo, e nao sobra referencia ao antigo", async () => {
  const pagina = semComentario(await fonte("src/app/(app)/amazon/page.tsx"));
  assert.match(pagina, /receitaValorizadaPeloBanco/);
  assert.doesNotMatch(pagina, /DashboardPayload\["billing"\]/);
  assert.doesNotMatch(pagina, /payload\.billing/);
});

test("o TICKET MEDIO nao volta a dividir a receita parcial por todas as vendas", async () => {
  // ⚠️ O DEFEITO CONCRETO: numerador de um conjunto (pedidos COM valor),
  // denominador de outro (TODOS os pedidos). E a familia das sete formas, no
  // ticket. A base do ticket tem de ser a MESMA do card de Faturamento.
  // ⚠️ A GUARDA OLHA A DEFINICAO, NAO O USO — e a primeira versao dela olhava o
  // uso e passou com o defeito reintroduzido. Trocar a FONTE de
  // `faturamentoDaTela` reintroduz o bug inteiro sem mudar uma letra no calculo
  // do ticket, porque o nome da variavel continua o mesmo. Casar o nome de uma
  // variavel nao prova de onde ela vem.
  // ⚠️ O TICKET SAIU DA TELA DA AMAZON EM 12/09/2026, com a tira de
  // indicadores complementares (ordem dela: *"replicar a mesma estrutura do
  // mercado livre na amazon"* — e o ML nao tem ticket). A guarda nao foi apagada
  // porque o defeito que ela reprova volta junto com o numero: ela passou a
  // cobrar a forma CERTA no dia em que alguem devolver o calculo.
  //
  // ⚠️ E A CONDICAO E A EXISTENCIA DO CALCULO, nao a do arquivo: o
  // `if` olha `const ticketMedio`, que e o que materializa o defeito. Enquanto
  // nao existir, nao ha numerador nem denominador para misturar.
  const pagina = semComentario(await fonte("src/app/(app)/amazon/page.tsx"));
  const i = pagina.indexOf("const ticketMedio");
  if (i > 0) {
    assert.match(pagina, /const faturamentoDaTela = pedidosFeitos\?\.revenue \?\? null;/,
      "a base do ticket tem de vir do orderMetrics (pedidosFeitos), que cobre TODOS os pedidos");
    const calculo = pagina.slice(i, i + 400);
    assert.match(calculo, /faturamentoDaTela/,
      "o ticket precisa usar a base da tela, nao a receita parcial");
    assert.doesNotMatch(calculo, /receitaValorizadaPeloBanco|billing/,
      "voltou a dividir a receita que o banco valoriza pelo total de vendas");
  }
});

test("a coluna que guarda SKU esta documentada onde alguem vai casar por ASIN", async () => {
  // Enquanto a coluna nao for renomeada (migration, e ela e do Delta), o minimo
  // e que quem escreve consulta contra ela encontre o aviso no caminho.
  const estimador = await fonte("src/lib/integrations/amazonTarifaEstimada.ts");
  const i = estimador.indexOf("workspace_channel_offer_history");
  assert.ok(i > 0, "a leitura do preco de anuncio sumiu — reancore esta guarda");
  const trecho = estimador.slice(Math.max(0, i - 700), i + 300);
  assert.match(trecho, /SKU/,
    "a consulta precisa avisar que a chave e SKU, nao ASIN");
  // E o join tem de ser por SKU mesmo.
  assert.match(estimador, /h\.external_product_id = i\.sku/,
    "casar por ASIN devolveria NULL em 100% das linhas, em silencio");
});
