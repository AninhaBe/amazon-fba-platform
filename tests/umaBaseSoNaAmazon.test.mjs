import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { amazonFinancialCards } = await import("../src/app/(app)/amazon/amazonFinancialCards.ts");

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
  // ⚠️ A FRASE MUDOU DE PROPOSITO EM 01/09/2026, e este vermelho foi legitimo.
  // Ela dizia "ainda sem custo e tarifa apurados" e apontava o componente
  // ERRADO: o que falta nesses pedidos e o VALOR, que a Amazon nao publicou.
  // Custo e tarifa nos temos — a tarifa observada cobria 12 dos 13 ASINs do dia.
  // A frase antiga mandava cadastrar custo que ja estava cadastrado.
  // Este caso NAO informa `pedidosNaBase`, e a frase sai sem o denominador de
  // proposito: "19 de ?" seria pior que "19". O "N de M" tem guarda propria em
  // tests/margemNaoAfirmaSobreMinoria.test.mjs, onde o total e informado.
  assert.match(lucro.baseDeclarada ?? "", /^19 pedidos do período ainda sem valor publicado pela Amazon/);
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
  // ⚠️ A FRASE MUDOU DE PROPOSITO EM 01/09/2026, e este vermelho foi legitimo.
  // Ela dizia "ainda sem custo e tarifa apurados" e apontava o componente
  // ERRADO: o que falta nesses pedidos e o VALOR, que a Amazon nao publicou.
  // Custo e tarifa nos temos — a tarifa observada cobria 12 dos 13 ASINs do dia.
  // A frase antiga mandava cadastrar custo que ja estava cadastrado.
  assert.doesNotMatch(lucro.baseDeclarada ?? "", /ainda sem valor publicado/);
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

