import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { amazonFinancialCards } from "../src/app/(app)/amazon/amazonFinancialCards.ts";

// DECISAO DELA, 31/08/2026, verbatim: "estorno reduz o resultado do periodo".
//
// Ate aqui os estornos nao entravam em lucro NENHUM. `fees` os exclui de
// proposito — devolucao ao comprador nao e tarifa, e soma-la como tarifa
// contaria a devolucao como custo operacional —, mas eles tambem nao entravam em
// nenhum outro termo. Medido: R$ 3.091,33 em 123 devolucoes fora da conta.
//
// ⚠️ PELA DATA DO PEDIDO, E POR FALTA DE DADO — NAO POR PREFERENCIA.
// `workspace_channel_order_fees` nao tem coluna de data: o estorno nao carrega
// data propria no nosso banco. A data real existe na Transactions API
// (`postedDate`) e nunca foi persistida. Quando existir, revisitar.

const carta = (cards, key) => cards.find((c) => c.key === key);
const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");

const consultaQueContem = (texto, marcador) => {
  const i = texto.indexOf(marcador);
  assert.ok(i > 0, `marcador ausente: ${marcador}`);
  const inicio = texto.lastIndexOf("SELECT", i);
  let nivel = 0;
  for (let k = inicio; k < texto.length; k += 1) {
    if (texto[k] === "(") nivel += 1;
    else if (texto[k] === ")") { nivel -= 1; if (nivel < 0) return texto.slice(inicio, k); }
  }
  return texto.slice(inicio);
};


const FINANCE = {
  currency: "BRL", revenue: 418.43, fees: 0, refunds: 0, buyerShipping: 0,
  orderCount: 22, feeBreakdown: [{ type: "commission", amount: 0 }],
};
const base = {
  finance: FINANCE, cogs: 154.49, estimatedProfit: 263.94, unitsWithoutCost: 0,
  faturamentoTotal: 1270.13, pedidosAguardando: 40,
};

test("o canonico SUBTRAI o estorno do lucro", async () => {
  const canonico = await fonte("src/lib/integrations/amazonOverviewCanonical.ts");
  // ⚠️ A FORMULA MUDOU DE NOME EM 31/08/2026, NAO DE CONTEUDO. A base passou a
  // ser o FATURAMENTO (apurado + pendente) e a tarifa passou a somar a estimada,
  // entao os termos viraram `receitaDoLucro`, `tarifaDoLucro` e `cogsDoLucro`.
  // O que este teste cobra continua sendo o mesmo: o estorno E termo da formula.
  assert.match(
    canonico,
    /receitaDoLucro - tarifaDoLucro - cogsDoLucro - \(taxes \?\? 0\) - refunds/,
    "o estorno precisa ser termo da formula, nao so um campo no payload",
  );
});

test("o estorno vem pela data do LANCAMENTO quando ela existe", async () => {
  // ⚠️ ESTE TESTE MUDOU DE INTENCAO EM 01/09/2026, e a mudanca era a que ele
  // mesmo mandava fazer. A versao anterior exigia o recorte pela data do PEDIDO,
  // e o comentario dizia por que: `workspace_channel_order_fees` nao tinha
  // coluna de data, a data real existia na Transactions API (`postedDate`) e
  // nunca fora persistida — "quando existir, revisitar".
  //
  // 📌 O TAMANHO DO QUE ESTAVA ERRADO, medido antes de consertar, sobre os 42
  // estornos de 60 dias da conexao amazon:A15NQMF7A6J1Y0:
  //   data de lancamento encontrada .... 42 de 42
  //   atraso pedido -> lancamento ...... minimo 1 dia, MEDIANA 11, maximo 44
  //   estornos que mudam de mes ........ 5, somando R$ 193,00
  // A mediana de 11 dias e o numero que importa: num recorte de "Hoje" ou
  // "7 dias" o estorno aparecia quase sempre num periodo em que nada aconteceu.
  //
  // O COALESCE preserva o comportamento antigo para a linha que ainda nao tem a
  // data — e por isso o apply da 0029 nao muda numero nenhum sozinho.
  const canonico = await fonte("src/lib/integrations/amazonOverviewCanonical.ts");
  const consulta = consultaQueContem(canonico, "f.fee_type = 'refund'");
  assert.match(consulta, /COALESCE\(f\.posted_at, o\.occurred_at\) >= \$4/,
    "o recorte do estorno tem de olhar a data do lancamento primeiro");
  assert.match(consulta, /COALESCE\(f\.posted_at, o\.occurred_at\) <= \$5/);
  // E a contagem de quantos JA tem a data, para a tela poder dizer.
  assert.match(consulta, /f\.posted_at IS NOT NULL/,
    "a tela precisa saber quantos estornos ja tem data propria");
});

