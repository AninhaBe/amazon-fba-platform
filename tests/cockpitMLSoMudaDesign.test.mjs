import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
/**
 * ⚠️ NORMALIZA O CR ANTES DE QUALQUER COISA, e e a SEGUNDA vez que
 * esta familia morde neste projeto. A guarda de ordem casa
 * `"<TopProdutosNaFaixa" + QUEBRA`, e QUEBRA e o char 10: num arquivo gravado
 * em CRLF o que vem depois da tag e `\r\n`, entao a assercao nao casa e o teste
 * reprova dizendo "o bloco sumiu da pagina" — sendo que o bloco esta la.
 *
 * Falso VERMELHO e tao ruim quanto falso verde: ensina a ignorar teste que
 * reprova. A arvore tem arquivos nos dois formatos e vai continuar tendo.
 */
const semComentarios = (codigo) =>
  codigo.split(String.fromCharCode(13)).join("").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/**
 * ⚠️ O DELIMITADOR DEPOIS DO NOME DA TAG, e ele nao e zelo: sem ele
 * `"<TopProdutosNaFaixa"` casa tambem `"<TopProdutosNaFaixaX"`, e a quebra que
 * renomeia a peca fica VERDE. Aconteceu ao rodar a quebra em 06/09/2026 — a
 * terceira vez que casamento por prefixo passa batido neste projeto.
 */
const QUEBRA = String.fromCharCode(10);

const ML = "src/app/components/MercadoLivreWorkspace.tsx";
const CARDS = "src/app/components/CardsDoCaminho.tsx";

/**
 * ⚠️ A RESTRIÇÃO DA DONA FOI LITERAL (03/09/2026): *"SEM ALTERAÇÃO NENHUMA QUE
 * NÃO SEJA O DESIGN"*. Este arquivo é a guarda dessa frase.
 *
 * O risco de um redesenho não é ficar feio — é mudar um número de lugar e, no
 * caminho, mudar o número. Por isso as asserções abaixo olham para o que a peça
 * NÃO pode fazer: calcular, buscar, decidir condição.
 */

