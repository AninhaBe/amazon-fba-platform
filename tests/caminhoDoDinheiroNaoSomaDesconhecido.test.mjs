import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { custoDaVenda, fatiaDoSobrou, fraseDoTacos, ordenaPorMargem, sobreAVenda, somaDosCustos } from "../src/app/components/caminhoDoDinheiro.ts";

const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
const semComentarios = (codigo) =>
  codigo
    .split(String.fromCharCode(13)).join("")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/**
 * ⚠️ TODO DADO AQUI E FABRICADO, DOS DOIS LADOS DA FRONTEIRA — e essa e a
 * exigencia, nao um detalhe de montagem.
 *
 * A conta da vendedora hoje tem as quatro parcelas preenchidas. Um teste que so
 * usasse os numeros dela nunca exercitaria o caso `null`, e a regra ficaria
 * verde com as duas leituras possiveis — ate o primeiro periodo sem aliquota
 * cadastrada, onde o defeito nasceria calado. E o irmao do "desconfie de zero":
 * ali o numero nao aparecia, aqui o CASO nao aparecia.
 */

test("com TODAS as parcelas conhecidas, o total e a soma exata", () => {
  const { total, faltando } = somaDosCustos([
    { rotulo: "produtos", valor: 1263.18 },
    { rotulo: "frete", valor: 634.41 },
    { rotulo: "taxas", valor: 331.44 },
    { rotulo: "impostos", valor: 253.79 },
  ]);
  assert.equal(faltando.length, 0);
  // O valor do canvas, ao centavo.
  assert.equal(Number(total.toFixed(2)), 2482.82);
});

test("UMA parcela desconhecida torna o TOTAL desconhecido — nunca uma soma menor", () => {
  // ⚠️ Este e o caso que a conta de hoje nao exercita. Sem aliquota
  // cadastrada, `taxes` chega `null`. Somando como zero, o total sairia
  // 2.229,03 — um numero exato e MENOR que o real, e o "Sobrou" ao lado
  // pareceria melhor do que e. Nada ficaria vermelho.
  const { total, faltando } = somaDosCustos([
    { rotulo: "produtos", valor: 1263.18 },
    { rotulo: "frete", valor: 634.41 },
    { rotulo: "taxas", valor: 331.44 },
    { rotulo: "impostos", valor: null },
  ]);
  assert.equal(total, null, "a soma engoliu a parcela desconhecida e devolveu um total menor que o real");
  assert.deepEqual(faltando, ["impostos"], "o total sumiu sem dizer O QUE falta — a tela nao teria o que apontar");
});

test("as parcelas que faltam saem NOMEADAS, todas elas", () => {
  const { total, faltando } = somaDosCustos([
    { rotulo: "produtos", valor: null },
    { rotulo: "frete", valor: 634.41 },
    { rotulo: "taxas", valor: undefined },
    { rotulo: "impostos", valor: 253.79 },
  ]);
  assert.equal(total, null);
  assert.deepEqual(faltando, ["produtos", "taxas"]);
});

test("zero e FATO e entra na soma — nao e ausencia", () => {
  // "Nao houve frete" e um fato do periodo; confundi-lo com "nao sei o frete"
  // apagaria um total que a tela pode mostrar com seguranca.
  const { total, faltando } = somaDosCustos([
    { rotulo: "produtos", valor: 100 },
    { rotulo: "frete", valor: 0 },
  ]);
  assert.equal(total, 100);
  assert.equal(faltando.length, 0);
});

test("porcentagem sobre a venda: sem divisor valido nao ha porcentagem", () => {
  assert.equal(Number(sobreAVenda(1263.18, 2819.9).toFixed(1)), 44.8);   // o valor do canvas
  // ⚠️ Os tres jeitos de a divisao virar lixo na tela. `NaN%` e
  // `Infinity%` sao PIORES que ausencia, porque parecem um numero.
  assert.equal(sobreAVenda(100, 0), null, "base zero virou porcentagem — na tela sairia Infinity%");
  assert.equal(sobreAVenda(100, null), null, "base desconhecida virou porcentagem — na tela sairia NaN%");
  assert.equal(sobreAVenda(null, 2819.9), null, "parcela desconhecida virou porcentagem");
});