test("a data do lancamento e PERSISTIDA, senao o leitor nunca a ve", async () => {
  // Ler `posted_at` sem grava-lo deixaria o COALESCE caindo sempre no fallback —
  // o conserto pareceria feito e nao mudaria nada. Foi por isso que a versao
  // anterior deste teste existia: a coluna nao existia, e o comentario era a
  // unica coisa que registrava a divida.
  const parser = await fonte("src/lib/transactions.ts");
  assert.match(parser, /refundPostedAt: string \| null;/, "o parser precisa expor a data");
  assert.match(parser, /entry\.refundPostedAt = transaction\.postedDate;/,
    "e precisa guardar a data do lancamento do estorno");
  const store = await fonte("src/lib/integrations/canonicalStore.ts");
  assert.match(store, /posted_at: fee\.postedAt \?\? null,/, "a gravacao precisa levar a data");
  assert.match(store, /posted_at = COALESCE\(EXCLUDED\.posted_at, workspace_channel_order_fees\.posted_at\)/,
    "data ja conhecida nao pode ser apagada por uma ingestao que veio sem ela");
});

test("o estorno vem pela data do PEDIDO quando o lancamento nao foi capturado", async () => {
  // A unica data disponivel. Se alguem trocar por uma data do proprio estorno
  // sem antes CAPTURAR essa data, estara inventando o campo.
  const canonico = await fonte("src/lib/integrations/amazonOverviewCanonical.ts");

  // ⚠️ ANCORA ESTRUTURAL, NAO JANELA DE CARACTERES (01/09/2026). Aqui estava
  // `canonico.slice(i, i + 200)`, e a guarda ficou VERMELHA quando a consulta do
  // estorno foi FUNDIDA com a da tarifa para economizar uma ida ao banco: o
  // recorte por data continuava la, correto, a 465 caracteres do marcador em vez
  // de 200. A guarda acusou quem melhorou o codigo.
  //
  // Distancia em caracteres e APARENCIA. O que este teste quer garantir e
  // ESTRUTURA: que o recorte por data esteja dentro da MESMA consulta que soma o
  // estorno. Entao a fatia agora vai do `SELECT` que abre a consulta ate o
  // parenteses que a fecha, contando niveis — sobrevive a qualquer reescrita e so
  // fica vermelha se o recorte sumir de verdade.
  //
  // Padrao da Vitrine, caso 3 de docs/achado-guarda-que-depende-da-forma.md.
  const consulta = consultaQueContem(canonico, "f.fee_type = 'refund'");
  assert.match(consulta, /o\.occurred_at >= \$4 AND o\.occurred_at <= \$5/, "recorte pela data do pedido");
});

test("a tela AVISA quando o passado muda de valor, com numero", () => {
  // Numero que muda sozinho vira "esta errado" mesmo estando certo — aconteceu
  // duas vezes em 30/08 (anuncio e margem). Junho caiu R$ 1.877,31 por esta
  // decisao; quem leu junho antes precisa entender por que junho e outro agora.
  const cards = amazonFinancialCards({ ...base, refunds: 270.93, refundCount: 14 });
  const nota = carta(cards, "profit").baseDeclarada;
  assert.match(nota, /270,93/, "o valor devolvido precisa aparecer");
  assert.match(nota, /14 devolução/, "e quantas devolucoes sao");
  assert.match(nota, /pela data da venda/, "e por qual data, que e o que muda o passado");
  assert.doesNotMatch(nota, /parcial|incompleto/i);
});

