import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { sinaisDoResultado, sinalObrigatorio, rodapeDasTaxas } from "../src/app/components/oQueFaltaNoResultado.ts";

// ⚠️ 30/08/2026 — DECISAO DA VENDEDORA, revertendo a nossa:
//
//   "as 3 unidades sem custo — ISSO NAO PODE EXISTIR. Tem que mostrar a margem
//    independente de se tem algo nao cadastrado. [...] O erro e do seller que
//    nao cadastrou o custo."
//
// Antes disso UMA unidade sem custo apagava lucro, margem e ROI do periodo
// inteiro nos quatro canais. Agora o numero aparece sempre — e por isso o SINAL
// deixou de ser cortesia e virou condicao: margem sem o custo de um SKU sai
// MAIOR que a verdade.

const CUSTO = { skusWithoutCost: 2, hrefDeCustos: "/shopee/produtos" };

test("SKU, nao unidade — a tela nao pode inflar a tarefa dela", () => {
  // Medido na UTILEIRA: 3 unidades sem custo eram 2 SKUs (um vendido 2x). Dizer
  // "3" pedia 50% mais trabalho do que existia.
  const [sinal] = sinaisDoResultado(CUSTO);
  assert.equal(sinal.texto, "2 SKUs sem custo cadastrado");
  assert.match(sinal.texto, /SKU/);
  assert.doesNotMatch(sinal.texto, /unidade/);
  assert.equal(sinal.href, "/shopee/produtos");
  assert.equal(sinal.tom, "acao");
});

test("singular e plural nao saem quebrados", () => {
  assert.equal(sinaisDoResultado({ ...CUSTO, skusWithoutCost: 1 })[0].texto, "1 SKU sem custo cadastrado");
});

test("canal sem sku na linha (TikTok) diz UNIDADE, e nao converte por chute", () => {
  const [sinal] = sinaisDoResultado({ unitsWithoutCost: 3, hrefDeCustos: "/tiktok/produtos" });
  assert.equal(sinal.texto, "3 unidades sem custo cadastrado");
  assert.equal(sinal.tom, "acao");
});

test("as DUAS causas dizem coisas diferentes: uma chama acao, a outra avisa", () => {
  const sinais = sinaisDoResultado({ ...CUSTO, ordersWithFees: 320, ordersProcessed: 9841 });
  assert.equal(sinais.length, 2, "faltando as duas coisas, as duas aparecem");
  const [custo, tarifa] = sinais;
  // Custo: ela resolve -> tem link e tom de acao.
  assert.equal(custo.chave, "custo");
  assert.equal(custo.tom, "acao");
  assert.ok(custo.href, "custo sem link deixa ela sabendo e sem poder resolver");
  // Tarifa: nossa fila -> SEM link, tom de progresso, e diz que muda sozinho.
  assert.equal(tarifa.chave, "tarifa");
  assert.equal(tarifa.tom, "progresso");
  assert.equal(tarifa.href, undefined, "link para o que ela nao resolve e ruido");
  assert.match(tarifa.texto, /320 de 9841/);
  assert.match(tarifa.texto, /ainda cai/, "o numero exibido e teto: so cai quando a tarifa entra");
});

test("custo vem antes da tarifa — o que ela resolve primeiro", () => {
  const sinais = sinaisDoResultado({ ...CUSTO, ordersWithFees: 1, ordersProcessed: 9 });
  assert.equal(sinais[0].chave, "custo");
});

test("nada faltando: nenhum sinal, e o numero fica limpo", () => {
  assert.deepEqual(sinaisDoResultado({ skusWithoutCost: 0, hrefDeCustos: "/x" }), []);
});

