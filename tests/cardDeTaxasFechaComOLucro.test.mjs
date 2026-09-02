import test from "node:test";
import assert from "node:assert/strict";
import { amazonFinancialCards } from "../src/app/(app)/amazon/amazonFinancialCards.ts";

// ⚠️ BUG B1 DA SPEC DE 02/09/2026, cobrado pela dona do produto:
//
//   "O card Taxas hoje mostra R$ 58,99 enquanto o Lucro está descontando
//    R$ 312,43 (58,99 + 253,44 estimados). O card DEVE exibir exatamente o mesmo
//    total usado no cálculo do lucro."
//
// O card lia `finance.fees` — a tarifa POSTADA, vinda do `feeBreakdown` — e o
// lucro subtraía o total da view, que inclui a estimada. Dois números para a
// mesma palavra, na mesma tela: quem soma os cards não chega no lucro exibido, e
// a diferença não aparece em lugar nenhum.
//
// 📌 É a MESMA doença do widget da Shopee, achada duas vezes em dois dias: dois
// consumidores dos mesmos números, cada um lendo de um universo. A diferença é
// que aqui os dois estão no MESMO card do MESMO painel.
//
// E o critério de aceite da seção 6 depende disto: "Faturamento − Custo − Taxas
// − Ads = Lucro, sem valor oculto".

const carta = (cards, key) => cards.find((c) => c.key === key);
const brl = (v) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

// Os números do print dela, verbatim.
const BASE = {
  finance: {
    currency: "BRL", revenue: 1000, fees: 58.99, refunds: 0, buyerShipping: 0,
    feeBreakdown: [{ type: "Commission", amount: 58.99 }],
  },
  cogs: 200,
  estimatedProfit: 487.57,
  unitsWithoutCost: 0,
  faturamentoTotal: 1000,
  baseDoLucro: 1000,
  feesDoLucro: 312.43,
  feesEstimadas: 253.44,
  pedidosComTarifaEstimada: 15,
};

test("o card de Taxas exibe o TOTAL que o lucro subtrai, nao so a postada", () => {
  const taxas = carta(amazonFinancialCards(BASE), "fees");
  assert.equal(taxas.raw, 312.43, "o card tem de mostrar o mesmo total do lucro");
  assert.equal(taxas.value, brl(312.43));
  assert.notEqual(taxas.raw, 58.99, "58,99 era so a tarifa postada — o lucro descontava 312,43");
});

test("a composicao vai NA FACE, em duas linhas: oficial e estimada", () => {
  // Pedido literal: "quebrar em duas linhas dentro do card: oficial R$ X e
  // estimada R$ Y, com o total em destaque". A soma das duas E o total, entao a
  // conta fecha lendo o proprio card.
  const nota = carta(amazonFinancialCards(BASE), "fees").baseDeclarada;
  assert.match(nota, /oficial/, "a parte postada precisa aparecer");
  assert.match(nota, /58,99/, "e com o valor");
  assert.match(nota, /estimada/, "a parte estimada precisa aparecer");
  assert.match(nota, /253,44/, "e com o valor");
  // 58,99 + 253,44 = 312,43 — a soma das duas linhas e o numero grande.
  assert.equal(+(58.99 + 253.44).toFixed(2), 312.43);
});

test("a frase diz quantos pedidos e o que acontece na liquidacao", () => {
  // Bug B3 da mesma secao: trocar "ainda nao liquidado" por algo que diga o
  // tamanho e o destino.
  const nota = carta(amazonFinancialCards(BASE), "fees").baseDeclarada;
  assert.match(nota, /15 pedidos/, "quantos pedidos tem tarifa estimada");
  assert.match(nota, /substitu/i, "e que a oficial substitui");
  assert.match(nota, /liquida/i, "na liquidacao");
  assert.doesNotMatch(nota, /ainda n[ãa]o liquidado/i, "a frase antiga nao dizia nem quanto nem o que fazer");
});

