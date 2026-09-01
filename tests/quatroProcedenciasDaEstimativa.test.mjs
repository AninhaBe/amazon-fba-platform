import test from "node:test";
import assert from "node:assert/strict";

import { fonteDaLinha, procedenciaDaFonte, rotuloDaMarca } from "../src/app/components/procedenciaDaEstimativa.ts";

// A ESTIMATIVA DEIXOU DE TER UMA FONTE SO (01/09/2026). Sao tres que produzem
// numero — observada, tabela e api — e uma que faz a marca SUMIR (oficial).
//
// O criterio que estes testes cobrem nao e "nomear a fonte": e dar, em cada
// caso, a informacao que torna aquela procedencia VERIFICAVEL. Nomear sem dar o
// que confere e a mesma familia da declaracao falsa — a frase parece explicar e
// nao deixa ninguem checar.

test("observada: diz a DATA do pedido de onde o numero veio", () => {
  // E o numero da fonte, so que de OUTRO pedido. Sem a data, ela nao tem como
  // achar o pedido para conferir.
  const p = procedenciaDaFonte({ fonte: "observada", diaDoPedido: "2026-08-12", comissao: 3.47, fba: 5.65 });
  assert.equal(p.origemConhecida, true);
  assert.match(p.texto, /12\/08\/2026/);
  assert.match(p.texto, /ja cobrou|já cobrou/);
  assert.match(p.texto, /comiss[ãa]o R\$\s?3,47/);
  assert.match(p.texto, /oficial entra na liquida/);
});

test("tabela: a FRACAO do banco vira PORCENTAGEM na tela — sem erro de 100x", () => {
  // ⚠️ O DEFEITO QUE ISTO REPROVA e de UNIDADE, e erro de unidade nao fica
  // vermelho em lugar nenhum: ele so parece um numero pequeno. O backend define
  // `percentualDaCategoria = amount / unit_price`, entao comissao de 12,01%
  // chega como 0.1201. Repassar direto escreveria "0,12%" na tela onde a Amazon
  // cobra 12,01% — e a vendedora conferiria contra a tabela e concluiria que o
  // NEXO esta errado, com razao.
  assert.match(
    procedenciaDaFonte({ fonte: "tabela", percentualDaCategoria: 0.1201 }).texto,
    /12,01%/,
    "a fracao do banco nao virou porcentagem na tela",
  );
  assert.ok(
    !/0,12%/.test(procedenciaDaFonte({ fonte: "tabela", percentualDaCategoria: 0.1201 }).texto),
    "a fracao foi repassada crua — erro de 100x",
  );
});

test("tabela: diz o PERCENTUAL usado", () => {
  // E o que ela confere contra a tabela da Amazon. Sem o percentual, "estimado
  // pela tabela" e uma afirmacao que ninguem consegue checar.
  const p = procedenciaDaFonte({ fonte: "tabela", percentualDaCategoria: 0.1201, fba: 5.65 });
  assert.equal(p.origemConhecida, true);
  assert.match(p.texto, /12,01%/);
  assert.match(p.texto, /categoria/);
  assert.match(p.texto, /FBA/);
});

test("api: a composicao ja e a verificacao, como hoje", () => {
  const p = procedenciaDaFonte({ fonte: "api", comissao: 3.47, fba: 5.65 });
  assert.equal(p.origemConhecida, true);
  assert.match(p.texto, /comiss[ãa]o R\$\s?3,47 \+ FBA R\$\s?5,65/);
});

test("parcela ausente NAO vira zero em nenhuma das tres", () => {
  // A Amazon posta em partes: 95,3% dos pedidos com tarifa real tem comissao e
  // nenhuma logistica. Escrever "FBA R$ 0,00" afirma um fato falso.
  for (const e of [
    { fonte: "observada", diaDoPedido: "2026-08-12", comissao: 3.47, fba: null },
    { fonte: "tabela", percentualDaCategoria: 0.1201, comissao: 3.47, fba: null },
    { fonte: "api", comissao: 3.47, fba: null },
  ]) {
    const p = procedenciaDaFonte(e);
    assert.ok(!/FBA R\$\s?0,00/.test(p.texto), `${e.fonte}: parcela ausente virou zero`);
  }
});

test("⚠️ ORIGEM DESCONHECIDA nao vira 'estimado' silencioso NEM some", () => {
  // O caso que o cerebro pediu coberto. Valor estimado sem source e DEFEITO: a
  // vendedora nao tem como saber se aquele numero veio de um pedido antigo, de
  // uma tabela ou de lugar nenhum.
  for (const entrada of [null, undefined, {}, { fonte: "inventada" }, { fonte: "" }]) {
    const p = procedenciaDaFonte(entrada);
    // 1. NAO some: continua havendo texto de procedencia.
    assert.ok(p.texto.length > 0, "a procedencia sumiu");
    // 2. NAO passa por estimativa normal: a tela sabe que a origem falta.
    assert.equal(p.origemConhecida, false, `${JSON.stringify(entrada)}: passou por origem conhecida`);
    // 3. E o texto DIZ o que falta e o que isso impede — nunca "parcial".
    assert.match(p.texto, /sem origem informada/);
    assert.match(p.texto, /n[ãa]o d[áa] para conferir/);
    assert.ok(!/parcial|incompleto/i.test(p.texto), "adjetivo que se desculpa");
  }
});