test("sem devolucao a frase SOME — zero e fato, escrever zero e ruido", () => {
  const cards = amazonFinancialCards({ ...base, refunds: 0, refundCount: 0 });
  assert.doesNotMatch(carta(cards, "profit").baseDeclarada ?? "", /devolução/);
});

test("nenhum fee_type e gravado com sinal negativo", async () => {
  // ⚠️ O DEFEITO QUE ISTO REPROVA (achado em 31/08/2026): `shopee/refund` era o
  // UNICO tipo do banco inteiro gravado negativo — 129 de 129, contra 43 mil
  // linhas positivas em todos os outros canais e tipos. E
  // `shopeeOverviewCanonical` calcula `... - refunds`: com refunds negativo,
  // isso SOMAVA R$ 5.461,72 ao lucro em vez de subtrair.
  //
  // A formula estava certa e legivel. A convencao de sinal e que a traia — e um
  // numero errado que se decompoe direitinho e mais perigoso que um que nao
  // fecha. A convencao agora e uma so: POSITIVO = dinheiro que saiu da vendedora.
  const shopee = await fonte("src/lib/integrations/shopeeCanonical.ts");
  assert.match(shopee, /amount: Math\.abs\(round2\(Number\(value\)\)\)/,
    "o gravador da Shopee precisa normalizar o sinal");
  assert.match(shopee, /POSITIVO = DINHEIRO QUE SAIU DA VENDEDORA/,
    "a convencao precisa estar escrita onde alguem vai mexer");
});

test("a Shopee ja subtraia o estorno — nao duplicar o termo la", async () => {
  // Ela sempre teve `- refunds!` na formula, com `refunds_known` para o `null`.
  // O defeito dela era o SINAL, nao a ausencia do termo. Acrescentar um segundo
  // desconto teria descontado duas vezes.
  const shopee = await fonte("src/lib/integrations/shopeeOverviewCanonical.ts");
  // ⚠️ A ANCORA E `const estimatedProfit =`, NAO a condicao que vem depois.
  //
  // Aqui estava `"const estimatedProfit = financialComplete"`, e em 31/08/2026 a
  // condicao virou `componentesConhecidos` — a fatia ficou VAZIA, o `match`
  // devolveu zero e o teste ficou vermelho por uma renomeacao, sem que o defeito
  // que ele reprova (descontar estorno duas vezes) tivesse voltado.
  //
  // Teste que fica vermelho por motivo que nao e o produto ensina a ignorar
  // vermelho (AGENTS.md). A ancora agora e a atribuicao, que so muda se a
  // formula do lucro mudar de verdade.
  const inicio = shopee.indexOf("const estimatedProfit =");
  assert.notEqual(inicio, -1, "a formula do lucro da Shopee mudou de nome — reancore este teste");
  const formula = shopee.slice(inicio, shopee.indexOf("const marginPct = estimatedProfit"));
  assert.equal((formula.match(/refunds/g) ?? []).length, 1, "um desconto de estorno, nao dois");
});

test("ML e TikTok nao tem estorno — ausencia VERIFICADA, nao presumida", async () => {
  // ⚠️ A distincao importa: ausencia verificada e `0` (fato), ausencia
  // desconhecida seria `null`. Medido no banco em 31/08/2026 — os unicos
  // `fee_type` desses dois canais sao `commission` e `shipping_seller`, em
  // 39.782 + 34.259 + 10.128 + 1.002 linhas. Nenhuma de estorno.
  //
  // Se um dia aparecer `fee_type` de estorno neles, o termo entra — e este
  // comentario e o registro de que a ausencia foi medida, nao suposta.
  const ml = await fonte("src/lib/integrations/mercadoLivreOverviewCanonical.ts");
  const tiktok = await fonte("src/lib/integrations/tiktokOverviewCanonical.ts");
  for (const [nome, src] of [["mercadoLivre", ml], ["tiktok", tiktok]]) {
    assert.doesNotMatch(src, /fee_type = 'refund'/, `${nome} nao deveria consultar estorno: nao ha nenhum`);
  }
});