test("A REGRA INEGOCIAVEL: havendo pendencia, o numero exige sinal", () => {
  const sinais = sinaisDoResultado(CUSTO);
  assert.equal(sinalObrigatorio(18.4, sinais), true, "numero + pendencia => sinal obrigatorio");
  assert.equal(sinalObrigatorio(18.4, []), false, "sem pendencia nao ha o que sinalizar");
  assert.equal(sinalObrigatorio(null, sinais), false, "sem numero nao ha o que acompanhar");
});

test("o rodape das Taxas nunca fala em espera quando esta completo", () => {
  assert.doesNotMatch(rodapeDasTaxas({ feesComplete: true, ordersWithFees: 219, ordersProcessed: 219 }), /aguardando|extrato/i);
  assert.equal(rodapeDasTaxas({ feesComplete: false, ordersWithFees: 320, ordersProcessed: 9841 }), "tarifa de 320 de 9841 vendas");
});

// ---- as quatro telas ----------------------------------------------------

const TELAS = [
  ["src/app/components/ShopeeWorkspace.tsx", "Shopee"],
  ["src/app/components/ShopeeModulePage.tsx", "Shopee monitor"],
  ["src/app/(app)/amazon/page.tsx", "Amazon"],
  ["src/app/components/MercadoLivreWorkspace.tsx", "Mercado Livre"],
  ["src/app/components/TikTokWorkspace.tsx", "TikTok"],
];

/**
 * ⚠️ O MERCADO LIVRE SAIU DA LISTA DE CIMA EM 11/09/2026, e a
 * regra que ele tem de cumprir NAO mudou — mudou a peca que a cumpre.
 *
 * O que aconteceu: o redesign v3 substituiu os cartoes do ML e a faixa
 * `SinaisDoResultado` saiu do monitor a pedido dela (10/09) — o pedido era
 * contra o EMPILHAMENTO de avisos em banda larga, nao contra sinalizar a falta.
 * Na troca, a Margem do monitor ficou SOZINHA: `resultParcial` era calculado e
 * nao usado por ninguem. Casar `<SinaisDoResultado sinais=` no ML depois disso
 * so poderia levar de volta a faixa que ela mandou tirar.
 *
 * A regra continua sendo a do teste la de cima ("A REGRA INEGOCIAVEL"): havendo
 * pendencia, o numero exige sinal AO LADO. No v3 o sinal e a linha sob o numero
 * (`margemSub`), nas duas telas do canal. E o que esta guarda passa a exigir.
 *
 * ⚠️ A AMAZON ENTROU NESSA MESMA SITUACAO EM 12/09/2026, pela
 * ordem dela (*"replicar a mesma estrutura do mercado livre na amazon"*): o
 * PainelV3 substituiu o corpo do dashboard e a `SinaisDoResultado` saiu junto.
 * A regra e cumprida pela MESMA peca do ML — a linha sob o numero da Margem —, e
 * quem a monta e `margemDoPeriodoAmazon`. Por isso a Amazon sai da lista de
 * fonte e entra no teste de COMPORTAMENTO logo abaixo, que chama a funcao: e
 * asercao mais forte do que casar `<SinaisDoResultado` no arquivo.
 */
const TELAS_COM_FAIXA = TELAS.filter(([caminho]) =>
  !caminho.endsWith("MercadoLivreWorkspace.tsx") && !caminho.endsWith("amazon/page.tsx"));

