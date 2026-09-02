import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// ⚠️ A SEGUNDA FORMA DA FAMILIA, achada pela vendedora em 01/09/2026 no Shopee.
//
// Ela somou os tres cards da tela — Faturamento R$ 15.734,08 menos Taxas
// R$ 4.306,24 menos Custo R$ 7.020,48 = R$ 4.407,36 — e o Lucro exibido era
// R$ 4.266,39. A diferenca de R$ 140,97 era o IMPOSTO, que nao tem card.
//
// E ao conferir a diferenca apareceu o defeito de verdade: o imposto incidia
// sobre `processedRevenue` (pagos + enviados, R$ 14.097,09) enquanto o lucro
// partia do FATURAMENTO (com os pendentes, R$ 15.734,08). Subestimado em
// ~R$ 16,37 — numerador de um universo, subtracao de outro.
//
// 📌 CHEGOU POR REPLICACAO INCOMPLETA, e essa e a licao: quando a base do lucro
// passou a ser o faturamento, o numerador se moveu e o imposto ficou para tras.
// Mover uma base exige mover TODO componente que incide sobre ela.
//
// 📌 E A VARREDURA REVERSA ACHOU O SEGUNDO CANAL: o Mercado Livre tinha o mesmo
// defeito, pelo mesmo motivo, e ninguem tinha reclamado dele. Amazon corrigida
// em 31/08; Shopee e ML aqui; TikTok ja estava correto (imposto e lucro leem o
// mesmo `revenue`). Os quatro canais conferidos antes de dar a familia por
// encerrada.

const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
const semComentario = (texto) =>
  texto
    .split("\n")
    .map((l) => l.replace(/\r$/, "").replace(/\s*\/\/.*$/, "").replace(/\s*--.*$/, ""))
    .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("/*"))
    .join("\n");

/** A variavel de que a formula do lucro parte, e a de que o imposto parte. */
async function basesDe(caminho, ancoraDoLucro) {
  const codigo = semComentario(await fonte(caminho));
  const imposto = /const tax(?:es)? = [^;]*?([A-Za-z_][A-Za-z0-9_.]*) \* tax_?[Rr]ate/.exec(codigo);
  const lucro = new RegExp(`const ${ancoraDoLucro} = [^;]*`).exec(codigo);
  assert.ok(imposto, `${caminho}: nao achei o calculo do imposto — reancore esta guarda`);
  assert.ok(lucro, `${caminho}: nao achei a formula do lucro — reancore esta guarda`);
  return { baseDoImposto: imposto[1], formulaDoLucro: lucro[0] };
}

test("SHOPEE: o imposto incide sobre a mesma base do lucro", async () => {
  const { baseDoImposto, formulaDoLucro } = await basesDe(
    "src/lib/integrations/shopeeOverviewCanonical.ts", "estimatedProfit");
  assert.equal(baseDoImposto, "faturamento");
  assert.match(formulaDoLucro, /faturamento -/,
    "o lucro tem de partir da mesma variavel que o imposto");
  assert.notEqual(baseDoImposto, "processedRevenue",
    "processedRevenue nao inclui o pendente; o faturamento inclui");
});

test("MERCADO LIVRE: idem — achado pela varredura, sem ninguem reclamar", async () => {
  const { baseDoImposto, formulaDoLucro } = await basesDe(
    "src/lib/integrations/mercadoLivreOverviewCanonical.ts", "estimatedProfit");
  assert.equal(baseDoImposto, "faturamentoDoLucro");
  assert.match(formulaDoLucro, /faturamentoDoLucro -/);
});