test("a origem desconhecida e VISIVEL na face — nao fica so no tooltip", () => {
  // Defeito que so aparece no hover nao aparece (licao do v207 e do emVoo).
  assert.equal(rotuloDaMarca(false), "estimado · origem não informada");
});

test("UMA marca so para as tres procedencias — a face nao ganha quatro selos", () => {
  // A distincao vive no tooltip. Selo por procedencia seria empilhamento novo
  // dois dias depois da auditoria que tirou 9-12 marcas da tela.
  const rotulos = new Set([
    procedenciaDaFonte({ fonte: "observada", diaDoPedido: "2026-08-12" }),
    procedenciaDaFonte({ fonte: "tabela", percentualDaCategoria: 0.1201 }),
    procedenciaDaFonte({ fonte: "api" }),
  ].map((p) => rotuloDaMarca(p.origemConhecida)));
  assert.equal(rotulos.size, 1, "a face passou a ter um selo por procedencia");
  assert.equal([...rotulos][0], "estimado");
});

test("'oficial' NAO e uma quarta procedencia — quando o extrato chega, nao ha estimativa", () => {
  // Modelar "oficial" convidaria alguem a renderizar um selo dizendo que o
  // numero e oficial, e selo permanente vira decoracao. A ausencia do valor no
  // tipo e o contrato: sem estimativa, quem chama nao renderiza marca nenhuma.
  const fontes = ["observada", "tabela", "api"];
  for (const f of fontes) assert.equal(procedenciaDaFonte({ fonte: f, diaDoPedido: "2026-08-12", percentualDaComissao: 1 }).origemConhecida, true);
  // E "oficial" cai no ramo de origem desconhecida se alguem mandar mesmo assim
  // — visivel, em vez de virar um selo novo.
  assert.equal(procedenciaDaFonte({ fonte: "oficial" }).origemConhecida, false);
});

test("o MAPEADOR: valor do banco vira variante da tela, e o que ele nao conhece vira DESCONHECIDO", () => {
  // ⚠️ ESTES DOIS DEFEITOS PASSARAM PELA RODADA DE QUEBRAS DE 01/09/2026
  // sem nenhum teste reclamar, e sao exatamente os que a peca existe para
  // impedir. Foram escritos DEPOIS de ver as duas quebras ficarem verdes.
  //
  // Defeito 1: a origem desconhecida caindo em "api" por padrao. A tela passaria
  // a afirmar "Estimado pela Amazon" para um valor cuja origem ela nao sabe ler
  // — a familia do zero fabricado, um valor que passa por informacao sem ter
  // procedencia.
  const desconhecida = fonteDaLinha({ origemDaTarifa: "fonte_que_ainda_nao_existe", comissao: 3.47 });
  assert.equal(desconhecida, null, "valor fora dos tres conhecidos nao pode virar uma variante qualquer");
  assert.equal(procedenciaDaFonte(desconhecida).origemConhecida, false);
  assert.match(rotuloDaMarca(false), /origem n[\u00e3a]o informada/);

  // Sem origem nenhuma (linha sem estimativa que chegou ate aqui) — mesmo trato.
  assert.equal(fonteDaLinha({ origemDaTarifa: null }), null);

  // Defeito 2: "observada" SEM a data passando como conhecida. A frase da origem
  // observada E a data ("a Amazon ja cobrou isto neste produto no pedido de
  // 30/08"); sem ela sobra um rotulo que ninguem confere. E a data sumia por
  // defeito real: ate 01/09/2026 a extracao usava uma expressao sem as barras
  // invertidas, que nao casava data nenhuma.
  assert.equal(fonteDaLinha({ origemDaTarifa: "observada", observadaEm: null }), null,
    "observada sem data tem de ficar VISIVEL como desconhecida, nao virar rotulo vazio");

  // E os tres caminhos que funcionam, com o vocabulario EXATO do banco.
  assert.deepEqual(fonteDaLinha({ origemDaTarifa: "observada", observadaEm: "2026-08-30", comissao: 3.47, fba: null, moeda: "BRL" }),
    { fonte: "observada", diaDoPedido: "2026-08-30", comissao: 3.47, fba: null, moeda: "BRL" });
  assert.equal(fonteDaLinha({ origemDaTarifa: "product_fees_api" }).fonte, "api",
    "o nome do banco e product_fees_api; a tela chama de api, e a traducao mora no mapeador");
  assert.equal(fonteDaLinha({ origemDaTarifa: "tabela" }).fonte, "tabela");
});

test("tabela SEM percentual nao fica torta — e hoje e 100% dos casos", () => {
  // A fonte tabela esta parada por falta da categoria por ASIN, entao
  // `percentualDaCategoria` vem null em todas as linhas. A frase precisa
  // aguentar isso: omite a clausula, nunca escreve "0,00%".
  const p = procedenciaDaFonte(fonteDaLinha({ origemDaTarifa: "tabela", percentualDaCategoria: null, comissao: 3.47 }));
  assert.equal(p.origemConhecida, true, "tabela sem percentual continua sendo uma origem conhecida");
  assert.match(p.texto, /tabela da Amazon/);
  assert.ok(!/0,00%/.test(p.texto), "percentual ausente virou zero — o null virou fato");
  assert.ok(!/%/.test(p.texto), "sem percentual, a clausula do percentual nao pode aparecer vazia");
  assert.match(p.texto, /liquida[\u00e7c][\u00e3a]o/i);
});