test("as pecas dos cards NAO calculam — elas so apresentam", async () => {
  // ⚠️ MESMA PROPRIEDADE, ALVO NOVO. Ela vigiava o `CockpitDoResultado`,
  // que saiu da arvore quando o Caminho do Dinheiro substituiu a faixa e o
  // grafico. A regra nao mudou: numero derivado na peca diverge do produtor sem
  // nada ficar vermelho, e por isso as contas moram em `caminhoDoDinheiro.ts`,
  // onde da para chamar e conferir a saida.
  const codigo = semComentarios(await fonte(CARDS));
  for (const proibido of [/\/ 100/, /\* 100/, /toFixed\(/, /estimatedProfit/]) {
    assert.ok(!proibido.test(codigo), "a peca passou a calcular: " + proibido);
  }
  // E nao busca nada: sem fetch, sem hook de dados. `useState` e permitido —
  // o alternador e estado de APRESENTACAO, nao de dado.
  assert.ok(!/fetch\(|useEffect/.test(codigo), "a peca ganhou vida propria — ela e de apresentacao");
});

test("a barra do custo OMITE parcela desconhecida em vez de desenhar zero", async () => {
  // ⚠️ INTENCAO MIGRADA: a assercao era sobre a cascata da faixa do
  // cockpit, que saiu. A MESMA regra vale para a barra do card "O que o custo
  // esconde", que e onde a proporcao mora agora. `null != 0` vale para a
  // proporcao como vale para o numero — uma barra que soma o que ninguem apurou
  // mente com a autoridade de um desenho.
  const codigo = semComentarios(await fonte(CARDS));
  assert.ok(codigo.includes("componentes.filter((c) => c.sobreAVendaPct != null && c.sobreAVendaPct > 0)"),
    "a barra do custo voltou a aceitar parcela desconhecida como fatia");
  // E a fatia verde do fim so entra quando quem chama mandou — a decisao de
  // quando ela existe mora em `fatiaDoSobrou`, testada pelos dois cenarios.
  assert.ok(codigo.includes("{sobrouPct == null ? null : ("),
    "a fatia verde deixou de ser opcional: ela passaria a afirmar lucro fechado sempre");
});

test("os numeros da FAIXA DE ETAPAS saem dos mesmos campos de sempre", async () => {
  // ⚠️ INTENCAO INVERTIDA (06/09/2026). Ate aqui esta guarda exigia os
  // campos do `CockpitDoResultado`, que saiu: o Caminho do Dinheiro trocou a
  // faixa do lucro pela faixa de 4 etapas, e o lucro deixou de aparecer tres
  // vezes na pagina para aparecer uma. O corte foi aprovado pela Ana.
  //
  // O QUE ELA SEMPRE PROTEGEU CONTINUA: a faixa nao inventa numero. Cada etapa
  // le o MESMO campo do produtor que a tela ja exibia — trocar de layout nao
  // pode trocar o numero, e o jeito silencioso de errar isso e derivar um valor
  // novo no meio do JSX.
  const codigo = semComentarios(await fonte(ML));
  const faixa = codigo.slice(codigo.indexOf("const etapasDoCaminho = ["), codigo.indexOf("const alertasDoCaminho"));

  assert.ok(faixa.includes("valor: money(overview.metrics.revenue30d, overview.metrics.currency)"),
    "a etapa 'Voce vendeu' trocou de fonte");
  assert.ok(faixa.includes('valor: overview.profit.estimatedProfit == null ? "\u2014"'),
    "a etapa 'Sobrou' deixou de mostrar traco quando o lucro e desconhecido");
  assert.ok(faixa.includes('custosDoPeriodo.total == null ? "\u2014" : money(custosDoPeriodo.total'),
    "a etapa 'Custou' deixou de respeitar o total desconhecido");
  // ⚠️ E NENHUMA ARITMETICA NO MEIO DA FAIXA: as contas moram no modulo
  // puro, onde da para testa-las pelo comportamento, com os dois lados do null.
  for (const proibido of ["+ overview.profit", "/ overview.", "* 100"]) {
    assert.ok(!faixa.includes(proibido),
      "apareceu conta dentro da faixa (" + proibido + ") — ela pertence a caminhoDoDinheiro.ts");
  }
});

test("os ALERTAS mantem condicao e destino — so a forma mudou", async () => {
  // ⚠️ INTENCAO INVERTIDA DUAS VEZES. Esta guarda ja exigiu os cartoes
  // de pendencia (ate 03/09), depois os chips, e agora os cartoes de alerta do
  // Caminho do Dinheiro. O que ela protege nao mudou nenhuma das vezes: a lista
  // nasce das MESMAS condicoes e leva aos MESMOS destinos. Aviso que muda de
  // forma pode perder um caso sem ninguem ver.
  const codigo = semComentarios(await fonte(ML));
  const inicio = codigo.indexOf("const alertasDoCaminho = [");
  const alertas = codigo.slice(inicio, codigo.indexOf("\n  ];", inicio));

  assert.ok(alertas.includes("overview.metrics.productsWithoutCost > 0"), "o alerta de custo perdeu a condicao");
  assert.ok(alertas.includes('href: "/mercado-livre/produtos"'), "o alerta de custo perdeu o destino");
  assert.ok(alertas.includes("semAliquota ?"), "o alerta de aliquota sumiu");
  assert.ok(alertas.includes("critical.length > 0"), "o alerta de estoque perdeu a condicao");
  assert.ok(alertas.includes('href: "/mercado-livre/estoque"'), "o alerta de estoque perdeu o destino");

  // ⚠️ E CADA UM DIZ O QUE FALTA COM NUMERO. Nada de adjetivo que se
  // desculpa: a regra da casa proibe "parcial" e irmaos.
  for (const proibido of ["parcial", "incompleto", "incompleta"]) {
    assert.ok(!alertas.toLowerCase().includes(proibido), "apareceu " + proibido + " num alerta");
  }
});

test("OS OUTROS TRES CANAIS NAO FORAM TOCADOS — o teste e do canal, nao do app", async () => {
  // ⚠️ A dona chamou o redesenho de TESTE e quer validar num canal antes de
  // mandar replicar. Se a peça vazasse para os outros, ela estaria validando
  // quatro telas achando que valida uma.
  for (const tela of [
    "src/app/(app)/amazon/page.tsx",
    "src/app/components/ShopeeWorkspace.tsx",
    "src/app/components/TikTokWorkspace.tsx",
  ]) {
    const codigo = semComentarios(await fonte(tela));
    assert.ok(!/CockpitDoResultado|LinhaDePendencias/.test(codigo), `${tela}: o redesenho vazou para um canal que não pediu`);
    // E eles continuam passando as próprias pendências pelo BriefingLead.
    // A forma de passar varia entre as telas (`acoes={[` numa, `acoes={` com
    // expressão noutra) — o que importa é que continuam passando.
    assert.match(codigo, /acoes=\{/, `${tela}: perdeu as ações do BriefingLead`);
  }
});

test("e o BriefingLead continua servindo os quatro — a peca compartilhada nao mudou", async () => {
  // O ML deixou de PASSAR ações; a capacidade continua no componente, intacta,
  // porque os outros três a usam.
  const briefing = semComentarios(await fonte("src/app/components/BriefingLead.tsx"));
  assert.match(briefing, /acoes/, "a capacidade de ações sumiu da peça compartilhada");
});

test("nenhuma classe dos cards e usada sem existir no CSS", async () => {
  // ⚠️ MESMA PROPRIEDADE, ALVO NOVO. Classe escrita no JSX e ausente do
  // CSS nao quebra build nem teste: ela simplesmente nao veste nada, e o
  // elemento aparece sem estilo numa tela que ninguem abriu ainda.
  const codigo = (await fonte(CARDS)) + (await fonte("src/app/components/FaixaDeEtapas.tsx"));
  const css = await fonte("src/app/globals.css");
  const classes = new Set();
  // ⚠️ SO OS TRECHOS LITERAIS. A primeira versao casava
  // `className={ordem === valor ? ...}` e colhia `ordem` como se fosse classe —
  // a guarda reprovava pedindo `.ordem` no CSS. Classe vem de aspas ou do texto
  // fixo dentro da crase; o que esta dentro de `${...}` e expressao.
  for (const achado of codigo.matchAll(/className="([^"]*)"/g)) {
    for (const classe of achado[1].split(" ")) {
      if (classe && !classe.startsWith("is-")) classes.add(classe);
    }
  }
  for (const achado of codigo.matchAll(/className={`([a-z][a-z0-9 -]*)/g)) {
    for (const classe of achado[1].split(" ")) {
      if (classe && !classe.startsWith("is-")) classes.add(classe);
    }
  }
  assert.ok(classes.size > 0, "nenhuma classe encontrada — a guarda passaria vazia");
  for (const classe of classes) {
    assert.ok(css.includes("." + classe), "a classe `" + classe + "` e usada no JSX e nao existe no CSS");
  }
});

test("os CARDS leem o mesmo produtor — e nao montam a propria lista", async () => {
  const codigo = semComentarios(await fonte(ML));
  // ⚠️ INTENCAO INVERTIDA (etapa 3 do Caminho do Dinheiro). Esta
  // guarda ja exigiu a rosquinha na direita da faixa, depois a conta escrita,
  // depois o `TopProdutosNaFaixa`. O canvas trocou os tres pelo card "De onde
  // veio a venda", com alternador — e o `TopProdutosNaFaixa` saiu da pagina.
  //
  // O QUE ELA SEMPRE PROTEGEU CONTINUA, e e a unica coisa que importa aqui: a
  // lista sai de `overview.topProducts` DIRETO. Duas listas do mesmo periodo na
  // mesma pagina podem divergir sem nada ficar vermelho.
  const ranking = codigo.slice(codigo.indexOf("const produtosDoRanking = "), codigo.indexOf("const vendasDaTabela"));
  assert.ok(ranking.includes("overview.topProducts.map("),
    "o ranking deixou de ler `overview.topProducts` — a lista virou outra");
  for (const proibido of [".sort(", ".slice(", ".filter("]) {
    assert.ok(!ranking.includes(proibido),
      "o ranking passou a " + proibido + " a lista no ML: a ordem e o corte sao do produtor");
  }
  // ⚠️ E A ORDENACAO POR MARGEM VIVE NO MODULO TESTADO, nao num sort
  // solto: `null` ordenado como 0% acusaria de pior quem ninguem mediu.
  const cards = semComentarios(await fonte("src/app/components/CardsDoCaminho.tsx"));
  assert.ok(cards.includes("ordenaPorMargem(produtos)"),
    "o ranking por margem parou de usar a funcao testada");

  // A composicao continua com UM calculo so para quem ainda a consome.
  assert.equal((codigo.match(/buildFinancialComposition\(\{/g) ?? []).length, 1,
    "a composicao passou a ser calculada em dois lugares");
});

test("o cockpit inteiro saiu SEM ORFAO — peca, preparo, import e CSS", async () => {
  // ⚠️ A GUARDA CRESCEU COM A REMOCAO. Ela nasceu vigiando a saida da
  // conta escrita; hoje vigia a saida do `CockpitDoResultado` inteiro, que
  // perdeu o ultimo consumidor quando o ritmo virou card. Codigo morto depois de
  // uma troca de design e o que faz a proxima pessoa achar que ha duas formas
  // suportadas de montar a mesma tela.
  const ml = await fonte(ML);
  const css = await fonte("src/app/globals.css");

  // ⚠️ COM DELIMITADOR, e a primeira versao NAO tinha: procurar
  // "LucroPorDia" solto casa dentro de `serieDoLucroPorDia`, que e um modulo
  // VIVO e nada tem a ver. A guarda reprovava um orfao que nao existe. Quinta
  // vez que casamento por substring passa batido neste projeto — aqui ele
  // produziu falso vermelho, que ensina a ignorar teste que reprova.
  for (const orfao of ["<CockpitDoResultado", "<LucroPorDia", "<ContaEscrita", "linhasDaContaEscrita", "pendenciasDoCanal"]) {
    assert.ok(!ml.includes(orfao), "sobrou `" + orfao + "` no ML depois da troca");
  }
  assert.ok(!ml.includes('from "./CockpitDoResultado"'), "sobrou o import da peca removida");
  for (const seletor of [".conta-escrita", ".conta-linha", ".cockpit-cascata", ".cockpit-legenda", ".lucro-colunas"]) {
    assert.ok(!css.includes(seletor), "sobrou `" + seletor + "` no CSS sem ninguem para vestir");
  }
});

test("a margem usa o limiar GLOBAL — e o desconhecido nao ganha veredito", async () => {
  // ⚠️ A GUARDA MUDOU DE ALVO, nao de intencao. Ela vigiava o selo do
  // `TopProdutosNaFaixa`, que saiu da pagina na etapa 3 do Caminho do Dinheiro;
  // a propriedade migrou para o ranking e a tabela dos cards novos. Guarda que
  // continua testando peca que ninguem renderiza defende codigo morto.
  //
  // A ORDEM DELA CONTINUA A MESMA: *"replicar os limiares que a tabela de baixo
  // ja usa, nao inventar novos"*. O jeito silencioso de desobedecer e escrever
  // `marginPct < 12` na peca: funciona hoje, e no dia em que a regra global
  // mudar o MESMO produto sai ambar num lugar e verde no outro.
  const cards = semComentarios(await fonte("src/app/components/CardsDoCaminho.tsx"));
  const tabela = semComentarios(await fonte("src/app/components/TopProductsRanking.tsx"));

  assert.ok(tabela.includes("marginStateClass"), "a tabela de baixo deixou de usar a regra global");
  for (const limiar of ["<12", "< 12", "<=12", "<= 12", ">15", "> 15", ">=15", ">= 15", "<15", "< 15", ">12", "> 12"]) {
    assert.ok(!cards.includes(limiar),
      'apareceu o limiar "' + limiar + '" escrito a mao nos cards: um dos lados vai ficar para tras');
  }

  // ⚠️ E `null` NAO GANHA VEREDITO NENHUM. Verde diria "bom",
  // vermelho diria "ruim", e o que ha e ausencia de custo cadastrado. O
  // desconhecido sai como traco, em tinta neutra.
  assert.ok(cards.includes('produto.marginPct == null' + QUEBRA + '                    ? "\u2014"'),
    "a margem desconhecida do ranking deixou de ser traco");
  assert.ok(cards.includes('venda.marginPct == null' + QUEBRA + '                    ? "\u2014"'),
    "a margem desconhecida da tabela deixou de ser traco");
});

test("o nome do produto e UMA linha que nao estoura a coluna", async () => {
  // ⚠️ MESMA PROPRIEDADE, ALVO NOVO: a lista da faixa virou as tabelas
  // dos cards. E aqui a guarda ganhou uma peca que a versao anterior nao tinha,
  // porque o defeito so apareceu ao MEDIR: em tabela, `max-width` na celula e
  // IGNORADO sob o layout automatico (medido: pedia 230px e ocupava 347px, e as
  // colunas de numero eram empurradas). Quem faz a largura valer e
  // `table-layout: fixed`.
  const css = (await fonte("src/app/globals.css")).replace(/\/\*[\s\S]*?\*\//g, "");

  assert.ok(css.includes(".card-ranking, .card-tabela { width: 100%; table-layout: fixed; border-collapse: collapse; }"),
    "as tabelas dos cards voltaram ao layout automatico: as larguras de coluna param de valer");

  const inicio = css.indexOf(".card-ranking .rk-nome, .card-tabela .tb-nome {");
  assert.ok(inicio >= 0, "a regra do nome do produto sumiu");
  const bloco = css.slice(inicio, css.indexOf("}", inicio));
  for (const regra of ["overflow: hidden;", "text-overflow: ellipsis;", "white-space: nowrap;"]) {
    assert.ok(bloco.includes(regra), "o nome perdeu `" + regra + "` e volta a empurrar a lista");
  }

  // ⚠️ E O TEXTO INTEIRO CONTINUA ALCANCAVEL, mesmo cortado na tela —
  // senao o corte esconde qual produto e.
  const cards = semComentarios(await fonte("src/app/components/CardsDoCaminho.tsx"));
  assert.ok(cards.includes('title={produto.titulo}'), "o nome do ranking perdeu o texto inteiro no atributo");
  assert.ok(cards.includes('title={venda.produto}'), "o nome da tabela perdeu o texto inteiro no atributo");
});

test("a variante do painel e OPT-IN: so o ML passa, e o default e o de hoje", async () => {
  const painel = semComentarios(await fonte("src/app/components/FinancialSummaryPanel.tsx"));
  // ⚠️ O DEFAULT E O COMPORTAMENTO DE HOJE. Sem isso, os outros tres
  // canais perderiam a rosquinha sem ninguem ter pedido.
  assert.match(painel, /semDonut = false/, "a variante deixou de ter default — os outros canais mudam junto");
  assert.match(painel, /\{!semDonut && total > 0 && slices\.length > 0/, "a condicao da rosquinha mudou de forma");

  const ml = semComentarios(await fonte(ML));
  assert.match(ml, /semDonut/, "o ML parou de pedir a variante e ficaria com duas rosquinhas");

  for (const tela of [
    "src/app/(app)/amazon/page.tsx",
    "src/app/components/ShopeeWorkspace.tsx",
    "src/app/components/TikTokWorkspace.tsx",
    "src/app/components/ShopeeModulePage.tsx",
  ]) {
    const outro = semComentarios(await fonte(tela));
    assert.ok(!/semDonut/.test(outro), `${tela}: passou a pedir a variante do ML`);
  }
});

test("as DUAS COLUNAS sao do canal, e as pecas de dentro nao mudaram", async () => {
  const codigo = semComentarios(await fonte(ML));
  assert.match(codigo, /className="ml-cockpit-duas-colunas"/, "o grid das duas colunas sumiu");
  // ⚠️ A tabela compartilhada recebe os MESMOS dados de antes: mover de
  // lugar nao pode virar mexer no que ela mostra.
  // ⚠️ A ANCORA E DENTRO DO BLOCO DAS DUAS COLUNAS. A tabela aparece duas
  // vezes no arquivo (dashboard e monitor); casar o arquivo inteiro ficava verde
  // com a do bloco quebrada, porque a outra continuava intacta.
  const bloco = codigo.slice(codigo.indexOf('className="ml-cockpit-duas-colunas"'));
  const dentro = bloco.slice(0, 1200);
  assert.ok(dentro.includes("<OrderProfitabilityTable lines={overview.profitabilityLines}"),
    "a tabela de rentabilidade mudou de dados ao mudar de lugar");
  // As DUAS pontas do ranking: a condicao de vazio e a lista que ele recebe.
  // Casar so o nome ficava verde com uma das duas trocada por [].
  assert.ok(dentro.includes("overview.topProducts.length === 0"), "a condicao de vazio do ranking mudou");
  assert.ok(dentro.includes("products={overview.topProducts.map("), "o ranking deixou de receber os produtos do periodo");
  // E o grid e do ML: prefixo do canal, e nenhum outro o usa.
  for (const tela of [
    "src/app/(app)/amazon/page.tsx",
    "src/app/components/ShopeeWorkspace.tsx",
    "src/app/components/TikTokWorkspace.tsx",
  ]) {
    const outro = semComentarios(await fonte(tela));
    assert.ok(!/ml-cockpit-duas-colunas/.test(outro), `${tela}: herdou o grid do ML`);
  }
});

test("A ORDEM DOS BLOCOS E A DO CANVAS — e ela ja foi reprovada uma vez", async () => {
  // ⚠️ INTENCAO ATUALIZADA na etapa 3: o `TopProdutosNaFaixa` saiu e
  // no lugar dele entraram os dois cards lado a lado e a tabela de vendas. A
  // sequencia do canvas e: faixa de 4 etapas -> alertas -> ranking + custo ->
  // vendas -> ritmo.
  //
  // ⚠️ O MOTIVO DE ELA EXISTIR NAO MUDA NUNCA: a v258 foi reprovada
  // pela dona por blocos certos em ordem errada — *"Eu pedi pra voce fazer
  // exatamente como me apresentou"*. Guarda de existencia nao pega isso.
  const codigo = semComentarios(await fonte(ML));
  const corpo = codigo.slice(codigo.indexOf("<FaixaDeEtapas"));
  const sequencia = [
    ["a faixa de 4 etapas", "<FaixaDeEtapas etapas="],
    ["os alertas", "<AlertasDoCaminho alertas="],
    ["os dois cards lado a lado", 'className="cards-caminho-2"'],
    ["o ranking", "<RankingDaVenda produtos="],
    ["a decomposicao do custo", "<DecomposicaoDoCusto"],
    ["a tabela de vendas", "<TabelaDeVendas"],
    ["o ritmo dos 7 dias", "<RitmoDosDias dias="],
    ["a regua de cards", 'className="metric-grid ml-dashboard-metric-grid"'],
  ];
  let anterior = -1;
  for (const [nome, marcador] of sequencia) {
    const posicao = corpo.indexOf(marcador);
    assert.ok(posicao >= 0, nome + ": o bloco sumiu da pagina");
    assert.ok(posicao > anterior, nome + ": saiu da ordem do canvas");
    anterior = posicao;
  }
});

test("e o grafico e o painel DESCERAM, nao sairam", async () => {
  // ⚠️ A prancheta era um VIEWPORT, nao a pagina inteira. Remover funcao
  // porque ela nao cabia no recorte seria passar de "so design" para "tirei uma
  // peca" — e a ordem dela foi o contrario disso.
  const codigo = semComentarios(await fonte(ML));
  assert.match(codigo, /<RevenueChart points=\{overview\.dailySales\}/, "o grafico de evolucao sumiu da pagina");
  assert.match(codigo, /<FinancialSummaryPanel/, "o painel de composicao sumiu da pagina");
});

test("a paleta da cascata saiu JUNTO com a cascata — sem orfao", async () => {
  // ⚠️ INTENCAO INVERTIDA (06/09/2026). Esta guarda exigia que a
  // cascata pintasse pelo mapa compartilhado, com a paleta por categoria em
  // opt-in. A cascata saiu no Caminho do Dinheiro: a decomposicao do custo virou
  // a linha de contexto da etapa "Custou". Exigir a paleta agora seria defender
  // uma peca que nao existe.
  //
  // O que ela passa a proteger e o contrario: que a paleta tenha ido embora
  // INTEIRA. Constante de cor sem consumidor e a proxima pessoa achando que ha
  // duas formas suportadas de pintar o ML.
  const ml = semComentarios(await fonte(ML));
  for (const orfao of ["PALETA_DO_ML", "corDaCategoria", "tomDaFatia"]) {
    assert.ok(!ml.includes(orfao), "sobrou " + orfao + " no ML depois de a cascata sair");
  }

  // ⚠️ E O MAPA CONTINUA DE PE PARA QUEM AINDA USA: a rosquinha dos
  // outros tres canais consome tomDaFatia, e ela nao pode ter ido junto.
  const donut = semComentarios(await fonte("src/app/components/CompositionDonut.tsx"));
  assert.ok(donut.includes("export function tomDaFatia("), "o mapa de cor foi removido — os outros canais perdem a rosquinha");
  assert.ok(donut.includes("tom: tomDaFatia(i, s)"), "a rosquinha voltou a decidir a cor por conta propria");
});

test("as cores do ML alcancam a pagina do canal — e so ela", async () => {
  // ⚠️ INTENCAO AJUSTADA na etapa 3: o bloco de tokens do ML ganhou a
  // rampa do custo do canvas (quatro degraus de uma tinta so), entao a assercao
  // de string literal do bloco inteiro deixou de valer. Ela passa a casar cada
  // token, um a um — mais chato e igualmente verificavel.
  //
  // O QUE NAO MUDOU, e e a ordem literal dela: *"O verde #337129 e do ML — NAO
  // mexa no token global --positive dos outros canais"*.
  const css = (await fonte("src/app/globals.css")).replace(/\/\*[\s\S]*?\*\//g, "");

  assert.ok(css.includes("--positive: oklch(0.505 0.102 161);"),
    "o token global --positive mudou de valor: os outros tres canais mudaram de verde junto");

  // ⚠️ O ESCOPO E A PAGINA DO CANAL. No `:root` as cores alcancam
  // quem nao pediu; num seletor menor as pecas irmas ficam sem cor — foi o
  // achado #2 do design-sync, com `--ml-verde` preso a `.cockpit-faixa`.
  // ⚠️ ACHA O BLOCO PELO TOKEN, e nao pelo primeiro seletor de mesmo
  // nome: `.ml-dashboard-page` aparece varias vezes no arquivo (a primeira e o
  // layout da pagina, sem token nenhum). Um `indexOf` do seletor recortava o
  // bloco errado e a guarda reprovava dizendo que o token sumiu — com o token
  // la. Foi o que aconteceu ao rodar esta versao pela primeira vez.
  const ondeMoraOVerde = css.indexOf("--ml-verde: #337129;");
  assert.ok(ondeMoraOVerde >= 0, "o verde do ML sumiu do CSS");
  const abertura = css.lastIndexOf("{", ondeMoraOVerde);
  const seletor = css.slice(css.lastIndexOf("}", abertura) + 1, abertura).trim();
  assert.equal(seletor, ".ml-dashboard-page",
    "os tokens do ML mudaram de escopo: no :root alcancam quem nao pediu, num seletor menor as pecas irmas ficam sem cor");
  const bloco = css.slice(abertura, css.indexOf("}", abertura));
  for (const token of [
    "--ml-verde: #337129;",
    "--ml-coluna: #17171733;",
    "--ml-custo-1: #B4453A;",
    "--ml-custo-2: #C97A5E;",
    "--ml-custo-3: #D9A48A;",
    "--ml-custo-4: #E7C6B3;",
  ]) {
    assert.ok(bloco.includes(token), "token do ML fora do escopo da pagina do canal: " + token);
  }
  assert.equal((css.match(/#337129/g) ?? []).length, 1,
    "o verde do ML foi copiado para outro seletor; um deles vai ficar para tras");

  for (const tela of [
    "src/app/(app)/amazon/page.tsx",
    "src/app/components/ShopeeWorkspace.tsx",
    "src/app/components/TikTokWorkspace.tsx",
  ]) {
    const fonteDaTela = semComentarios(await fonte(tela));
    assert.ok(!fonteDaTela.includes("FaixaDeEtapas"), tela + " passou a montar a faixa do Caminho do Dinheiro");
    assert.ok(!fonteDaTela.includes("RankingDaVenda"), tela + " passou a montar os cards do Caminho do Dinheiro");
    assert.ok(!fonteDaTela.includes("ml-dashboard-page"), tela + " passou a usar a classe do dashboard do ML");
  }
});

test("dia DESCONHECIDO nao vira coluna no chao — nem no caminho ate a tela", async () => {
  // ⚠️ MESMA PROPRIEDADE, ALVO NOVO: o `LucroPorDia` virou o card do
  // ritmo, com quatro series. O defeito que ela reprova nao mudou e continua
  // sem ficar vermelho em lugar nenhum: um `?? 0` passa no TypeScript, passa no
  // build, e desenha uma coluna rente a base num dia em que o custo nao chegou.
  // Numa serie temporal zero nao parece ausencia — parece NOTICIA RUIM.
  //
  // ⚠️ E AGORA A REGRA E POR PAR DIA+SERIE. Um dia pode ter faturamento
  // conhecido e lucro desconhecido ao mesmo tempo; amarrar a ausencia ao dia
  // inteiro apagaria colunas de faturamento que existem.
  const ml = semComentarios(await fonte(ML));
  const cards = semComentarios(await fonte(CARDS));

  assert.ok(ml.includes("const lucro = ponto.profit ?? null;"),
    "o lucro do dia deixou de preservar o desconhecido");
  const ritmo = ml.slice(ml.indexOf("const seteDiasDoRitmo"), ml.indexOf("const componentesDoCusto"));
  assert.ok(!/profit \?\? 0|valor: 0\b/.test(ritmo),
    "apareceu um zero no caminho do lucro diario: desconhecido virou queda");
  assert.ok(ritmo.includes('compacto: lucro == null ? "—"'),
    "o dia desconhecido deixou de aparecer como traco");
  // As outras tres series NAO tem `null`: elas sempre existem, e zero ali e fato.
  assert.ok(ritmo.includes("valor: ponto.revenue,") && ritmo.includes("valor: ponto.orders,"),
    "uma serie do ritmo trocou de fonte");

  // Na peca: sem valor, sem altura — e a escala ignora o desconhecido, senao um
  // dia sem dado encolheria os outros.
  assert.ok(cards.includes("return valor == null ? 0 : Math.abs(valor);"),
    "a escala das colunas voltou a contar o dia desconhecido");
  assert.ok(cards.includes("const fracao = maior > 0 && valor != null ? Math.abs(valor) / maior : 0;"),
    "a altura da coluna deixou de exigir valor conhecido");
  assert.ok(cards.includes('valor == null ? " is-desconhecido" : ""'),
    "o dia desconhecido deixou de ser marcado — a coluna some sem dizer por que");
});

test("\"hoje\" so e dito quando e hoje de verdade", async () => {
  // ⚠️ A PRANCHETA DESTACA A ULTIMA COLUNA COMO "HOJE", e ela e — quando
  // o periodo vai ate hoje. Num periodo passado escolhido a dedo, a ultima
  // coluna e a ultima do RECORTE, e chama-la de hoje seria uma data inventada:
  // a vendedora leria o lucro de 12/08 como o de agora.
  //
  // O DESTAQUE verde continua sempre no dia mais recente (e o que a prancheta
  // desenha); so a PALAVRA depende da data bater. Sao duas decisoes separadas de
  // proposito, e a guarda ancora nas duas.
  const ml = semComentarios(await fonte(ML));

  assert.match(ml, /const hojeNoBrasil = new Date\(\)\.toLocaleDateString\("en-CA", \{ timeZone: "America\/Sao_Paulo" \}\);/,
    "a data de hoje deixou de ser calculada no fuso de Sao Paulo");
  assert.match(ml, /const ehHoje = ponto\.date === hojeNoBrasil;/,
    "\"hoje\" voltou a ser posicao na lista em vez de comparacao de data");
  assert.match(ml, /rotulo: ehHoje \? "hoje" : diaDaSemana\(ponto\.date\)/,
    "o rotulo do dia deixou de depender da data bater");

  // ⚠️ E O `YYYY-MM-DD` NAO PASSA POR `new Date(data)` CRU: seria lido
  // como meia-noite UTC e o dia da semana viria do dia ANTERIOR. A mesma
  // pegadinha ja anotada em TikTokSaldo.
  assert.match(ml, /new Date\(`\$\{data\}T12:00:00Z`\)/,
    "a data perdeu a fixacao ao meio-dia e o dia da semana pode voltar um dia");
  assert.match(ml, /timeZone: "UTC"/,
    "o dia da semana deixou de ser formatado em UTC e volta a depender do fuso do navegador");
});

test("as dimensoes do canvas do Caminho do Dinheiro estao de pe", async () => {
  // ⚠️ INTENCAO SUBSTITUIDA (07/09/2026). Esta guarda vigiava as cinco
  // medidas do Exemplo 2 — numero de 28px, frase de 12px, cascata de 10px,
  // marca de 7px, regua de 114px. Elas dimensionavam a FAIXA DO COCKPIT, que
  // saiu inteira quando o Caminho do Dinheiro entrou; vigia-las agora seria
  // defender medidas de um bloco que nao existe.
  //
  // ⚠️ O MOTIVO DE EXISTIR NAO MUDOU, e por isso ela nao foi apagada: a
  // frente e de DIMENSAO, e as pecas sao interdependentes. O que quebra aqui e
  // alguem "arrumar" um tamanho isolado e desmontar a proporcao que a Ana
  // aprovou olhando o canvas inteiro.
  const css = (await fonte("src/app/globals.css")).replace(/\/\*[\s\S]*?\*\//g, "");

  for (const [oQue, regra] of [
    ["o numero das etapas", ".etapa-valor { margin: 0 0 4px; font-size: 24px; line-height: 1.1; }"],
    ["o rotulo das etapas", ".etapa-rotulo { margin: 0 0 4px; color: var(--ink-muted); font-size: 11.5px; }"],
    ["a barra do custo", ".card-cascata { display: flex; height: 8px; overflow: hidden; border-radius: 4px; margin-block: 2px 11px; }"],
    ["a marca de cor da tabela", ".card-marca { display: inline-block; width: 7px; height: 7px; border-radius: 2px; margin-inline-end: 7px; }"],
    ["a regua do ritmo", "height: 118px;"],
  ]) {
    assert.ok(css.includes(regra), oQue + " saiu da dimensao do canvas:" + QUEBRA + "  " + regra);
  }

  // ⚠️ A REGUA DO RITMO PRECISA DAS TRES REGRAS JUNTAS, e isto e a
  // licao mais cara desta frente: em 03/09 a versao anterior deste grafico
  // renderizou com TODAS as barras em 0px, com as guardas verdes. Altura
  // percentual so resolve contra um pai de altura DEFINIDA — `stretch` faz a
  // coluna ter a altura da regua, e a faixa `1fr` do grid da a pista contra a
  // qual a barra calcula.
  const regua = css.slice(css.indexOf(".ritmo-colunas {"), css.indexOf("}", css.indexOf(".ritmo-colunas {")));
  assert.ok(regua.includes("align-items: stretch;"),
    "a regua do ritmo voltou a `flex-end`: a coluna fica do tamanho do conteudo e TODA barra vira 0px");
  const coluna = css.slice(css.indexOf(".ritmo-coluna {"), css.indexOf("}", css.indexOf(".ritmo-coluna {")));
  assert.ok(coluna.includes("grid-template-rows: auto minmax(0, 1fr) auto;"),
    "a coluna do ritmo perdeu a pista `1fr` — a altura percentual da barra deixa de ter contra o que resolver");
  const barra = css.slice(css.indexOf(".ritmo-barra {"), css.indexOf("}", css.indexOf(".ritmo-barra {")));
  assert.ok(barra.includes("height: calc(var(--fracao, 0) * 100%);"),
    "a barra do ritmo mudou de forma de calcular a altura");
});
