import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { amazonFinancialCards } from "../src/app/(app)/amazon/amazonFinancialCards.ts";
import { procedenciaDaFonte } from "../src/app/components/procedenciaDaEstimativa.ts";

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

test("o CARD do agregado nao marca mais — nem com valor, nem com zero", () => {
  // ⚠️ TRES TESTES VIRARAM UM, E A INTENCAO INVERTEU, em 02/09/2026.
  // Eles exigiam o selo e a frase no card de Taxas: um garantia que a marca so
  // existia havendo estimativa, outro que o ZERO publicado pela fonte continuava
  // marcado, e o terceiro que selo e frase nasciam e sumiam juntos.
  //
  // A dona reverteu o proprio pedido de ontem, verbatim: *"nao precisamos
  // informar o que e oficial e o que e estimado. remove de tudo essa
  // palavra/card, ja dissemos as regras do que mostrar (numeros)"*.
  //
  // O QUE OS TRES PROTEGIAM CONTINUA PROTEGIDO, so que na LINHA do pedido — onde
  // a procedencia e verificavel, porque a pessoa confere aquele pedido. No
  // agregado ela nunca foi: somava fontes diferentes. Ver
  // `tests/quatroProcedenciasDaEstimativa.test.mjs`.
  for (const cenario of [
    { },
    { feesEstimadas: 4.31, pedidosComTarifaEstimada: 2 },
    // O zero publicado pela fonte, que era o caso mais defendido dos tres.
    { feesEstimadas: 0, pedidosComTarifaEstimada: 3 },
  ]) {
    const fees = carta(amazonFinancialCards({
      finance: FINANCE, cogs: 13.64, estimatedProfit: 20.04, unitsWithoutCost: 0, ...cenario,
    }), "fees");
    assert.equal(fees.marcaEstimativa, undefined, `o selo voltou ao card: ${JSON.stringify(cenario)}`);
    assert.ok(!/estimad|oficial|liquida/i.test(fees.baseDeclarada ?? ""), `o texto voltou ao card: ${fees.baseDeclarada}`);
  }
});

test("a procedencia diz de onde veio e que o oficial substitui — nunca 'parcial'", () => {
  // ⚠️ MIGRADO EM 01/09/2026, quando os campos de procedencia chegaram do
  // backend: `procedenciaDaEstimativa` foi APAGADA e as garantias passaram para
  // `procedenciaDaFonte`. As asserções são as mesmas — o que mudou foi de onde
  // a frase sai, não o que ela precisa dizer.
  const completa = procedenciaDaFonte({ fonte: "api", comissao: 3.47, fba: 5.65 }).texto;
  assert.match(completa, /comiss[ãa]o R\$\s?3,47/);
  assert.match(completa, /FBA R\$\s?5,65/);
  assert.match(completa, /liquida[çc][ãa]o substitui este/i);

  // Parcela ausente NAO vira zero (AGENTS.md) e nao apaga a explicacao.
  const soComissao = procedenciaDaFonte({ fonte: "api", comissao: 3.47, fba: null }).texto;
  assert.ok(!/FBA/.test(soComissao), "FBA desconhecido nao pode virar 'FBA R$ 0,00'");
  assert.match(soComissao, /liquida[çc][ãa]o/i);

  // ⚠️ O AGREGADO SAIU EM 02/09/2026 (decisao da dona, revertendo o pedido
  // dela de ontem): o card mostra so o numero, sem dizer o que e oficial e o
  // que e estimado. As assercoes sobre PROCEDENCIA_DO_AGREGADO sairam junto
  // com a constante. O que sobra aqui e a procedencia da LINHA, que fica.
  for (const frase of [completa, soComissao]) {
    assert.ok(!/parcial|incompleto/i.test(frase), "adjetivo que se desculpa e proibido");
  }
});

