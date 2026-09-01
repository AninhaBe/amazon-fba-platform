import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { amazonFinancialCards } from "../src/app/amazon/amazonFinancialCards.ts";
import { procedenciaDaEstimativa } from "../src/app/components/procedenciaDaEstimativa.ts";

const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
const carta = (cards, key) => cards.find((c) => c.key === key);

const FINANCE = { currency: "BRL", revenue: 39.8, fees: 6.12, refunds: 0, promotions: 0, buyerShipping: 0, feeBreakdown: [] };

// O DEFEITO QUE ESTE ARQUIVO REPROVA — ADR-027, emenda de 31/08/2026.
//
// O concorrente (Gestor Seller, medido na conta Crystal Fancy) mostra comissao
// e FBA calculados por tabela SEM MARCA NENHUMA, como se fossem oficiais, e
// nunca substitui pelo extrato: o pedido 702-9124025-9780207, aprovado em 10/08,
// seguia com 12,01% de tabela tres semanas depois. Se a nossa tela exibir o
// numero estimado sem marca, adotamos o defeito deles — a marca e a substituicao
// sao a vantagem, nao o numero.

test("a marca so existe quando ha pedido estimado", () => {
  const semEstimativa = amazonFinancialCards({ finance: FINANCE, cogs: 13.64, estimatedProfit: 20.04, unitsWithoutCost: 0 });
  assert.equal(carta(semEstimativa, "fees").marcaEstimativa, undefined, "marca permanente vira decoracao");

  const comEstimativa = amazonFinancialCards({
    finance: FINANCE, cogs: 13.64, estimatedProfit: 20.04, unitsWithoutCost: 0,
    feesEstimadas: 4.31, pedidosComTarifaEstimada: 2,
  });
  assert.match(carta(comEstimativa, "fees").marcaEstimativa, /liquida[çc][ãa]o/);
});

test("estimativa de valor ZERO continua marcada", () => {
  // Medido em 31/08/2026 na conta AO62LVXJMX3AA: a Product Fees API respondeu
  // Status Success com Amount 0 nos tres pedidos do dia. Com a condicao em
  // "valor > 0" a marca sumia e a tela mostrava lucro sem tarifa nenhuma, sem
  // dizer que aquele zero e estimativa que a liquidacao pode substituir.
  const cards = amazonFinancialCards({
    finance: FINANCE, cogs: 13.64, estimatedProfit: 20.04, unitsWithoutCost: 0,
    feesEstimadas: 0, pedidosComTarifaEstimada: 3,
  });
  assert.ok(carta(cards, "fees").marcaEstimativa, "zero publicado pela fonte continua sendo estimativa");
});

test("o selo e a frase nascem e somem JUNTOS", () => {
  // Separa-los criaria o estado em que o numero esta marcado e nada explica a
  // marca — ou o inverso, a frase sem o selo, que foi o estado ate hoje.
  for (const pedidos of [0, 1, 5]) {
    const fees = carta(amazonFinancialCards({
      finance: FINANCE, cogs: 13.64, estimatedProfit: 20.04, unitsWithoutCost: 0,
      feesEstimadas: 1.5, pedidosComTarifaEstimada: pedidos,
    }), "fees");
    assert.equal(Boolean(fees.marcaEstimativa), Boolean(fees.baseDeclarada), `pedidos=${pedidos}`);
  }
});

test("a procedencia diz de onde veio e que o oficial substitui — nunca 'parcial'", () => {
  const completa = procedenciaDaEstimativa({ comissao: 3.47, fba: 5.65 });
  assert.match(completa, /comiss[ãa]o R\$\s?3,47/);
  assert.match(completa, /FBA R\$\s?5,65/);
  assert.match(completa, /oficial entra na liquida[çc][ãa]o/);

  // Parcela ausente NAO vira zero (AGENTS.md) e nao apaga a explicacao.
  const soComissao = procedenciaDaEstimativa({ comissao: 3.47, fba: null });
  assert.ok(!/FBA/.test(soComissao), "FBA desconhecido nao pode virar 'FBA R$ 0,00'");
  assert.match(soComissao, /liquida[çc][ãa]o/);

  const semDetalhe = procedenciaDaEstimativa({});
  assert.match(semDetalhe, /tabela da Amazon/);
  assert.match(semDetalhe, /liquida[çc][ãa]o/);

  for (const frase of [completa, soComissao, semDetalhe]) {
    assert.ok(!/parcial|incompleto/i.test(frase), "adjetivo que se desculpa e proibido");
  }
});

