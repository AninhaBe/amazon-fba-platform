import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { amazonFinancialCards } from "../src/app/(app)/amazon/amazonFinancialCards.ts";

// ⚠️ A GUARDA DE PAGINA INTEIRA — o critério de aceite da seção 6 da spec dela,
// aplicado a todos os blocos de uma vez:
//
//   "Faturamento − Custo dos produtos − Taxas totais − Ads = Lucro. A conta tem
//    que fechar exatamente com os números exibidos nos cards, sem valor oculto."
//
// 📌 POR QUE ELA EXISTE (02/09/2026): a vendedora achou CINCO defeitos de
// coerência em dois dias, um por vez, cada um num print — margem de 91,7% sobre
// 1 pedido, lucro de 90% do faturamento, imposto sobre a base errada em dois
// canais, o widget da Shopee estourando o próprio todo, e o painel da Amazon com
// margem de 5673%. Consertar de um em um fez dela a auditora do produto.
//
// Esta guarda inverte isso: a próxima divergência fica vermelha aqui, antes de
// chegar na tela. É a ADR-028 executável.
//
// A tabela viva com fonte e universo de cada número está em
// `docs/auditoria-dashboard-amazon.md`, gerada por
// `scripts/auditar-dashboard-amazon.mjs` contra o banco real.

const carta = (cards, key) => cards.find((c) => c.key === key);
const fecha = (a, b) => Math.abs(Number(a ?? 0) - Number(b ?? 0)) < 0.02;

/** Um período com os três universos DIVERGENTES — é a única forma de exercitar. */
const CENARIO = {
  finance: {
    currency: "BRL", revenue: 12.89, fees: 58.99, refunds: 0, buyerShipping: 0,
    feeBreakdown: [{ type: "Commission", amount: 58.99 }],
  },
  // universo TOTAL: 50 pedidos, com pendentes
  faturamentoTotal: 1665.54,
  baseDoLucro: 1665.54,
  feesDoLucro: 487.77,
  feesEstimadas: 428.78,
  pedidosComTarifaEstimada: 42,
  pedidosDoPeriodo: 50,
  pedidosSemValor: 0,
  cogs: 446.50,
  taxes: 0,
  refunds: 0,
  estimatedProfit: 731.27,
  unitsWithoutCost: 0,
};

test("EQUACAO DOS CARDS: faturamento - custo - taxas - imposto - estorno = lucro", () => {
  // ⚠️ O CENARIO TEM OS UNIVERSOS DIVERGENTES DE PROPOSITO: `finance.revenue` e
  // 12,89 (conciliado) e a base e 1.665,54 (total). Com eles iguais, a equacao
  // fecharia por acaso mesmo com o defeito de volta — "dado que nao exercita a
  // regra nao testa a regra" (AGENTS.md).
  const cards = amazonFinancialCards(CENARIO);
  const soma = (carta(cards, "revenue").raw ?? 0)
    - (carta(cards, "cogs").raw ?? 0)
    - (carta(cards, "fees").raw ?? 0)
    - (carta(cards, "tax").raw ?? 0)
    - (carta(cards, "refunds").raw ?? 0);
  assert.ok(fecha(soma, carta(cards, "profit").raw),
    `os cards somam ${soma.toFixed(2)} e o lucro exibido e ${carta(cards, "profit").raw}`);
});

test("EQUACAO DAS TAXAS: o card exibe o total que o lucro usa — e SO o numero", () => {
  // ⚠️ ESTE TESTE MUDOU DE INTENCAO EM 02/09/2026, e o registro fica
  // porque a inversao e o ponto. Ele EXIGIA a decomposicao oficial/estimada no
  // card — que era pedido da dona, de ontem. Ela mesma reverteu, verbatim:
  // *"nao precisamos informar o que e oficial e o que e estimado. remove de
  // tudo essa palavra/card, ja dissemos as regras do que mostrar (numeros)"*.
  //
  // O QUE NAO MUDOU E O QUE O TESTE PROTEGE DE VERDADE: o card exibe o MESMO
  // total que o lucro desconta. Isso nunca dependeu do texto.
  const cards = amazonFinancialCards(CENARIO);
  const taxas = carta(cards, "fees");
  assert.ok(fecha(taxas.raw, CENARIO.feesDoLucro), "o card tem de exibir o total do lucro");
  // E o card NAO pode exibir a tarifa postada sozinha, que era o defeito B1.
  assert.ok(!fecha(taxas.raw, CENARIO.finance.fees), "58,99 era so a postada");
  // A decomposicao saiu: nem no texto do card, nem em selo.
  assert.ok(!/oficial|estimad/i.test(taxas.baseDeclarada ?? ""), "a decomposicao voltou ao card");
  assert.equal(taxas.marcaEstimativa, undefined, "o selo do agregado voltou ao card");
});

test("EQUACAO DA MARGEM: sai do lucro sobre a base do proprio bloco", () => {
  const cards = amazonFinancialCards(CENARIO);
  const margem = carta(cards, "marginPct");
  const esperada = (carta(cards, "profit").raw / carta(cards, "revenue").raw) * 100;
  assert.ok(fecha(margem.raw, esperada),
    "dividir por outra base foi o que produziu 5673% no painel e 91,7% no card");
});

