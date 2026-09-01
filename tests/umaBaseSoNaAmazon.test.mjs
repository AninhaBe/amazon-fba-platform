import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { amazonFinancialCards } = await import("../src/app/amazon/amazonFinancialCards.ts");

// ═══ O DEFEITO QUE ESTE ARQUIVO REPROVA, com os numeros que ele teve ═════════
//
// 31/08/2026. O produtor passou a calcular o lucro sobre o FATURAMENTO inteiro
// (pendentes + confirmados) e esta camada continuou dividindo por `finance.revenue`,
// que e a receita APURADA. Numerador de um universo, denominador de outro:
//
//   conta A15NQMF7A6J1Y0: lucro -108,82 / base apurada  120,19 = -90,5% na tela,
//                         enquanto o lucro cobria R$ 456,86 de faturamento;
//   conta AO62LVXJMX3AA:  lucro   34,94 / base apurada   28,90 = +120,9% na tela,
//                         enquanto o lucro cobria R$ 73,12.
//
// Margem acima de 100% e margem abaixo de -90% eram o MESMO defeito visto pelos
// dois lados. A correcao e a decisao dela: "fazer o calculo em cima de tudo que
// e considerado faturamento (pendentes e confirmados). Apenas isso."
//
// COMO ESTE TESTE FOI VISTO VERMELHO (obrigatorio, AGENTS.md): trocando
// `input.baseDoLucro ?? f?.revenue` por `f?.revenue` em amazonFinancialCards.ts
// — que e literalmente o codigo de antes — os dois primeiros casos falham com
// -90.5 e 120.9, os numeros da tela dela. Desfazer a correcao reproduz o bug.

const base = {
  finance: {
    currency: "BRL",
    revenue: 120.19, // APURADO — o que a Amazon ja conciliou
    fees: 281.95,
    refunds: 0,
    orderCount: 14,
  },
  cogs: 277.72,
  unitsWithoutCost: 0,
  adsConectado: false,
  taxRate: 5,
  taxes: 22.84,
};

test("a margem sai da MESMA base do lucro, nao da receita apurada", () => {
  // O caso da conta do colega, com os numeros medidos no banco naquele instante.
  const cards = amazonFinancialCards({
    ...base,
    estimatedProfit: -108.82,
    baseDoLucro: 456.86, // o faturamento que o lucro cobre
    faturamentoTotal: 456.86,
  });
  const margem = cards.find((c) => c.key === "marginPct");
  // -108,82 / 456,86 = -23,8%. Com o denominador errado dava -90,5%.
  assert.equal(margem.raw.toFixed(1), "-23.8");
  assert.notEqual(margem.raw.toFixed(1), "-90.5");
});

test("margem NUNCA passa de 100% por causa de base menor que o lucro", () => {
  // O caso da conta dela no mesmo dia: lucro 34,94 sobre faturamento 73,12.
  // Com o denominador apurado (28,90) a tela exibia 120,9% — margem maior que
  // 100% e impossivel, e era o mesmo defeito pelo lado otimista.
  const cards = amazonFinancialCards({
    ...base,
    finance: { ...base.finance, revenue: 28.9, fees: 0, orderCount: 1 },
    cogs: 19.48,
    taxes: 0,
    taxRate: 0,
    estimatedProfit: 34.94,
    baseDoLucro: 73.12,
    faturamentoTotal: 73.12,
  });
  const margem = cards.find((c) => c.key === "marginPct");
  assert.equal(margem.raw.toFixed(1), "47.8");
  assert.ok(margem.raw < 100, `margem de ${margem.raw}% e impossivel`);
});

test("com as bases iguais, a declaracao SOME do card de lucro", () => {
  // Item 3 da especificacao dela: "a frase 'sobre X apurados de Y' SOME quando
  // as bases forem iguais — e elas passam a ser".
  const cards = amazonFinancialCards({
    ...base,
    finance: { ...base.finance, revenue: 28.9, fees: 0, orderCount: 1 },
    cogs: 19.48,
    taxes: 0,
    taxRate: 0,
    estimatedProfit: 34.94,
    baseDoLucro: 73.12,
    faturamentoTotal: 73.12,
  });
  const lucro = cards.find((c) => c.key === "profit");
  assert.equal(
    lucro.baseDeclarada,
    undefined,
    `bases iguais nao declaram nada, e veio: ${lucro.baseDeclarada}`,
  );
});

test("pedido sem valor publicado e APONTADO com numero, nunca somado como zero", () => {
  // AGENTS.md: nunca escrever "parcial" — dizer o que falta, com numero.
  const cards = amazonFinancialCards({
    ...base,
    estimatedProfit: -108.82,
    baseDoLucro: 456.86,
    faturamentoTotal: 456.86,
    pedidosSemValor: 19,
  });
  const lucro = cards.find((c) => c.key === "profit");
  assert.match(lucro.baseDeclarada ?? "", /19 pedidos sem valor publicado/);
  assert.doesNotMatch(lucro.baseDeclarada ?? "", /parcial|incompleto/i);
});

test("sem pedido sem valor, a frase do que falta NAO aparece", () => {
  const cards = amazonFinancialCards({
    ...base,
    estimatedProfit: -108.82,
    baseDoLucro: 456.86,
    faturamentoTotal: 456.86,
    pedidosSemValor: 0,
  });
  const lucro = cards.find((c) => c.key === "profit");
  assert.doesNotMatch(lucro.baseDeclarada ?? "", /sem valor publicado/);
});