test("a tela NAO renderiza mais a marca no card — e o Metric segue capaz de marcar", async () => {
  // ⚠️ INTENCAO INVERTIDA em 02/09/2026: este teste exigia que a pagina
  // renderizasse `<MarcaDeEstimativa>` na face do card de Taxas. A dona pediu a
  // remocao (verbatim no teste acima). A assercao passou a PROIBIR o render no
  // agregado — e a proibicao le o fonte SEM COMENTARIOS, senao casa a propria
  // nota que explica a remocao.
  const pagina = await fonte("src/app/(app)/amazon/page.tsx");
  const codigo = pagina.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(!/marca=\{card\.marcaEstimativa/.test(codigo), "a marca do agregado voltou para a face do card");

  // E a CAPACIDADE do componente fica: a prop `marca` do Metric continua
  // existindo, porque a marca por LINHA usa a mesma peca visual. Remover a
  // capacidade seria jogar fora o que ainda esta em uso.
  const metric = await fonte("src/app/components/Metric.tsx");
  assert.match(metric, /marca\?: React\.ReactNode;/, "o Metric perdeu a capacidade de exibir marca");
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
  // E a origem tem de chegar junto, senao a marca sabe o valor e nao sabe de
  // onde ele veio — que e o estado que `origemConhecida: false` denuncia.
  assert.match(tabela, /origemDaTarifa: line\.origemDaTarifa,/);
  assert.match(tabela, /observadaEm: line\.observadaEm,/);
  // E a funcao que recebe isso ja e testada por comportamento acima.
  assert.ok(!/FBA R\$ 0/.test(procedenciaDaFonte({ fonte: "api", comissao: 3.47, fba: null }).texto));
});

test("a marca fica COLADA ao numero, na face e no detalhe", async () => {
  const tabela = await fonte("src/app/components/OrderProfitabilityTable.tsx");
  // ⚠️ A FACE MUDOU DE FORMA EM 11/09/2026, e a exigencia nao: a
  // linha da tabela era `<strong>{money(contribution)}{marca}</strong>` com o
  // percentual ao lado; no v3 ela virou UM chip com o percentual, e o valor em
  // R$ passou a aparecer no detalhe que abre. A marca da estimativa continua
  // onde ela precisa estar — colada ao numero da FACE, visivel sem abrir nada —,
  // e e isso que a ADR-027 exige: estimativa marcada na tela.
  //
  // ⚠️ NAO vale afrouxar para "marcaDaLinha aparece no arquivo": ela
  // aparece tres vezes, e duas sao no detalhe expandido. Se a guarda casasse o
  // identificador solto, a marca poderia sair da face e o teste ficaria verde —
  // e a face e justamente a parte que a pessoa le sem clicar. Por isso o bloco
  // inteiro do chip, literal.
  // String simples, sem template literal: a linha do chip tem `${classe}` dentro
  // de uma template string do componente, e reproduzi-la com backtick aqui fazia
  // o TESTE interpolar a variavel. Guarda que nao roda nao guarda nada.
  assert.ok(
    tabela.includes([
      "      {percent(line.marginPct)}",
      "      {marcaDaLinha(line)}",
    ].join(String.fromCharCode(10))),
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

test("o ROTULO da face sai da MESMA fonte que o tooltip — nunca de uma constante", async () => {
  // ⚠️ ESTA QUEBRA FICOU VERDE NA PRIMEIRA RODADA (01/09/2026): trocar
  // `rotulo={rotuloDaMarca(fonte)}` por uma string fixa passava por todos os
  // testes. E o defeito mais grave possivel nesta feature — a face diria
  // "tabela oficial Amazon" numa linha cuja tarifa veio de OUTRA origem, que e
  // exatamente a queixa que originou a mudanca: o rotulo vendendo errado.
  //
  // Casar a CHAMADA, nao o par `chave: valor` avulso: o par sobrevive num
  // comentario logo acima (ja pegou este repo com `filaDeFundo: false`).
  const tabela = await fonte("src/app/components/OrderProfitabilityTable.tsx");
  assert.match(
    tabela,
    /rotulo=\{rotuloDaMarca\(fonte\)\}/,
    "o rotulo da face deixou de sair da fonte da linha",
  );
  // E o tooltip tem de sair da MESMA variavel, senao os dois podem divergir.
  assert.match(tabela, /const procedencia = procedenciaDaFonte\(fonte\);/);
});