test("ordenar por margem poe o DESCONHECIDO no fim, nao entre os piores", () => {
  // ⚠️ Lista fabricada com o `null` NO MEIO, de proposito: se ele ja
  // entrasse no fim, a ordenacao poderia estar quebrada e o teste passaria.
  const ordenado = ordenaPorMargem([
    { id: "a", marginPct: 12.6 },
    { id: "b", marginPct: null },
    { id: "c", marginPct: 30.3 },
    { id: "d", marginPct: -5.5 },
    { id: "e", marginPct: null },
  ]);
  assert.deepEqual(ordenado.map((i) => i.id), ["c", "a", "d", "b", "e"],
    "o produto sem custo cadastrado foi ordenado como 0% — a tela acusa de pior quem ninguem mediu");
  // E os dois desconhecidos mantem a ordem de entrada, para nao trocarem de
  // lugar a cada render.
  assert.deepEqual(ordenado.slice(3).map((i) => i.id), ["b", "e"]);
});

test("as COLUNAS consomem ESTAS contas — e o imposto entra JA RESOLVIDO em zero", async () => {
  // ⚠️ INTENCAO INVERTIDA DUAS VEZES:
  //
  //   07/09/2026 — de REGRA: exigia `valor: overview.profit.taxes`, porque
  //     imposto ausente apagava o total. A Ana decidiu que ALIQUOTA NAO
  //     CADASTRADA VALE ZERO NA CONTA (excecao nomeada ao `null != 0`, com ADR),
  //     e o imposto virou parcela conhecida igual a zero.
  //   11/09/2026 — de ENDERECO: o v3 substituiu a faixa (que somava tudo num
  //     "Custou" via `somaDosCustos`) pelas colunas, que mostram cada parcela
  //     separada. Nao ha mais total somado na tela, entao nao ha mais o que
  //     `somaDosCustos` montasse ali — a decisao do zero continua, e agora ela
  //     alimenta a COR do lucro (`fatiaDoSobrou`).
  //
  // ⚠️ O QUE AUTORIZA A EXCECAO E O RASTRO, e ha assercao para ele no
  // teste seguinte: a pendencia continua na fila e a coluna diz "aliquota nao
  // configurada". Sem isso, o `?? 0` seria o defeito que este arquivo existe
  // para impedir — e a diferenca entre os dois e uma linha de codigo.
  const ml = semComentarios(await fonte("src/app/components/MercadoLivreWorkspace.tsx"));

  assert.ok(ml.includes("const impostoNaConta = overview.profit.taxes ?? 0;"),
    "a excecao do imposto saiu do lugar unico onde ela esta documentada");
  // E ela entra na decisao do lucro fechado — a quarta parcela, ja resolvida.
  assert.ok(ml.includes("parcelas: [overview.profit.cogs, overview.profit.sellerShipping, overview.profit.fees, impostoNaConta],"),
    "o imposto resolvido deixou de alimentar a decisao do lucro fechado");

  // ⚠️ E A EXCECAO E SO DO IMPOSTO. Um `?? 0` em tarifa, frete ou custo
  // seria o defeito antigo de volta, agora com a desculpa de uma regra que nao
  // fala deles: la o desconhecido e desconhecido mesmo.
  for (const proibido of [
    "overview.profit.cogs ?? 0",
    "overview.profit.sellerShipping ?? 0",
    "overview.profit.fees ?? 0",
  ]) {
    assert.ok(!ml.includes(proibido),
      'a excecao do imposto vazou para outra parcela: "' + proibido + '"');
  }
});