test("TIKTOK: ja estava correto — imposto e lucro leem o mesmo revenue", async () => {
  const codigo = semComentario(await fonte("src/lib/integrations/tiktokFinancialV2.ts"));
  assert.match(codigo, /const tax = taxKnown \? \+\(revenue! \* input\.taxRate! \/ 100\)/);
  assert.match(codigo, /const profit = complete \? \+\(revenue! -/,
    "o lucro parte do mesmo revenue do imposto");
});

test("nenhum canal calcula imposto sobre processedRevenue", async () => {
  // ⚠️ A guarda que vale para o futuro: `processedRevenue` continua existindo e
  // sendo util (e a receita ja conciliada), mas nao pode voltar a ser base de
  // imposto em canal nenhum enquanto o lucro partir do faturamento.
  for (const caminho of [
    "src/lib/integrations/shopeeOverviewCanonical.ts",
    "src/lib/integrations/mercadoLivreOverviewCanonical.ts",
    "src/lib/integrations/amazonOverviewCanonical.ts",
  ]) {
    // ⚠️ A GUARDA OLHA A DECLARACAO DO IMPOSTO DOS CARDS, nao o arquivo inteiro.
    //
    // Proibir a string no arquivo ficou vermelho com o codigo CERTO: o widget
    // "Repasses, taxas e lucro" da Shopee tem uma composicao PROPRIA, no universo
    // da receita paga, e ali `processedRevenue * taxRate` e exatamente o certo —
    // o widget mostra o imposto DA BASE DELE. Duas bases coexistindo e o desenho;
    // misturar as duas e que era o defeito.
    const codigo = semComentario(await fonte(caminho));
    const decl = /const tax(?:es)? = (?!.*ReceitaPaga)[^;]*;/.exec(codigo);
    if (decl) {
      assert.doesNotMatch(decl[0], /processedRevenue/, `${caminho}: imposto dos cards sobre a base errada`);
      assert.doesNotMatch(decl[0], /amazonTaxAmount\(processedRevenue/, `${caminho}: idem`);
    }
  }
});

test("a AMAZON continua com imposto sobre a base do lucro (corrigido em 31/08)", async () => {
  const codigo = semComentario(await fonte("src/lib/integrations/amazonOverviewCanonical.ts"));
  assert.match(codigo, /amazonTaxAmount\(receitaDoLucro, taxRate\)/,
    "o imposto da Amazon parte da base do lucro, nao da receita apurada");
});

test("o WIDGET da Shopee e coerente no proprio universo — centro e fatias", async () => {
  // ⚠️ O DEFEITO QUE ISTO REPROVA, achado pela vendedora em 01/09/2026: o widget
  // "Repasses, taxas e lucro" exibia no centro a receita paga (R$ 14.097,09) e
  // as fatias somavam R$ 15.734,08 — o universo total, com pendentes. O selo
  // dizia "Composicao completa" enquanto a composicao ESTOURAVA o todo em
  // R$ 1.636,99, exatamente o valor dos pendentes.
  //
  // 📌 Escrevi esta guarda DEPOIS de quebrar o codigo e ver as outras passarem:
  // trocar o lucro do widget pelo lucro do periodo, e o imposto do widget pelo
  // dos cards, reintroduzia a mistura inteira com TODAS as guardas verdes. Elas
  // cobriam a base dos CARDS; ninguem cobria a coerencia do widget.
  const codigo = semComentario(await fonte("src/lib/integrations/shopeeOverviewCanonical.ts"));

  // 1. O imposto do widget nasce da base DELE, nao da base dos cards.
  assert.match(codigo,
    /const impostoDaReceitaPaga = taxRateKnown \? \+\(processedRevenue \* taxRate! \/ 100\)/,
    "o imposto do widget tem de incidir sobre a receita paga, que e o centro dele");

  // 2. E o lucro do widget e o RESIDUO do universo dele — nunca `estimatedProfit`,
  //    que parte do faturamento e por isso nao fecha com o centro.
  const comp = /const composicaoDaReceitaPaga = \{[\s\S]*?\};/.exec(codigo);
  assert.ok(comp, "a composicao do widget sumiu — reancore esta guarda");
  assert.match(comp[0], /lucro: lucroDaReceitaPaga,/,
    "o lucro do widget e o residuo da receita paga, nao o lucro do periodo");
  assert.doesNotMatch(comp[0], /estimatedProfit/,
    "o lucro do periodo parte do faturamento e estoura o centro do widget");
  assert.match(comp[0], /taxes: impostoDaReceitaPaga,/,
    "e o imposto exibido e o do universo do widget");

  // 3. O residuo subtrai do CENTRO, e nao de outra receita.
  // ⚠️ ESTA ASSERCAO EXIGIA UM TERNARIO ate 02/09/2026 — o lucro so existia
  // quando os cinco componentes eram conhecidos. O ternario CAIU de proposito:
  // seis pedidos sem bandeira de evidencia (9.911 de 9.917) anulavam a
  // composicao inteira e produziam o balaio de R$ 192.791,03 na tela dela.
  // O que a guarda protege continua igual: o residuo parte do CENTRO do widget.
  assert.match(codigo, /const lucroDaReceitaPaga = \+\(processedRevenue/,
    "o residuo tem de partir da receita paga");
  // E o que falta passa a ser APONTADO com numero, em vez de anular o resto.
  assert.match(codigo, /pedidosSemApuracao: Math\.max\(0, ordersProcessed - Math\.min\(/,
    "cobertura incompleta se aponta com numero, nao apaga o que se sabe");
});

test("a TELA consome a composicao do widget, e nao os cards", async () => {
  // De nada adianta o produtor estar coerente se a tela montar as fatias com os
  // numeros do universo errado — que era exatamente o caso.
  //
  // ⚠️ ESTA GUARDA PRECISOU DE TRES TENTATIVAS, e as duas primeiras ficaram
  // VERDES com o defeito reintroduzido:
  //   1. recortar o bloco ate o primeiro `})}` — cortava no fechamento de um
  //      item do array, e a linha quebrada ficava fora da fatia;
  //   2. recortar contando parenteses — melhor, mas ainda terminava antes;
  //   3. e a versao com RegExp montada em template literal, onde `\b` vira
  //      BACKSPACE e a expressao deixa de casar o que promete.
  // Nenhuma das tres foi apanhada por leitura; as tres cairam ao RODAR A QUEBRA.
  //
  // Agora e comparacao de string literal, sem recorte e sem regex montada: chato,
  // e verificavel. Guarda esperta que erra a fronteira prova menos que guarda
  // burra que acerta.
  const fatiasDosCards = [
    "value: overview.profit.cogs }", "value: overview.profit.taxes }",
    "value: overview.profit.fees }", "value: overview.profit.sellerShipping }",
    "value: overview.profit.ads }", "value: overview.profit.taxesWithheld }",
    "value: overview.profit.refunds }",
    "value:profit.cogs}", "value:profit.taxes}", "value:profit.fees}",
    "value:profit.sellerShipping}", "value:profit.ads}",
    "value:profit.taxesWithheld}", "value:profit.refunds}",
  ];
  for (const caminho of [
    "src/app/components/ShopeeWorkspace.tsx",
    "src/app/components/ShopeeModulePage.tsx",
  ]) {
    const texto = await fonte(caminho);
    assert.ok(texto.includes("composicaoDaReceitaPaga.receita"), `${caminho}: o centro`);
    assert.ok(texto.includes("composicaoDaReceitaPaga.lucro"), `${caminho}: o residuo`);
    for (const fatia of fatiasDosCards) {
      assert.ok(!texto.includes(fatia), `${caminho}: a fatia veio dos cards — ${fatia}`);
    }
    assert.ok(!texto.includes("result:resultIncomplete?null:profit.estimatedProfit"),
      `${caminho}: o lucro do periodo estoura o centro do widget`);
    assert.ok(!texto.includes("result: resultIncomplete ? null : overview.profit.estimatedProfit"),
      `${caminho}: idem`);

    // ⚠️ E A LISTA DE FLUXO TAMBEM — o painel tem DOIS consumidores dos mesmos
    // numeros, e eu consertei so a rosquinha em 01/09/2026. A vendedora reprovou
    // no mesmo dia: a lista mostrava "Lucro estimado R$ 4.503" (universo total)
    // abaixo de uma "Receita paga" de R$ 14.097. DOIS CONSUMIDORES, DUAS GUARDAS.
    //
    // 📌 E AS ASSERCOES SAO POSITIVAS, nao proibicoes de string. Duas tentativas
    // com lista negativa reprovaram o codigo CERTO: `profit.revenueProcessed` e
    // `profit.marginPct` aparecem tambem nos CARDS DO TOPO, que falam do universo
    // total de proposito e devem continuar falando. Proibir a string no arquivo
    // nao distingue o card legitimo da linha errada — exigir o nome CERTO nas
    // linhas do painel, sim.
    for (const doPainel of [
      "composicaoDaReceitaPaga.receita",
      "composicaoDaReceitaPaga.lucro",
      "margemDaReceitaPaga",
    ]) {
      assert.ok(texto.includes(doPainel),
        `${caminho}: a lista de fluxo do painel nao usa ${doPainel}`);
    }
  }
});