test("a tela RENDERIZA a marca, e a condicao e o campo do construtor", async () => {
  const pagina = await fonte("src/app/amazon/page.tsx");
  // Casar a RAMIFICACAO, nao o identificador: `MarcaDeEstimativa` continuaria
  // aparecendo no import depois de alguem apagar o uso.
  assert.match(
    pagina,
    /marca=\{card\.marcaEstimativa \? <MarcaDeEstimativa procedencia=\{card\.marcaEstimativa\} \/> : undefined\}/,
    "a marca saiu da face do card",
  );

  const metric = await fonte("src/app/components/Metric.tsx");
  // Colada ao NUMERO, dentro de `.metric-value` — nao no rodape nem em faixa.
  assert.match(metric, /metric-value\$\{toneCls\}[\s\S]{0,160}\{loading \? null : marca\}/);

  const css = await fonte("src/app/globals.css");
  assert.match(css, /\.marca-estimativa\s*\{/, "classe usada e nunca definida");
  // Nao pode usar o tom de alarme: estimativa nao e pendencia da vendedora.
  const bloco = css.slice(css.indexOf(".marca-estimativa"));
  assert.ok(!/var\(--danger\)|var\(--warning\)/.test(bloco.slice(0, 700)), "estimativa nao e alarme");
});

// ===== A MARCA NA LINHA DO PEDIDO (ADR-027 §2, ligada em 01/09/2026) =========
//
// O agregado ja marcava desde 91f35ab; a LINHA era a metade que dependia do
// contrato por pedido (b161b4f: feesEstimadas, comissaoEstimada, fbaEstimada).
// Sem ela, a Rentabilidade exibia margem calculada com tarifa de tabela sem
// dizer que era tabela — exatamente o que o concorrente faz e o que a ADR
// existe para NAO copiar.

test("a linha so marca quando a procedencia diz que e estimativa", async () => {
  const tabela = await fonte("src/app/components/OrderProfitabilityTable.tsx");
  // ⚠️ A condicao e o campo de PROCEDENCIA, nunca o valor. Zero estimado
  // continua estimado (Product Fees API respondeu Success com Amount 0 nos tres
  // pedidos de 31/08 na conta AO62LVXJMX3AA).
  assert.match(
    tabela,
    /function marcaDaLinha\(line: ProfitabilityLine\) \{\s*if \(!line\.feesEstimadas\) return null;/,
    "a linha voltou a decidir a marca por outra coisa que nao a procedencia",
  );
  assert.ok(
    !/comissaoEstimada\s*[><]|marketplaceFees\s*[><]\s*0/.test(tabela),
    "voltou a condicionar a marca ao valor da tarifa",
  );
});

test("parcela ausente NAO vira zero na procedencia da linha", async () => {
  // A Amazon posta em partes: 95,3% dos pedidos com tarifa real tem comissao e
  // nenhuma logistica. `null` tem de chegar como `null` em procedenciaDaEstimativa,
  // que omite a parcela — quem escreve "FBA R$ 0,00" afirma um fato falso.
  const tabela = await fonte("src/app/components/OrderProfitabilityTable.tsx");
  assert.match(tabela, /comissao: line\.comissaoEstimada \?\? null,\s*fba: line\.fbaEstimada \?\? null,/);
  // E a funcao que recebe isso ja e testada por comportamento acima.
  assert.ok(!/FBA R\$ 0/.test(procedenciaDaEstimativa({ comissao: 3.47, fba: null })));
});

test("a marca fica COLADA ao numero, na face e no detalhe", async () => {
  const tabela = await fonte("src/app/components/OrderProfitabilityTable.tsx");
  // Face: dentro do <strong> do valor, nao numa terceira linha do cartao.
  assert.match(
    tabela,
    /<strong>\{money\(line\.contribution, line\.currency\)\}\{marcaDaLinha\(line\)\}<\/strong>/,
    "a marca saiu de perto do numero na face da linha",
  );
  // Detalhe: colada a TARIFA, que e a parcela que a estimativa substitui.
  assert.match(
    tabela,
    /− \{money\(line\.marketplaceFees, line\.currency\)\}\{marcaDaLinha\(line\)\}/,
    "a tarifa estimada deixou de ser marcada onde ela mora",
  );
});

test("linha sem tarifa nenhuma continua dizendo o que falta — nao marca ausencia", async () => {
  // `feesEstimadas: false` NAO e "tudo oficial": pode nao haver tarifa alguma.
  // Quem distingue e `marketplaceFees == null`, e nesse caso a tela diz
  // "Ainda nao conciliadas" / "Tarifas nao postadas", sem selo.
  const tabela = await fonte("src/app/components/OrderProfitabilityTable.tsx");
  assert.match(tabela, /\{line\.marketplaceFees == null \? "Ainda não conciliadas" :/);
  assert.match(tabela, /titulo: "Tarifas não postadas", ajuda: "Entram quando o canal liquida o pedido"/);
});