test("a leitura da Amazon NAO reproduz a regra de substituicao — quem decide e a view", async () => {
  // ⚠️ ESTE TESTE MUDOU DE INTENCAO EM 01/09/2026, e a garantia NAO enfraqueceu:
  // ela mudou de lugar, para um mais forte.
  //
  // ATE aqui ele exigia um NOT EXISTS DENTRO desta consulta — a regra de "o real
  // ganha do estimado" escrita em SQL na aplicacao. Com o apply da 0022 a regra
  // passou a viver na view workspace_channel_order_fees_efetivas, e a mesma
  // regra escrita em DOIS lugares e como as duas versoes divergem: no dia do
  // apply, a copia daqui estava ERRADA (substituia por pedido, nao por tipo).
  //
  // O que garante o comportamento agora e um teste COMPORTAMENTAL contra
  // Postgres: tests-integracao/viewDaTarifaEfetiva.test.mjs, que insere estimada
  // e real e confere o que a view devolve. Este aqui so cobra que a aplicacao
  // LEIA a view e nao reescreva a regra por fora.
  const fonte = await readFile(
    new URL("../src/lib/integrations/amazonOverviewCanonical.ts", import.meta.url),
    "utf8",
  );
  assert.match(fonte, /workspace_channel_order_fees_efetivas/, "a leitura tem de vir da view");
  // ⚠️ COMENTARIO NAO E CODIGO, e este teste ja ficou vermelho por isso: o
  // proprio comentario que EXPLICA a lista negra removida contem o texto dela.
  // Casar o fonte cru reprovaria a documentacao da correcao. Aqui as duas
  // formas de comentario saem antes da assercao.
  const codigo = fonte
    .split("\n")
    // ⚠️ O CARRIAGE RETURN SAI ANTES, e nao e detalhe (01/09/2026). Em JS o
    // ponto NAO casa carriage return — ele e terminador de linha —, entao num
    // arquivo salvo com CRLF a linha termina em CR e o removedor de comentario
    // nao casa NADA: ele vira no-op e a guarda acusa o proprio comentario que
    // documenta a correcao que ela existe para proteger. Foi o que aconteceu
    // aqui — vermelho por fim de linha, sem o produto ter mudado. Vermelho por
    // motivo que nao e o produto ensina a ignorar vermelho (AGENTS.md), entao o
    // consertado foi a FRAGILIDADE, nao a assercao.
    .map((linha) => linha.replace(/\r$/, "").replace(/\s*--.*$/, "").replace(/\s*\/\/.*$/, ""))
    .filter((linha) => !linha.trim().startsWith("*"))
    .join("\n");
  // ⚠️ A LISTA NEGRA MORREU. Blacklist e modo de falha invertido: fee_type novo
  // entraria somado como conhecido, sem ninguem decidir. A lista positiva vive
  // dentro da view.
  assert.doesNotMatch(
    codigo,
    /fee_type NOT IN \(/,
    "voltou uma lista negra de fee_type na aplicacao — a lista positiva mora na view",
  );
  // E a regra de supersessao nao pode ser reescrita aqui.
  assert.doesNotMatch(
    codigo,
    /NOT EXISTS \([\s\S]{0,40}SELECT 1 FROM workspace_channel_order_fees real/,
    "a regra do real-ganha-do-estimado voltou para a aplicacao",
  );
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

// ═══ A QUARTA FORMA DO MESMO DEFEITO (31/08/2026, 23:16) ════════════════════
//
// A base do lucro tinha virado a soma do BANCO (R$ 551,13) enquanto o card de
// Faturamento exibia o `orderMetrics` (R$ 1.017,98). As tarifas (281,95) e o
// custo (282,02) vinham dos 53 pedidos inteiros. Numerador de um universo com
// subtracoes de outro — de novo, pela quarta vez, na quarta forma.
//
// A vendedora fez a aritmetica na mao e estava certa:
//   1.017,98 - 281,95 - 282,02 = 454,01, POSITIVO.
// A tela mostrava -R$ 40,40 e margem -7,3%.
//
// Ordem dela, em caixa alta: "TEM QUE ESQUECER O APURADO E LEVAR EM
// CONSIDERACAO SOMENTE O FATURAMENTO."

test("a conta que ELA fez na mao fecha na tela", () => {
  // Sem imposto e sem ads, o lucro e exatamente faturamento - tarifas - custo.
  const cards = amazonFinancialCards({
    finance: { currency: "BRL", revenue: 551.13, fees: 281.95, refunds: 0, orderCount: 16 },
    cogs: 282.02,
    taxRate: null,
    taxes: null,
    adsConectado: false,
    unitsWithoutCost: 0,
    estimatedProfit: +(1017.98 - 281.95 - 282.02).toFixed(2),
    baseDoLucro: 1017.98,
    faturamentoTotal: 1017.98,
  });
  const lucro = cards.find((c) => c.key === "profit");
  const margem = cards.find((c) => c.key === "marginPct");
  assert.equal(lucro.raw, 454.01, "o lucro e o que sobra do FATURAMENTO");
  assert.ok(lucro.raw > 0, `1.017,98 - 281,95 - 282,02 e positivo, e veio ${lucro.raw}`);
  // 454,01 / 1.017,98 = 44,6%. Sobre a base apurada de 551,13 daria 82,4%.
  assert.equal(margem.raw.toFixed(1), "44.6");
});

test("nenhum card volta a declarar base apurada", () => {
  // ⚠️ O MECANISMO FOI APAGADO, nao so a frase: enquanto o conceito existir,
  // basta religar um `?? f?.revenue` para o defeito voltar — e ele voltou em
  // QUATRO formas diferentes no mesmo dia.
  const cards = amazonFinancialCards({
    finance: { currency: "BRL", revenue: 551.13, fees: 281.95, refunds: 0, orderCount: 16 },
    cogs: 282.02,
    taxRate: null,
    taxes: null,
    adsConectado: false,
    unitsWithoutCost: 0,
    estimatedProfit: 454.01,
    baseDoLucro: 1017.98,
    faturamentoTotal: 1017.98,
    pedidosSemValor: 19,
  });
  for (const card of cards) {
    // O proibido e a DECLARACAO DE DUAS BASES ("sobre X apurados de Y"), nao a
    // palavra solta: a frase do que falta usa "apurados" com outro sentido.
    assert.doesNotMatch(card.baseDeclarada ?? "", /apurados de/i, `card ${card.key} declara duas bases`);
    assert.doesNotMatch(card.context ?? "", /apurados de/i, `o "i" do card ${card.key} declara duas bases`);
  }
});

test("o codigo-fonte nao guarda mais o mecanismo da base apurada", async () => {
  // Ramificacao, nao identificador: o que nao pode voltar e a base cair para
  // `finance.revenue`. Enquanto essa expressao existir, alguem religa.
  const fonte = await readFile(
    new URL("../src/app/(app)/amazon/amazonFinancialCards.ts", import.meta.url),
    "utf8",
  );
  // A ramificacao, nao a palavra: o que nao pode voltar e a variavel SER DECLARADA
  // e a peca de declaracao SER CHAMADA. Comentario que conta a historia fica.
  assert.doesNotMatch(fonte, /const baseApuradas*=/, "a variavel voltou");
  assert.doesNotMatch(fonte, /declaracaoDeBase\(/, "a Amazon voltou a declarar base");
  assert.match(fonte, /const base = input\.baseDoLucro \?\? faturamentoExibido/);
});

test("os 19 pedidos sem valor sinalizam, e NAO encolhem a base", () => {
  const cards = amazonFinancialCards({
    finance: { currency: "BRL", revenue: 551.13, fees: 281.95, refunds: 0, orderCount: 16 },
    cogs: 282.02,
    taxRate: null,
    taxes: null,
    adsConectado: false,
    unitsWithoutCost: 0,
    estimatedProfit: 454.01,
    baseDoLucro: 1017.98,
    faturamentoTotal: 1017.98,
    pedidosSemValor: 19,
  });
  const margem = cards.find((c) => c.key === "marginPct");
  const lucro = cards.find((c) => c.key === "profit");
  // A base continua sendo o faturamento INTEIRO, com os 19 dentro.
  assert.equal(margem.raw.toFixed(1), "44.6");
  // E a tela diz o que falta, com numero, sem a palavra proibida.
  // ⚠️ A FRASE MUDOU DE PROPOSITO EM 01/09/2026, e este vermelho foi legitimo.
  // Ela dizia "ainda sem custo e tarifa apurados" e apontava o componente
  // ERRADO: o que falta nesses pedidos e o VALOR, que a Amazon nao publicou.
  // Custo e tarifa nos temos — a tarifa observada cobria 12 dos 13 ASINs do dia.
  // A frase antiga mandava cadastrar custo que ja estava cadastrado.
  assert.match(lucro.baseDeclarada ?? "", /19 pedidos do período ainda sem valor publicado pela Amazon/);
  assert.doesNotMatch(lucro.baseDeclarada ?? "", /parcial|incompleto/i);
});

test("a rota INJETA o faturamento no produtor, e nao o recalcula depois", async () => {
  // ⚠️ Recalcular o lucro na rota criaria uma SEGUNDA definicao de lucro da
  // Amazon — o defeito que o commit 21a0540 removeu. A base entra ANTES, no
  // unico lugar que calcula.
  const rota = await readFile(
    new URL("../src/app/api/amazon/dashboard/route.ts", import.meta.url),
    "utf8",
  );
  const iSales = rota.indexOf("getDailySales(period, defaultMarketplaceId())");
  const iCanon = rota.indexOf("getAmazonOverviewCanonicalCached(period");
  assert.ok(iSales !== -1 && iCanon !== -1, "as duas chamadas precisam existir");
  assert.ok(iSales < iCanon, "o faturamento tem de ser buscado ANTES do produtor");
  assert.match(rota, /faturamentoDoPeriodo: pedidosFeitos\?\.totalRevenue \?\? null/);
});

test("sem o faturamento injetado a base e null — nao o piso do banco", async () => {
  // ⚠️ ESTE TESTE MUDOU DE INTENCAO EM 01/09/2026, e o vermelho foi legitimo.
  //
  // ANTES ele exigia o fallback: `injetado > 0 ? injetado : pisoDoBanco`. Aquilo
  // resolvia a QUARTA forma — o lucro rodando sobre o piso enquanto o card
  // exibia o injetado — e estava certo para o mundo daquele dia.
  //
  // O que mudou: das CINCO rotas que chamam este produtor, UMA injeta. As outras
  // quatro recebiam o objeto `profit` inteiro com a base do piso (R$ 12,89 onde
  // o faturamento real era R$ 824,64), indistinguivel da base boa. Nenhuma
  // renderiza margem hoje, entao nao havia numero errado na tela — mas a
  // diferenca estava disponivel, esperando a primeira peca nova. Silencio e o
  // que transforma isso em defeito futuro.
  //
  // Agora a ausencia e EXPLICITA: quem for exibir decide o que fazer com `null`.
  // E a regra da casa — `null` != `0`, e desconhecido nao vira numero por
  // conveniencia.
  const fonte = await readFile(
    new URL("../src/lib/integrations/amazonOverviewCanonical.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    fonte,
    /const faturamentoDoLucro = baseCobreTodosOsPedidos/,
    "a base tem de sair do mesmo flag que governa custo e tarifa",
  );
  assert.match(fonte, /: null;/, "e cair em null quando nao ha faturamento injetado");
  // E o piso NAO pode voltar a ser a base por outro nome.
  const codigo = fonte
    .split("\n")
    .map((linha) => linha.replace(/\r$/, "").replace(/\s*--.*$/, "").replace(/\s*\/\/.*$/, ""))
    .filter((linha) => !linha.trim().startsWith("*"))
    .join("\n");
  assert.doesNotMatch(
    codigo,
    /faturamentoDoLucro\s*=[^;]*somaDoQueOBancoValoriza/,
    "o piso do banco voltou a ser usado como base",
  );
});

test("a chave do cache carrega a base — senao o radar envenena o dashboard", async () => {
  // ⚠️ radar, top-products e rentabilidade chamam o mesmo produtor SEM base.
  // Sem a base na chave, o primeiro deles gravaria um overview com o piso do
  // banco e o dashboard leria esse resultado — o defeito voltando por caminho
  // indireto, intermitente, dependente de quem chegou primeiro.
  const fonte = await readFile(
    new URL("../src/lib/integrations/amazonOverviewCanonical.ts", import.meta.url),
    "utf8",
  );
  assert.match(fonte, /amazon-overview-canonical:\$\{cacheScope\(\)\}:\$\{period\.key\}:\$\{base\}/);
});