test("a tarifa estimada e MARCADA na face do card, com quanto e de quantos pedidos", () => {
  // ADR-027 item 5. O concorrente exibe tarifa calculada sem marca nenhuma,
  // como se fosse oficial (medido no Gestor Seller em 31/08/2026); a marca e o
  // que nos separa dele, entao ela nao pode viver dentro do "i".
  const cards = amazonFinancialCards({
    ...base,
    estimatedProfit: -108.82,
    baseDoLucro: 456.86,
    faturamentoTotal: 456.86,
    feesEstimadas: 281.95,
    pedidosComTarifaEstimada: 28,
  });
  const taxas = cards.find((c) => c.key === "fees");
  assert.match(taxas.baseDeclarada ?? "", /281,95/);
  assert.match(taxas.baseDeclarada ?? "", /28 pedido/);
  assert.match(taxas.baseDeclarada ?? "", /liquida[çc][ãa]o/i);
});

test("sem NENHUM pedido estimado, a marca SOME", () => {
  const cards = amazonFinancialCards({
    ...base,
    estimatedProfit: -108.82,
    baseDoLucro: 456.86,
    faturamentoTotal: 456.86,
    feesEstimadas: 0,
    pedidosComTarifaEstimada: 0,
  });
  const taxas = cards.find((c) => c.key === "fees");
  assert.equal(taxas.baseDeclarada, undefined);
});

test("tarifa estimada de R$ 0,00 CONTINUA marcada — zero da fonte e um fato", () => {
  // Medido em 31/08/2026 na conta dela: a Product Fees API devolveu Success com
  // Amount 0 para os 3 pedidos do dia. Com a marca condicionada a `valor > 0` a
  // tela exibia lucro sem tarifa alguma e sem dizer que aquele zero e estimativa
  // — que a liquidacao pode substituir. Desfazer para `estimadas > 0` reprova.
  const cards = amazonFinancialCards({
    ...base,
    finance: { ...base.finance, revenue: 28.9, fees: 0, orderCount: 1 },
    cogs: 19.48,
    taxes: 0,
    taxRate: 0,
    estimatedProfit: 33.88,
    baseDoLucro: 73.12,
    faturamentoTotal: 73.12,
    feesEstimadas: 0,
    pedidosComTarifaEstimada: 3,
  });
  const taxas = cards.find((c) => c.key === "fees");
  assert.match(taxas.baseDeclarada ?? "", /R\$\s*0,00 de tarifa estimada/);
  assert.match(taxas.baseDeclarada ?? "", /3 pedido/);
});

test("o imposto sai da base do lucro, e nao da receita apurada", async () => {
  // Reprova a linha `amazonTaxAmount(processedRevenue, taxRate)`, que cobrava
  // 5% sobre 130,09 (R$ 6,50) enquanto o lucro descontava isso de uma receita
  // de R$ 456,86 — a mesma familia de defeito, na linha do imposto.
  //
  // Assercao sobre a RAMIFICACAO, nao sobre o identificador: casar
  // /amazonTaxAmount/ continuaria verde depois de alguem trocar o argumento de
  // volta, que e exatamente o defeito. Aqui exigimos o argumento certo.
  const fonte = await readFile(
    new URL("../src/lib/integrations/amazonOverviewCanonical.ts", import.meta.url),
    "utf8",
  );
  assert.match(fonte, /amazonTaxAmount\(\s*receitaDoLucro\s*,\s*taxRate\s*\)/);
  assert.doesNotMatch(fonte, /amazonTaxAmount\(\s*processedRevenue/);
});

test("a tarifa oficial SUBSTITUI a estimada na leitura — sem dupla contagem", async () => {
  // O que ninguem faz, e a razao de existir da ADR-027 (item 4 da spec dela).
  // Sem o NOT EXISTS, o pedido ja liquidado entrava com comissao real MAIS
  // comissao estimada, e o lucro caia por um custo que nao existe.
  //
  // Ramificacao, nao identificador: a consulta tem de EXCLUIR a estimativa de
  // quem ja tem tarifa real.
  const fonte = await readFile(
    new URL("../src/lib/integrations/amazonOverviewCanonical.ts", import.meta.url),
    "utf8",
  );
  const consultaDaEstimada = fonte.slice(
    fonte.indexOf("f.fee_type = 'estimated'"),
    fonte.indexOf("const feesEstimadas"),
  );
  assert.match(consultaDaEstimada, /NOT EXISTS/);
  assert.match(consultaDaEstimada, /fee_type NOT IN \('refund', 'estimated'\)/);
});

test("a base do faturamento traduz gross=0 em ausencia, nao em zero", async () => {
  // O sync grava `gross = 0.00` (nao NULL) enquanto a Amazon omite OrderTotal,
  // entao `COALESCE(gross, ordered_gross)` NUNCA caia para o preco de tabela:
  // 32 pendentes com preco conhecido somavam zero. Medido em 31/08/2026.
  const fonte = await readFile(
    new URL("../src/lib/integrations/amazonOverviewCanonical.ts", import.meta.url),
    "utf8",
  );
  assert.match(fonte, /COALESCE\(NULLIF\(o\.gross, 0\), o\.ordered_gross\)/);
});