test("EQUACAO DAS CONTAGENS: com valor + sem valor = pedidos do periodo", () => {
  const cards = amazonFinancialCards({ ...CENARIO, pedidosSemValor: 30, pedidosDoPeriodo: 50 });
  const nota = carta(cards, "marginPct").context;
  // O denominador exibido tem de ser o do periodo, e o texto tem de DIZER isso —
  // o hero conta vendas COM canceladas e sem a palavra os dois se contradizem.
  assert.match(nota, /30 de 50 pedidos do período/);
});

test("O ROTULO QUE CONTAVA CANCELADAS SAIU DA TELA — e o que ele protegia nao voltou", async () => {
  // O DEFEITO ORIGINAL: dois numeros certos e um nome errado. A tira de
  // indicadores contava 54 vendas (o que a Amazon chama de venda, canceladas
  // inclusive) ao lado de um lucro de 50 pedidos, e o rotulo dizia so "Vendas".
  // O conserto foi o NOME: "Vendas (com canceladas)".
  //
  // A TIRA INTEIRA SAIU EM 12/09/2026, por ordem dela ("replicar a mesma
  // estrutura do mercado livre na amazon"). Sem o par na tela nao ha nome para
  // desambiguar — e e isso que esta guarda passa a cobrar: que ele nao volte
  // SEM a ressalva. Registrada no relatorio da leva como remocao de proposito,
  // reversivel: o dado continua no cache do periodo.
  const codigo = (await readFile(new URL("../src/app/(app)/amazon/page.tsx", import.meta.url), "utf8"))
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const temContagemDeVendas = codigo.includes('label="Vendas');
  if (temContagemDeVendas) {
    assert.ok(codigo.includes('label="Vendas (com canceladas)"'),
      "a contagem de vendas voltou a tela e precisa dizer que inclui canceladas");
  }
});

test("O PAINEL do conciliado SAIU da tela da Amazon — e nenhum bloco novo mistura universo", async () => {
  // O QUE ESTA GUARDA COBRAVA: a rosquinha e a cascata escrita liam a
  // `composicaoDoConciliado` — receita, tarifa, custo e lucro do MESMO
  // subconjunto —, para o bloco fechar no universo que declarava (ADR-028).
  // Corrigir so um dos dois consumidores foi o erro que ela reprovou na Shopee.
  //
  // OS DOIS CONSUMIDORES SAIRAM EM 12/09/2026, juntos, quando o PainelV3
  // substituiu o corpo do dashboard por ordem dela. O que resta na tela e UM
  // bloco de numeros — a faixa do periodo —, e a base dele nao e a composicao
  // do conciliado: e `baseDoLucro`/`revenueDoLucro`, com a propria disciplina de
  // universo cobrada em `baseDaMargemUnica` e `margemNuncaSozinha`.
  //
  // ⚠️ ENTAO O QUE ESTA GUARDA FAZ AGORA E PROIBIR A VOLTA PELA
  // METADE: se alguem reintroduzir um consumidor da composicao, o outro tem de
  // vir junto. Meio bloco lendo a composicao e meio lendo `profit.finance` e
  // exatamente a mistura de universos que a ADR-028 proibe.
  const codigo = (await readFile(new URL("../src/app/(app)/amazon/page.tsx", import.meta.url), "utf8"))
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const daRosquinha = ["value: conciliadoDoPainel.tarifa", "value: conciliadoDoPainel.custo"];
  const daCascata = [
    "money(conciliadoDoPainel?.tarifa ?? profit?.finance.fees ?? 0, currency)",
    "money(conciliadoDoPainel?.custo ?? profit?.cogs ?? 0, currency)",
  ];
  const temRosquinha = daRosquinha.some((t) => codigo.includes(t));
  const temCascata = daCascata.some((t) => codigo.includes(t));
  assert.equal(temRosquinha, temCascata,
    "a composicao do conciliado voltou para um consumidor so — os dois leem a MESMA base ou nenhum le");
});

test("a ADR-028 e a tabela da auditoria existem e se citam", async () => {
  // Guarda de documentação: a decisão e a tabela viva são o que impede a próxima
  // pessoa de reintroduzir a mistura por não saber que ela foi decidida.
  const adr = await readFile(new URL("../docs/adr/ADR-028-cada-bloco-fecha-no-universo-que-declara.md", import.meta.url), "utf8");
  assert.match(adr, /resíduo do universo que (ele )?declara/i);
  assert.match(adr, /auditoria-dashboard-amazon/, "a ADR cita a tabela viva");
  const auditoria = await readFile(new URL("../docs/auditoria-dashboard-amazon.md", import.meta.url), "utf8");
  assert.match(auditoria, /CONCILIADO/, "a tabela precisa dizer o universo de cada numero");
  assert.match(auditoria, /auditar-dashboard-amazon\.mjs/, "e apontar o script que a regenera");
});
