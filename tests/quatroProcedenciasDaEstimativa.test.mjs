import test from "node:test";
import assert from "node:assert/strict";

import { ROTULO_DO_AGREGADO, fonteDaLinha, procedenciaDaFonte, rotuloDaMarca } from "../src/app/components/procedenciaDaEstimativa.ts";

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
  assert.match(p.texto, /liquida[çc][ãa]o substitui este/);
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

test("tabela: diz o PERCENTUAL usado, e sobre O QUE ele incide", () => {
  // E o que ela confere contra a tabela da Amazon. Sem o percentual, "tabela
  // oficial" e uma afirmacao que ninguem consegue checar.
  //
  // ⚠️ O RECORTE MUDOU EM 01/09/2026: o numero que chega e o percentual
  // EFETIVO SOBRE O PRECO, nao a aliquota nominal da categoria. Dizer "da
  // categoria" nomearia um recorte que ninguem publicou assim — e ela confere
  // contra o pedido, onde o que existe e preco e tarifa.
  const p = procedenciaDaFonte({ fonte: "tabela", percentualDaCategoria: 0.1201, fba: 5.65 });
  assert.equal(p.origemConhecida, true);
  assert.match(p.texto, /12,01%/);
  assert.match(p.texto, /sobre o pre[çc]o/);
  assert.ok(!/da categoria/.test(p.texto), "voltou a afirmar um recorte que a fonte nao publica assim");
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
    assert.match(p.texto, /origem n[ãa]o informada/i);
    assert.match(p.texto, /n[ãa]o d[áa] para conferir/);
    assert.ok(!/parcial|incompleto/i.test(p.texto), "adjetivo que se desculpa");
  }
});

test("a origem desconhecida e VISIVEL na face — nao fica so no tooltip", () => {
  // Defeito que so aparece no hover nao aparece (licao do v207 e do emVoo).
  //
  // ⚠️ O ROTULO PERDEU A PALAVRA "estimado" em 01/09/2026, a pedido da
  // vendedora — mas NAO perdeu a visibilidade, que e o que este teste guarda. A
  // assercao passou a exigir a propriedade (a face DIZ que a origem falta) em
  // vez do texto exato, que era o que a amarrava a palavra removida.
  const rotulo = rotuloDaMarca(null);
  assert.match(rotulo, /origem n[ãa]o informada/i);
  assert.ok(!/estimad/i.test(rotulo), "a palavra recusada voltou pela porta do caso desconhecido");
  // E ele PRECISA ser diferente dos tres conhecidos, senao some no meio deles.
  for (const conhecida of [{ fonte: "observada", diaDoPedido: "2026-08-12" }, { fonte: "tabela", percentualDaCategoria: 0.1 }, { fonte: "api" }]) {
    assert.notEqual(rotulo, rotuloDaMarca(conhecida));
  }
});

test("a FACE nomeia a origem — e a palavra 'estimado' nao volta", () => {
  // ⚠️ ESTE TESTE FOI INVERTIDO EM 01/09/2026, e o registro fica porque a
  // inversao e o ponto. Ele EXIGIA um selo unico ("estimado") para as tres
  // procedencias, com o argumento de que selo por fonte seria empilhamento novo
  // logo depois da auditoria. O argumento estava certo sobre QUANTIDADE e errado
  // sobre CONTEUDO: a vendedora leu a tela e disse *"nao e estimado, e a tabela
  // oficial"*. As tres fontes sao numero publicado pela Amazon, e chamar isso de
  // estimativa depreciava o dado.
  //
  // Continua sendo UMA marca por linha — o que mudou e o texto dentro dela, nao
  // a quantidade. Nao ha empilhamento: um selo, com o nome da fonte.
  const rotulos = [
    rotuloDaMarca({ fonte: "observada", diaDoPedido: "2026-08-12" }),
    rotuloDaMarca({ fonte: "tabela", percentualDaCategoria: 0.1201 }),
    rotuloDaMarca({ fonte: "api" }),
    rotuloDaMarca(null),
  ];
  assert.equal(new Set(rotulos).size, 4, "duas origens diferentes passaram a mostrar o mesmo rotulo");
  assert.match(rotulos[0], /j[áa] cobrou|j[áa] cobrada/i);
  assert.match(rotulos[1], /tabela oficial/i);
  assert.match(rotulos[2], /Amazon/);
  assert.match(rotulos[3], /origem n[ãa]o informada/i);

  // ⚠️ A PROIBICAO LE O ROTULO, QUE E STRING PURA — sem comentario para
  // casar por engano. Se um dia ela olhar o fonte, tem de limpar comentario
  // antes: o comentario que explica a remocao cita a palavra removida
  // (docs/achado-guarda-que-depende-da-forma.md, caso 1).
  for (const rotulo of rotulos) {
    assert.ok(!/estimad/i.test(rotulo), `a palavra que a vendedora recusou voltou para a face: "${rotulo}"`);
  }
  // E o agregado, que nao pode nomear fonte, tambem nao pode usar a palavra.
  assert.ok(!/estimad/i.test(ROTULO_DO_AGREGADO), "o agregado voltou a dizer 'estimado' na face");
  assert.match(ROTULO_DO_AGREGADO, /liquidad/i, "o agregado precisa dizer que aquilo ainda muda");
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
  assert.match(rotuloDaMarca(null), /origem n[\u00e3a]o informada/);

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
  assert.match(p.texto, /tabela oficial da Amazon/);
  assert.ok(!/0,00%/.test(p.texto), "percentual ausente virou zero — o null virou fato");
  assert.ok(!/%/.test(p.texto), "sem percentual, a clausula do percentual nao pode aparecer vazia");
  assert.match(p.texto, /liquida[\u00e7c][\u00e3a]o/i);
});
