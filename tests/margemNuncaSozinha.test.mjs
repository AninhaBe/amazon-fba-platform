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
  ["src/app/amazon/page.tsx", "Amazon"],
  ["src/app/components/MercadoLivreWorkspace.tsx", "Mercado Livre"],
  ["src/app/components/TikTokWorkspace.tsx", "TikTok"],
];

test("as CINCO telas renderizam o sinal — uma copia esquecida e o defeito de sempre", async () => {
  for (const [caminho, nome] of TELAS) {
    const fonte = await readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
    assert.match(fonte, /<SinaisDoResultado sinais=/, `${nome}: o numero pode aparecer sem o sinal ao lado`);
    assert.match(fonte, /sinaisDoResultado\(/, `${nome}: nao monta os sinais`);
  }
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
