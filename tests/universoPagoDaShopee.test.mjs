import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// ⚠️ O UNIVERSO DO FATURAMENTO DA SHOPEE E O PEDIDO PAGO — e SO da Shopee.
//
// Decisao da dona do produto em 02/09/2026, verbatim: *"vai aparecer o que
// realmente entrou como venda na api da shopee, boleto em algum momento
// entraria, mas e diferente da amazon"*.
//
// 📌 O DEFEITO QUE ESTE ARQUIVO REPROVA nao e um numero errado — e a
// GLOBALIZACAO de uma regra de canal. A regra da casa (AGENTS.md, 02/09/2026):
// *"as apis tem seus proprios endpoints ... nao assuma regras de outros
// marketplaces como se fosse algo global"*. Medido nos dois canais:
//
//   Amazon  — Pending e venda FEITA com o valor OCULTO (a chave ItemPrice nem
//             vem no payload). Tirar do faturamento apagaria receita real.
//   Shopee  — UNPAID vem COM valor desde a criacao: 63 de 63 pedidos UNPAID em
//             60 dias tinham `gross`, zero sem. Aqui o que pode nao acontecer
//             e o PAGAMENTO.
//
// Mesma palavra ("pendente"), semantica oposta. Por isso o teste do canal que
// NAO muda vive aqui do lado: a prova que importa e que a mudanca ficou contida.
//
// ⚠️ ESTE ARQUIVO OLHA O FONTE, e fonte nao prova comportamento. A prova de
// COMPORTAMENTO contra Postgres esta em
// `tests-integracao/universoPagoDaShopee.test.mjs` — la os tres status entram no
// banco e o produtor responde. Aqui se prova o que fonte consegue provar: que a
// consulta usa o filtro do universo pago, e que a Amazon nao foi junto.
// As ancoras sao STRING LITERAL, sem recorte e sem regex montada — guarda burra
// que acerta vale mais que esperta que erra a fronteira (AGENTS.md).

const ler = (caminho) => readFile(new URL(caminho, import.meta.url), "utf8");

test("o faturamento da Shopee filtra pelo universo PAGO, nas tres colunas", async () => {
  const fonte = await ler("../src/lib/integrations/shopeeOverviewCanonical.ts");
  // As tres juntas: valor, contagem e o "sem valor" que deriva delas. Uma so
  // trocada deixaria o card e o numero ao lado em conjuntos diferentes, que e
  // a base misturada aparecendo na contagem.
  assert.ok(fonte.includes(
    `              SUM(gross) FILTER (WHERE status = ANY($6::text[])) AS faturamento,
              COUNT(*) FILTER (WHERE status = ANY($6::text[]))::int AS pedidos_faturados,
              COUNT(*) FILTER (WHERE status = ANY($6::text[]) AND gross IS NULL)::int AS sem_valor,`,
  ), "o faturamento da Shopee tem de sair do universo pago, nas tres colunas de uma vez");
});

test("o pendente da Shopee SAIU do faturamento e por isso ganhou numero proprio", async () => {
  const fonte = await ler("../src/lib/integrations/shopeeOverviewCanonical.ts");
  // Contrapartida obrigatoria: valor que sai do card sem deixar rastro e o que
  // faz a vendedora conferir a mao. `null` aqui seria o nulo mentiroso — o
  // canonico TEM o valor do pendente.
  assert.ok(fonte.includes(`              SUM(gross) FILTER (WHERE status = 'pending') AS pending_revenue,
              COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_orders,`),
    "sem pending_revenue a tela nao consegue dizer quanto saiu do faturamento");
  assert.ok(fonte.includes("      pendingRevenue: totals.pending_revenue == null ? null : Number(totals.pending_revenue),"),
    "o valor do pendente precisa chegar as metricas");
});

test("a tela da Shopee mostra o valor do pendente e diz quando ele entra", async () => {
  const tela = await ler("../src/app/components/ShopeeWorkspace.tsx");
  assert.ok(tela.includes("              valor: overview.metrics.pendingRevenue,"),
    "a legenda voltou a omitir o valor do pendente");
  // A frase e do CANAL: ela responde "por que este numero e menor do que eu
  // esperava" com o que fazer, sem a palavra "parcial" (AGENTS.md).
  assert.ok(tela.includes(
    'nota="O faturamento conta a venda paga; pedido aguardando pagamento entra quando o pagamento confirmar, na data do pedido.'),
    "a nota da Shopee tem de dizer que o pendente entra quando pagar");
});

test("A AMAZON NAO MUDOU — e este teste nao toca em nada da Shopee", async () => {
  // 📌 A guarda que prova a CONTENCAO. Se alguem "replicar a correcao" para a
  // Amazon, este teste fica vermelho antes de a vendedora ver receita sumir.
  const fonte = await ler("../src/lib/integrations/amazonOverviewCanonical.ts");
  assert.ok(fonte.includes("            AND status <> 'cancelled'\n          ORDER BY occurred_at DESC"),
    "a Amazon conta o pendente no faturamento: la o valor e que falta, nao a venda");
  // E a prova de que a contencao vale nos dois sentidos: o produtor da Amazon
  // nao importa nada do produtor da Shopee. Sem isto, "a Amazon nao mudou"
  // poderia ser verdade hoje e falso amanha por um import compartilhado.
  assert.ok(!/from\s+"\.\/shopee/.test(fonte),
    "o produtor da Amazon nao pode depender do da Shopee");
});