test("sem estimativa a composicao SOME — repetir o total e ruido", () => {
  const semEstimativa = amazonFinancialCards({
    ...BASE, feesDoLucro: 58.99, feesEstimadas: 0, pedidosComTarifaEstimada: 0,
  });
  const taxas = carta(semEstimativa, "fees");
  assert.equal(taxas.raw, 58.99);
  assert.doesNotMatch(taxas.baseDeclarada ?? "", /oficial .* estimada/,
    "sem estimativa as duas linhas diriam a mesma coisa que o total");
});

test("sem o total do produtor o card nao inventa — cai na tarifa postada", () => {
  // Periodos antigos e telas de teste podem nao informar `feesDoLucro`. Cair na
  // postada e o comportamento de antes, e e melhor que exibir vazio.
  const semTotal = amazonFinancialCards({ ...BASE, feesDoLucro: undefined });
  assert.equal(carta(semTotal, "fees").raw, 58.99);
});

test("A CONTA FECHA: faturamento menos custo menos taxas exibidas bate com o lucro", () => {
  // ⚠️ O criterio de aceite da secao 6, transformado em teste: "sem valor
  // oculto". Com o card mostrando 312,43, a subtracao que a vendedora faz de
  // cabeca chega no lucro exibido.
  const cards = amazonFinancialCards(BASE);
  const faturamento = carta(cards, "revenue").raw;
  const custo = carta(cards, "cogs").raw;
  const taxas = carta(cards, "fees").raw;
  const lucro = carta(cards, "profit").raw;
  assert.equal(+(faturamento - custo - taxas).toFixed(2), lucro,
    "a soma dos cards tem de dar o lucro exibido");
});

test("a PAGINA grava e le o total com o MESMO nome — o campo nao pode ser fantasma", async () => {
  // ⚠️ O DEFEITO QUE ISTO REPROVA, achado no print dela em 02/09/2026: o card
  // continuou mostrando R$ 58,99 e o texto ANTIGO mesmo com o conserto no ar.
  //
  // A causa: o estado gravava `feesDoLucro` e o construtor lia `profit.fees` —
  // um campo que NUNCA foi preenchido. O card caia no fallback (a tarifa
  // postada) e a composicao sumia, porque ela so aparece quando o total existe.
  //
  // 📌 E O COMPILADOR TINHA AVISADO: "Property 'fees' does not exist on type
  // ProfitData". Eu calei o aviso acrescentando `fees?: number` ao tipo em vez
  // de consertar a leitura. Campo opcional faz o erro sumir e o defeito ficar —
  // silenciar o compilador nao e o mesmo que resolver o que ele apontou.
  const { readFile } = await import("node:fs/promises");
  const pagina = await readFile(new URL("../src/app/(app)/amazon/page.tsx", import.meta.url), "utf8");
  const codigo = pagina
    .split("\n")
    .map((l) => l.replace(/\r$/, "").replace(/\s*\/\/.*$/, ""))
    .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("/*"))
    .join("\n");
  assert.ok(codigo.includes("feesDoLucro: payload.profit.fees,"),
    "o estado precisa GRAVAR o total vindo do produtor");
  assert.ok(codigo.includes("feesDoLucro: profit?.feesDoLucro ?? null,"),
    "e o construtor dos cards precisa LER o mesmo nome");
  // ⚠️ A PROIBICAO PRECISA DO DELIMITADOR: "profit?.fees" e PREFIXO de
  // "profit?.feesDoLucro", entao a versao sem o `??` reprovava a linha CERTA.
  // Guarda cuja string proibida e prefixo da string correta acusa o conserto.
  assert.ok(!codigo.includes("feesDoLucro: profit?.fees ??"),
    "ler `profit.fees` le um campo que ninguem grava — o card volta ao fallback");
  assert.ok(!codigo.includes("feesDoLucro: profit?.fees,"), "idem");
  // E o campo fantasma nao pode voltar ao tipo so para calar o compilador.
  assert.ok(!/^\s{2}fees\?: number;$/m.test(codigo),
    "`fees?` opcional em ProfitData existia so para silenciar o erro que apontava o defeito");
});