test("as QUATRO telas de faixa renderizam o sinal — uma copia esquecida e o defeito de sempre", async () => {
  for (const [caminho, nome] of TELAS_COM_FAIXA) {
    const fonte = await readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
    assert.match(fonte, /<SinaisDoResultado sinais=/, `${nome}: o numero pode aparecer sem o sinal ao lado`);
    assert.match(fonte, /sinaisDoResultado\(/, `${nome}: nao monta os sinais`);
  }
});

test("no ML, a Margem nunca aparece sozinha — nas DUAS telas do canal", async () => {
  const ml = await readFile(new URL("../src/app/components/MercadoLivreWorkspace.tsx", import.meta.url), "utf8");
  // Sem comentario: as notas que explicam a troca citam `SinaisDoResultado` e
  // `resultParcial`, e casar o fonte cru aprovaria o comentario no lugar do codigo.
  const codigo = ml.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  // A fonte do sinal — os dois ramos: com falta, diz O QUE falta com numero;
  // sem falta, a declaracao da base.
  assert.match(codigo, /const margemSub = resultParcial\s*\?\s*`falta \$\{faltas\.join\(", "\)\}`/, "o ML parou de montar o que falta");

  // Dashboard: a coluna de Margem do PainelV3.
  assert.match(codigo, /margem: \{[\s\S]{0,400}?nota: margemSub,/, "dashboard: a Margem voltou a aparecer sem o sinal");

  // Monitor: o cartao de Margem. ⚠️ Casa a CHAMADA inteira — `nota={margemSub}`
  // solto continuaria verde se alguem o movesse para outro cartao, e o defeito
  // de 10/09 foi exatamente a Margem ficar sem ele.
  assert.ok(
    codigo.includes(`<ColunaDoMonitor
          rotulo="Margem"
          valor={percent(overview.profit.marginPct)}
          tom={overview.profit.marginPct == null ? "vazio" : overview.profit.marginPct < 0 ? "negativo" : "positivo"}
          nota={margemSub}
        />`),
    "monitor: a Margem voltou a aparecer sem o sinal",
  );
});

test("nenhuma tela volta a apagar a margem por causa de custo", async () => {
  // O defeito exato que a vendedora mandou remover: um flag de custo dentro da
  // expressao que decide se a margem vira travessao.
  const proibidos = [
    [/value=\{resultIncomplete \|\| overview\.profit\.marginPct/, "Shopee"],
    [/value=\{resultParcial \? "—"/, "Mercado Livre"],
    [/value=\{resultIncomplete\|\|profit\.marginPct==null/, "Shopee monitor"],
    [/result: costsIncomplete \? null/, "Amazon"],
  ];
  for (const [caminho, nome] of TELAS) {
    const fonte = await readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
    for (const [padrao, dono] of proibidos) {
      assert.ok(!padrao.test(fonte), `${nome}: voltou a travar a margem como ${dono} fazia`);
    }
  }
});

test("na Amazon, a Margem nunca aparece sozinha — a nota sai da FUNCAO", async () => {
  // QUAL DEFEITO ESTE TESTE REPROVA: o do ML em 10/09/2026, que custou dois dias
  // de Margem sozinha na tela — `resultParcial` era calculado e ninguem o
  // renderizava. A Amazon entrou na mesma forma em 12/09, e aqui a asercao e de
  // comportamento: chama a funcao e confere a saida, em vez de casar texto.
  const { margemDoPeriodoAmazon } = await import("../src/app/(app)/amazon/amazonPainelV3.ts");

  // 1. HAVENDO PENDENCIA, a nota diz O QUE falta — com a palavra "falta", que e
  //    o que transforma um numero otimista num numero com ressalva.
  const comFalta = margemDoPeriodoAmazon({ margemPct: 18.4, faltas: ["o custo de 2 SKUs"] });
  assert.match(comFalta.nota, /^falta o custo de 2 SKUs$/);
  assert.equal(comFalta.valor, "18,40%");

  // 2. SEM PENDENCIA, a nota e a declaracao da base — a margem nunca fica muda.
  const semFalta = margemDoPeriodoAmazon({ margemPct: 18.4, baseDoResultado: "sobre o faturamento do período" });
  assert.equal(semFalta.nota, "sobre o faturamento do período");

  // 3. E O NUMERO APARECE MESMO COM PENDENCIA — decisao dela em 30/08/2026, que
  //    e a razao de o sinal ter deixado de ser cortesia: apagar a margem foi o
  //    comportamento que ela mandou remover.
  assert.notEqual(comFalta.valor, "—", "a margem voltou a ser apagada por pendencia");
});