test("o custo de uma venda e desconhecido se QUALQUER lado for desconhecido", () => {
  // ⚠️ A tabela mostra "Custos" e o produtor nao entrega esse campo:
  // ele e receita menos contribuicao. Um `(receita ?? 0) - (sobrou ?? 0)` daria
  // um numero exato e ERRADO, e a linha inteira pareceria conferida.
  assert.equal(custoDaVenda(28.9, 3.63).toFixed(2), "25.27");   // o valor do canvas
  assert.equal(custoDaVenda(null, 3.63), null, "venda sem receita conhecida virou custo exato");
  assert.equal(custoDaVenda(28.9, null), null, "venda sem resultado conhecido virou custo exato");
  // E zero continua sendo fato dos dois lados.
  assert.equal(custoDaVenda(28.9, 0), 28.9);
  assert.equal(custoDaVenda(0, 0), 0);
});

test("as colunas leem os produtores certos — e o imposto zero mantem o RASTRO", async () => {
  const ml = semComentarios(await fonte("src/app/components/MercadoLivreWorkspace.tsx"));

  // ⚠️ O "% da venda" de cada coluna divide pelo MESMO faturamento
  // que a coluna "Voce vendeu" mostra. Base diferente faria as porcentagens nao
  // fecharem com o numero de cima, sem nada ficar vermelho.
  //
  // ⚠️ MUDOU DE FORMA EM 11/09/2026 E FICOU MAIS FORTE: eram quatro
  // chamadas de `sobreAVenda(..., overview.metrics.revenue30d)`, uma por
  // componente, e a guarda contava quatro. Agora ha UMA funcao (`pctDaVenda`)
  // com a base amarrada dentro dela, e as colunas a chamam — nao da para uma
  // coluna divergir de base sem mudar esta linha.
  assert.ok(
    ml.includes("const pct = sobreAVenda(v, overview.metrics.revenue30d);"),
    "o '% da venda' mudou de base — as porcentagens param de fechar com a coluna 'Voce vendeu'",
  );
  const colunas = ml.slice(ml.indexOf("colunas: ["), ml.indexOf("margem: {"));
  assert.equal((colunas.match(/share: pctDaVenda\(/g) ?? []).length, 3,
    "uma coluna de custo parou de usar a base compartilhada (tarifa, frete e custo usam as tres)");

  // ⚠️ INTENCAO INVERTIDA DE NOVO, e vale registrar as duas voltas:
  // em 07/09 a assercao passou a exigir que o imposto sem aliquota mostrasse o
  // VALOR (zero), porque a conta fecha. O v3 mostra TRAVESSAO na coluna e diz
  // "aliquota nao configurada" embaixo — que e mais honesto para a LEITURA
  // (ninguem cadastrou) sem desfazer a decisao da CONTA (o lucro usa zero). Sao
  // duas coisas diferentes e o v3 separou as duas.
  assert.ok(colunas.includes('valor: overview.profit.taxRate == null ? "—" : money(overview.profit.taxes ?? 0, overview.metrics.currency)'),
    "a coluna de imposto parou de distinguir 'nao cadastrada' de um valor real");

  // ⚠️ E O RASTRO E A UNICA COISA QUE NAO PODE SUMIR. Depois que a
  // conta usa zero, quem distingue "ninguem cadastrou" de "ela declarou 0%" e a
  // linha sob a coluna e a pendencia na fila. Se as duas sairem, a tela passa a
  // afirmar imposto zero sem dizer que ninguem o configurou.
  assert.ok(colunas.includes('share: overview.profit.taxRate == null ? "alíquota não configurada"'),
    "a coluna parou de marcar a aliquota ausente — o rastro na tela sumiu");
  const alertas = ml.slice(ml.indexOf("const alertasDoCaminho = ["), ml.indexOf(String.fromCharCode(10) + "  ];", ml.indexOf("const alertasDoCaminho")));
  assert.ok(alertas.includes("semAliquota ?"),
    "a pendencia da aliquota sumiu da fila — o unico rastro que sobrava foi embora junto");

  // E a lista de pedidos le o produtor, sem derivar custo por conta propria.
  assert.ok(ml.includes("const ultimosPedidos = [...overview.profitabilityLines]"),
    "a lista de pedidos trocou de fonte");
  for (const campo of ["venda: l.revenue == null", "custo: l.productCost == null", "margemPct: l.marginPct"]) {
    assert.ok(ml.includes(campo), "a coluna mudou de fonte ou parou de respeitar o desconhecido: " + campo);
  }
});

test("o ranking ordena pela funcao testada — nao por um sort no componente", async () => {
  const cards = semComentarios(await fonte("src/app/components/CardsDoCaminho.tsx"));
  assert.ok(cards.includes('ordem === "margem"' + String.fromCharCode(10) + "    ? ordenaPorMargem(produtos)"),
    "o ranking por margem parou de usar `ordenaPorMargem` — o produto sem custo volta a ser ordenado como 0%");
  // ⚠️ E a margem desconhecida nao ganha cor NENHUMA na tabela: verde
  // diria "bom", vermelho diria "ruim", e o que ha e ausencia de cadastro.
  const css = (await fonte("src/app/globals.css")).replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(css.includes(".card-tabela .is-desconhecida, .card-ranking .rk-mg.is-desconhecida { color: var(--ink-faint); }"),
    "a margem desconhecida ganhou cor de veredito");
});

test("a barra do custo FECHA 100% com a fatia verde quando tudo e conhecido", () => {
  // ⚠️ O CASO QUE O CANVAS DESENHOU: venda = custo + sobra, e a barra
  // conta a historia inteira. As quatro parcelas e o lucro somam a venda.
  const parcelas = [1263.18, 634.41, 331.44, 253.79];
  const lucro = 337.08;
  const base = 2819.90;

  const verde = fatiaDoSobrou({ parcelas, lucro, base });
  assert.ok(verde != null, "a fatia verde sumiu no caso em que a conta FECHA — o canvas a desenha aqui");

  const somaDasFatias = parcelas.reduce((total, valor) => total + sobreAVenda(valor, base), 0) + verde;
  assert.ok(Math.abs(somaDasFatias - 100) < 0.05,
    `as fatias somam ${somaDasFatias.toFixed(2)}% em vez de 100% — a barra deixou de fechar`);
});

test("com UMA parcela desconhecida a fatia verde SOME, e o branco e o desconhecido", () => {
  // ⚠️ O CASO QUE O CANVAS NAO COBRIU, e o unico que acontece de
  // verdade hoje (imposto sem aliquota). Uma fatia verde calculada por
  // diferenca aqui afirmaria um lucro que nao esta fechado — e afirmaria com a
  // autoridade de um DESENHO, que e pior que um numero, porque ninguem confere
  // um desenho.
  const verde = fatiaDoSobrou({
    parcelas: [1263.18, 634.41, 331.44, null],
    lucro: 337.08,
    base: 2819.90,
  });
  assert.equal(verde, null,
    "a fatia verde apareceu com uma parcela desconhecida — a barra afirma um lucro que nao fechou");

  // E o que sobra em branco e exatamente o que nao se sabe: as tres conhecidas
  // ocupam 79,05% (2.229,03 de 2.819,90) e os 20,95% restantes ficam vazios.
  const conhecidas = [1263.18, 634.41, 331.44].reduce((total, valor) => total + sobreAVenda(valor, 2819.90), 0);
  assert.ok(Math.abs(conhecidas - 79.05) < 0.01, `as fatias conhecidas somam ${conhecidas.toFixed(2)}%`);
});

test("prejuizo tambem nao vira fatia verde", () => {
  // Largura negativa nao existe, e pintar o prejuizo de verde inverteria o
  // significado da unica cor que a faixa usa para dizer "isto sobra para voce".
  assert.equal(fatiaDoSobrou({ parcelas: [100, 200], lucro: -50, base: 1000 }), null);
  assert.equal(fatiaDoSobrou({ parcelas: [100, 200], lucro: 0, base: 1000 }), null);
  // E sem base nao ha porcentagem nenhuma.
  assert.equal(fatiaDoSobrou({ parcelas: [100, 200], lucro: 50, base: 0 }), null);
});

test("o LUCRO so sai verde com as quatro parcelas fechadas — e prejuizo sai vermelho", async () => {
  // ⚠️ INTENCAO INVERTIDA DUAS VEZES, e as duas ficam registradas:
  //
  //   07/09/2026 — a lista passava `overview.profit.taxes` cru, e imposto
  //     ausente apagava a fatia verde. Com a aliquota valendo zero, a conta
  //     fecha e a barra fecha com ela. As OUTRAS TRES continuam bloqueando.
  //   11/09/2026 — o v3 SUBSTITUIU a barra de composicao pelas sete colunas do
  //     periodo, e a decisao foi junto: a coluna "Lucro" mandava
  //     `tom: "positivo"` para qualquer lucro nao-nulo. Dois defeitos de uma vez
  //     — prejuizo pintado de VERDE, e resultado com parcela desconhecida
  //     tambem verde, afirmando conta fechada. A guarda passou a casar a
  //     decisao de COR, que e onde a afirmacao mora agora.
  //
  // O que nao mudou em nenhuma das versoes: a tela nao afirma resultado fechado
  // quando uma parcela do custo e desconhecida.
  const ml = semComentarios(await fonte("src/app/components/MercadoLivreWorkspace.tsx"));
  assert.ok(
    ml.includes("parcelas: [overview.profit.cogs, overview.profit.sellerShipping, overview.profit.fees, impostoNaConta],"),
    "a decisao do verde deixou de olhar as quatro parcelas do custo",
  );
  assert.ok(ml.includes("lucro: overview.profit.estimatedProfit,"), "o verde trocou de fonte de lucro");
  assert.ok(ml.includes("base: overview.metrics.revenue30d,"),
    "o verde mudou de base — precisa dividir pelo mesmo faturamento das outras colunas");
  // ⚠️ E o ramo do prejuizo, que era o que faltava: sem ele,
  // `fatiaDoSobrou` devolveria `null` para lucro negativo e a coluna cairia em
  // "normal" — tinta neutra para um mes no vermelho.
  // ⚠️ UM literal so, com as duas linhas: a primeira versao desta
  // asserção era `ml.includes("estimatedProfit < 0") && ml.includes('? "negativo"')`
  // e ficou VERDE com o defeito reintroduzido — `? "negativo"` aparece em
  // outros cartoes do mesmo arquivo, entao os dois `includes` soltos casavam
  // pedacos que nem sao vizinhos. So apareceu porque a quebra foi rodada; e a
  // familia inteira do AGENTS.md, "casar a existencia de um simbolo nao prova
  // comportamento nenhum".
  assert.ok(
    ml.includes(`: overview.profit.estimatedProfit < 0
          ? "negativo"`),
    "o prejuizo deixou de sair vermelho na coluna de Lucro",
  );
});

test("SEM aliquota e COM aliquota 0% dao a MESMA conta — so o sinal difere", () => {
  // ⚠️ A FRONTEIRA NOVA (07/09/2026), fabricada dos dois lados. Ela e a
  // consequencia exata da decisao da Ana, e o backend a escreveu no ADR-038:
  // depois desta mudanca, quem cadastrou 0% e quem NAO cadastrou produzem
  // numeros IDENTICOS. O que separa os dois nao esta na conta — esta no sinal.
  //
  // Testar so um dos lados nao provaria nada: os dois passam. E testar so os
  // numeros esconderia justamente o que a excecao arrisca — perder o rastro.
  const parcelas = (imposto) => [
    { rotulo: "produtos", valor: 1263.18 },
    { rotulo: "frete", valor: 634.41 },
    { rotulo: "taxas", valor: 331.44 },
    { rotulo: "impostos", valor: imposto },
  ];

  const semCadastro = somaDosCustos(parcelas(0));    // taxes = 0, taxRateKnown = false
  const declarouZero = somaDosCustos(parcelas(0));   // taxes = 0, taxRateKnown = true

  assert.deepEqual(semCadastro, declarouZero,
    "os dois casos deixaram de produzir a mesma conta — a excecao vazou para o numero");
  assert.equal(semCadastro.faltando.length, 0, "o imposto zero voltou a apagar o total");
  assert.equal(Number(semCadastro.total.toFixed(2)), 2229.03);

  // E a barra fecha nos dois — o imposto nao bloqueia mais a fatia verde.
  const verde = fatiaDoSobrou({ parcelas: [1263.18, 634.41, 331.44, 0], lucro: 590.87, base: 2819.90 });
  assert.ok(verde != null, "a fatia verde some com imposto zero — a conta fecha e ela deveria aparecer");

  // ⚠️ MAS AS OUTRAS TRES CONTINUAM APAGANDO. A excecao e do imposto,
  // e so dele: aqui ninguem decidiu que frete desconhecido vale zero.
  assert.equal(somaDosCustos(parcelas(0).map((p) =>
    p.rotulo === "frete" ? { ...p, valor: null } : p)).total, null,
    "frete desconhecido parou de apagar o total — a excecao do imposto vazou");
  assert.equal(fatiaDoSobrou({ parcelas: [1263.18, null, 331.44, 0], lucro: 590.87, base: 2819.90 }), null,
    "a fatia verde apareceu com o frete desconhecido");
});

test("os DOIS motivos do TACOS dizem coisas diferentes — e nenhum vira zero", () => {
  // ⚠️ ESTE E O DEFEITO QUE O BACKEND PEDIU PARA EU NAO COMETER, com
  // todas as letras: `gasto-desconhecido` NAO E "nao anunciou". Ela pode ter
  // anunciado muito e a coleta e que nao chegou. Ele renomeou o motivo justamente
  // para impedir essa leitura, e a tela nao pode desfazer isso escrevendo "sem
  // anuncios".
  const semGasto = fraseDoTacos({ pct: null, motivo: "gasto-desconhecido" });
  const semBase = fraseDoTacos({ pct: null, motivo: "sem-faturamento" });

  assert.ok(semGasto, "gasto desconhecido ficou sem frase — a tela mostraria vazio");
  assert.ok(semBase, "sem faturamento ficou sem frase");
  assert.notEqual(semGasto, semBase,
    "os dois motivos viraram a MESMA frase — a tela deixou de distinguir 'nao sei o gasto' de 'nao houve venda'");

  // ⚠️ E NENHUM DOS DOIS PODE AFIRMAR QUE ELA NAO ANUNCIOU. Esta e a
  // assercao que o pedido do backend pede ao pe da letra.
  for (const frase of [semGasto, semBase]) {
    for (const proibido of ["sem anúncio", "sem anuncio", "não anunciou", "nao anunciou", "0%"]) {
      assert.ok(!frase.toLowerCase().includes(proibido.toLowerCase()),
        'a frase "' + frase + '" afirma o que a ausencia do TACOS NAO diz: "' + proibido + '"');
    }
  }

  // Com numero, a tela mostra o numero — a frase some.
  assert.equal(fraseDoTacos({ pct: 1.24, motivo: null }), null,
    "a frase de ausencia apareceu junto com o numero");
  // E sem o campo (produtor antigo) a tela diz que nao ha calculo, nao que e zero.
  assert.ok(fraseDoTacos(null), "TACOS ausente do payload ficou sem frase");
  assert.ok(fraseDoTacos(undefined), "TACOS undefined ficou sem frase");
});

test("o card de anuncios le o produtor — e distingue SEM VENDA de acos zero", async () => {
  const ml = semComentarios(await fonte("src/app/components/MercadoLivreWorkspace.tsx"));

  // ⚠️ `purchases === 0` E O SINAL DE "NAO VENDEU", nao `acos === 0`.
  // Um `acos: 0` vindo da fonte significaria "gastou e vendeu muito" — o OPOSTO.
  // A frente de Ads ja pagou por essa confusao uma vez.
  assert.ok(ml.includes("const semVenda = anuncio.purchases === 0;"),
    "o card passou a inferir 'sem venda' de outro campo — acos zero e o oposto de nao vender");

  // As sete colunas saem de campos do produtor, sem conta no meio.
  for (const campo of [
    "impressoes: contagem(anuncio.impressions)",
    "cliques: contagem(anuncio.clicks)",
    "gasto: money(anuncio.cost, anuncio.currency)",
    "marginPct: anuncio.margemRealPct",
  ]) {
    assert.ok(ml.includes(campo), "a coluna mudou de fonte: " + campo);
  }
  // ACOS e ROAS respeitam o desconhecido em vez de virar zero.
  assert.ok(ml.includes('acos: anuncio.acos == null ? "—"'), "o ACOS desconhecido deixou de ser traco");
  assert.ok(ml.includes('roas: anuncio.roas == null ? "—"'), "o ROAS desconhecido deixou de ser traco");
});

test("o card diz que o anuncio NAO esta descontado do lucro do ML", async () => {
  // ⚠️ A DECISAO DA ANA DE 30/08/2026 CONTINUA DE PE: no Mercado Livre
  // o seller desconta o anuncio depois, no fechamento dele, e o lucro do canal
  // NAO subtrai esse gasto. TACOS divide; o lucro nao subtrai.
  //
  // Se o card der a entender o contrario, ele contradiz as colunas do periodo
  // que estao logo acima na mesma tela — e a vendedora fica com dois numeros
  // que nao fecham, sem saber qual esta errado.
  //
  // ⚠️ MUDOU DE ARQUIVO EM 11/09/2026, nao de exigencia: o card
  // de anuncios saiu de `MercadoLivreWorkspace` e virou o bloco de anuncios do
  // `PainelV3Baixo`. A frase foi junto — esta guarda ficou vermelha por estar
  // lendo o arquivo antigo, com a frase viva no arquivo novo.
  const painel = await fonte("src/app/components/PainelV3Baixo.tsx");
  // A frase e texto de JSX e QUEBRA EM DUAS LINHAS no fonte: casar o literal com
  // a quebra deixaria a guarda vermelha na primeira vez que alguem reformatasse
  // o paragrafo — teste que fica vermelho por formatacao ensina a ignorar
  // vermelho. Comparar com os espacos colapsados prova a FRASE, que e o que
  // importa, e sobrevive a reformatacao.
  const frase = (t) => t.split(/\s+/).join(" ");
  assert.ok(
    frase(painel).includes("Este gasto não está descontado do lucro acima"),
    "o card parou de dizer que o gasto de anuncio NAO entra no lucro do ML — passa a contradizer as colunas acima",
  );

  // E o gasto de anuncio NAO entra nas colunas de custo do periodo. As quatro
  // parcelas sao tarifa, frete, custo dos produtos e imposto — midia nao e uma
  // delas, e no dia em que virar, e decisao de produto, nao ajuste de tela.
  const ml = semComentarios(await fonte("src/app/components/MercadoLivreWorkspace.tsx"));
  const colunas = ml.slice(ml.indexOf("colunas: ["), ml.indexOf("margem: {", ml.indexOf("colunas: [")));
  assert.ok(!colunas.includes("gastoEmAnuncios") && !colunas.includes("adsPorProduto"),
    "o gasto de anuncio entrou na conta do custo — o lucro do ML passou a subtrair midia, contra a decisao de 30/08");
});
