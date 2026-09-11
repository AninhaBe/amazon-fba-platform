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

test("os numeros das COLUNAS DO PERIODO saem dos mesmos campos de sempre", async () => {
  // ⚠️ INTENCAO INVERTIDA DUAS VEZES, as duas registradas:
  //
  //   06/09/2026 — exigia os campos do `CockpitDoResultado`, que saiu quando o
  //     Caminho do Dinheiro trocou a faixa do lucro pela faixa de 4 etapas.
  //   11/09/2026 — exigia os campos da FAIXA, que o v3 substituiu pelas sete
  //     colunas do periodo (a faixa somava o custo num "Custou"; as colunas o
  //     abrem em Tarifa, Frete, Custo e Imposto).
  //
  // O QUE ELA SEMPRE PROTEGEU CONTINUA, e e o coracao do criterio de aceite
  // desta leva: trocar de layout NAO pode trocar o numero. Cada coluna le o
  // MESMO campo do produtor que a tela ja exibia, e o jeito silencioso de errar
  // isso e derivar um valor novo no meio do JSX.
  const codigo = semComentarios(await fonte(ML));
  const colunas = codigo.slice(codigo.indexOf("colunas: ["), codigo.indexOf("margem: {"));

  for (const [etapa, marcador] of [
    ["Voce vendeu", "valor: money(overview.metrics.revenue30d, overview.metrics.currency)"],
    ["Tarifa do ML", "valor: money(overview.profit.fees, overview.metrics.currency)"],
    ["Frete que voce paga", "valor: money(overview.profit.sellerShipping, overview.metrics.currency)"],
    ["Custo dos produtos", "valor: money(overview.profit.cogs, overview.metrics.currency)"],
  ]) {
    assert.ok(colunas.includes(marcador), `a coluna '${etapa}' trocou de fonte`);
  }
  assert.ok(colunas.includes('valor: overview.profit.taxRate == null ? "—"'),
    "a coluna 'Impostos' deixou de mostrar traco quando nao ha aliquota cadastrada");
  assert.ok(colunas.includes('valor: overview.profit.estimatedProfit == null ? "—"'),
    "a coluna 'Lucro' deixou de mostrar traco quando o lucro e desconhecido");

  // ⚠️ E NENHUMA ARITMETICA NO MEIO DAS COLUNAS: as contas moram no
  // modulo puro, onde da para testa-las pelo comportamento, com os dois lados
  // do null. `pctDaVenda` e chamada de funcao, nao conta escrita aqui.
  //
  // ⚠️ A PRIMEIRA VERSAO DESTA PROIBICAO ERA CEGA e reprovou a tela
  // CERTA: ela banha `"+ overview.profit"`, e a coluna de imposto monta o rotulo
  // com `"aliquota de " + overview.profit.taxRate + "%"` — concatenacao de
  // TEXTO, nao conta. Proibicao que nao distingue as duas ensina a afrouxar a
  // guarda, que e como ela para de valer. A soma proibida e a que vira NUMERO
  // EXIBIDO, e e nela que a mira esta agora.
  for (const proibido of ["/ overview.", "* 100"]) {
    assert.ok(!colunas.includes(proibido),
      "apareceu conta dentro das colunas (" + proibido + ") — ela pertence a caminhoDoDinheiro.ts");
  }
  assert.doesNotMatch(colunas, /money\([^)]*[+\-][^)]*\)/,
    "apareceu soma ou subtracao dentro de um money() nas colunas — o valor passou a ser derivado no JSX");
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
  assert.ok(alertas.includes('href: "/mercado-livre/anuncios"'), "o alerta de custo perdeu o destino");
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

test("o TOP DE PRODUTOS le o mesmo produtor — e nao monta a propria lista", async () => {
  const codigo = semComentarios(await fonte(ML));
  // ⚠️ INTENCAO REDUZIDA DUAS VEZES:
  //
  //   07/09/2026 — exigia uma chamada de `buildFinancialComposition`, que saiu
  //     com o painel de baixo antigo.
  //   11/09/2026 — lia `const produtosDoRanking`, que o v3 substituiu pelo
  //     campo `produtos` do painel. Exigir o nome antigo seria pedir de volta o
  //     bloco que a Ana mandou cortar.
  //
  // O que ela sempre protegeu continua: a lista sai de `overview.topProducts`, e
  // a ORDEM e do produtor. Um `.sort()` aqui faria a tela ranquear por um
  // criterio que o numero ao lado nao explica.
  const inicio = codigo.indexOf("produtos: overview.topProducts");
  assert.ok(inicio > 0, "o top de produtos deixou de ler `overview.topProducts` — a lista virou outra");
  const ranking = codigo.slice(inicio, codigo.indexOf("ritmo: {", inicio));
  for (const proibido of [".sort(", ".filter("]) {
    assert.ok(!ranking.includes(proibido),
      "o top passou a " + proibido + " a lista no ML: a ordem e o corte sao do produtor");
  }
  // ⚠️ `.slice(0, 8)` E PERMITIDO E ESTA ANCORADO: o titulo do cartao
  // diz "Top N" derivando N da lista, entao cortar aqui nao mente. Era o corte
  // as cegas com rotulo fixo que mentia (ver a nota no PainelV3).
  assert.ok(ranking.includes("overview.topProducts.slice(0, 8)"),
    "o corte do top mudou de forma: confira se o titulo do cartao ainda deriva o N da lista");
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

test("a variante do painel continua OPT-IN — para quem ainda a usa", async () => {
  // ⚠️ INTENCAO INVERTIDA (07/09/2026). Esta guarda exigia que o ML
  // pedisse `semDonut`. O painel de baixo saiu do ML inteiro no corte do
  // Caminho do Dinheiro, entao o ML nao pede mais nada — e exigir o pedido
  // seria exigir o bloco de volta.
  //
  // O QUE CONTINUA VALENDO E O DEFAULT: os outros tres canais nunca pediram a
  // variante e nao podem perder a rosquinha por causa de uma mudanca do ML.
  const painel = semComentarios(await fonte("src/app/components/FinancialSummaryPanel.tsx"));
  assert.match(painel, /semDonut = false/,
    "a variante deixou de ter default — os outros canais perdem a rosquinha junto");
  assert.match(painel, /\{!semDonut && total > 0 && slices\.length > 0/, "a condicao da rosquinha mudou de forma");

  for (const tela of [
    "src/app/(app)/amazon/page.tsx",
    "src/app/components/ShopeeWorkspace.tsx",
    "src/app/components/TikTokWorkspace.tsx",
  ]) {
    const fonteDaTela = semComentarios(await fonte(tela));
    assert.ok(!fonteDaTela.includes("semDonut"),
      tela + " passou a pedir a variante do ML: a rosquinha some de um canal que ninguem mexeu");
  }
});

/*
 * ⚠️ AQUI MORAVA "as DUAS COLUNAS sao do canal, e as pecas de dentro nao
 * mudaram" — a guarda do grid `ml-cockpit-duas-colunas`, do redesenho de
 * 03/09/2026. Ela saiu em 07/09 porque O BLOCO SAIU: o canvas do Caminho do
 * Dinheiro substituiu aquelas duas colunas pelos cards `cards-caminho-2`.
 *
 * Nao foi apagada por estar chata nem por ter ficado vermelha: o que ela
 * vigiava deixou de existir, e a proibicao correspondente vive agora em "os
 * blocos CORTADOS pelo contrato nao voltam para a pagina", que reprova o
 * retorno do grid velho.
 */

test("A ORDEM DOS BLOCOS E A DO CANVAS — e ela ja foi reprovada TRES vezes", async () => {
  // ⚠️ ESTA GUARDA JA DEFENDEU O DEFEITO DUAS VEZES, e o registro
  // disso vale mais que a correcao:
  //
  //   07/09/2026 — a sequencia esperada incluia `className="metric-grid
  //     ml-dashboard-metric-grid"`, a regua de KPIs do dashboard VELHO. Ela
  //     EXIGIA o bloco duplicado na pagina: quem fizesse o corte certo veria a
  //     suite ficar vermelha dizendo que a CORRECAO estava errada.
  //   11/09/2026 — mesma armadilha, uma camada acima. A sequencia passou a ser
  //     a do canvas de 06/09 (faixa de 4 etapas, alertas, ranking+decomposicao,
  //     tabela, ritmo, anuncios), e o v3 substituiu esses blocos por dois
  //     paineis. A guarda exigia de novo a pagina ANTERIOR.
  //
  // ⚠️ A LICAO, e ela vale para toda frente de SUBSTITUICAO: "bloco
  // novo no lugar" NAO e "bloco velho fora". A unica versao desta guarda que nao
  // defende o passado e a que confere as DUAS metades — o que tem de estar, e o
  // que tem de ter saido.
  const codigo = semComentarios(await fonte(ML));

  // Metade 1 — a ordem do v3. O corpo comeca no `ProgressoDaImportacao`, que so
  // existe no corpo (o `NexoDoDia` aparece tambem no retorno vazio logo acima).
  const corpo = codigo.slice(codigo.indexOf("<ProgressoDaImportacao"));
  const sequencia = [
    ["a primeira viewport", "<PainelV3 dados="],
    ["a metade de baixo", "<PainelV3Baixo dados="],
  ];
  let anterior = -1;
  for (const [nome, marcador] of sequencia) {
    const posicao = corpo.indexOf(marcador);
    assert.ok(posicao >= 0, nome + ": o bloco sumiu da pagina");
    assert.ok(posicao > anterior, nome + ": saiu da ordem do canvas v3");
    anterior = posicao;
  }
  // A narracao do NEXO abre a tela, antes da linha de progresso.
  assert.ok(
    codigo.indexOf("<NexoDoDia />") < codigo.indexOf("<ProgressoDaImportacao"),
    "a narracao do NEXO saiu da abertura da tela",
  );

  // Metade 2 — O QUE ISTO SUBSTITUI SAIU? A pergunta que a v288 nao respondeu.
  // ⚠️ Casa a TAG RENDERIZADA (`<Nome`), nunca o identificador: o
  // nome sobrevive num import depois de alguem apagar a chamada, e a guarda
  // ficaria verde com o bloco de volta na tela. O fonte vem sem comentario
  // porque as notas desta frente CITAM as pecas que sairam.
  for (const substituido of [
    "<FaixaDeEtapas",
    "<AlertasDoCaminho",
    "<RankingDaVenda",
    "<DecomposicaoDoCusto",
    "<TabelaDeVendas",
    "<RitmoDosDias",
    "<AnunciosPagos",
    'className="cards-caminho-2"',
  ]) {
    assert.ok(
      !codigo.includes(substituido),
      `${substituido} voltou para a tela: o v3 passou a somar em vez de substituir, e o numero aparece duas vezes`,
    );
  }
});

test("o saldo do Mercado Pago continua desenhado pela peca compartilhada, DENTRO do painel", async () => {
  // ⚠️ INTENCAO MIGRADA (11/09/2026). A versao anterior contava as
  // QUATRO etapas da faixa — tres no array mais o saldo como filho — porque a
  // faixa subiu para producao com TRES colunas em 07/09 e as guardas de campo
  // passavam numa lista curta demais.
  //
  // O v3 nao tem faixa: as etapas viraram as sete colunas do periodo, e o saldo
  // passou a morar na metade de baixo. O que a guarda protege e o que sobrou da
  // regra, e e a parte que importa: o saldo NAO e um bloco solto desenhado por
  // conta propria — ele entra pela MESMA peca das etapas, passado como conteudo
  // do painel. Duas pecas desenhando saldo divergem no primeiro ajuste.
  const ml = semComentarios(await fonte(ML));

  // Casa a propriedade inteira: `<MercadoLivreSaldo modo="etapa"` solto voltaria
  // a passar com o componente renderizado em qualquer lugar da pagina.
  assert.ok(
    ml.includes('saldo: <MercadoLivreSaldo modo="etapa" connectionId={connectionId ?? undefined} />,'),
    "o saldo saiu de dentro do painel: virou bloco solto, ou trocou de peca",
  );

  // E a peca e a compartilhada — a mesma que desenhava as etapas da faixa.
  const saldo = await fonte("src/app/components/MercadoLivreSaldo.tsx");
  assert.match(saldo, /import \{ EtapaDoCaminhoView \} from "\.\/FaixaDeEtapas"/,
    "o saldo parou de usar a peca compartilhada e passou a desenhar a sua propria");
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
  // ⚠️ MESMA PROPRIEDADE, TERCEIRO ALVO. Ela nasceu no `LucroPorDia`,
  // passou pelo card do ritmo do Caminho do Dinheiro e agora vive no ritmo do
  // `PainelV3`. O defeito que reprova nao mudou e continua sem ficar vermelho em
  // lugar nenhum: um `?? 0` passa no TypeScript, passa no build, e desenha uma
  // coluna rente a base num dia em que o custo nao chegou. Numa serie temporal
  // zero nao parece ausencia — parece NOTICIA RUIM.
  const ml = semComentarios(await fonte(ML));
  const painel = semComentarios(await fonte("src/app/components/PainelV3.tsx"));

  // No ML: o dia preserva o desconhecido, nas duas pontas (valor e rotulo).
  assert.ok(ml.includes("lucro: d.profit ?? null,"),
    "o lucro do dia deixou de preservar o desconhecido");
  assert.ok(ml.includes("rotuloLucro: d.profit == null ? null : money(d.profit, overview.metrics.currency),"),
    "o rotulo do dia desconhecido deixou de ser ausencia");
  const ritmo = ml.slice(ml.indexOf("ritmo: {"), ml.indexOf("pendencias:"));
  assert.ok(!/profit \?\? 0/.test(ritmo),
    "apareceu um zero no caminho do lucro diario: desconhecido virou queda");
  // As outras series NAO tem `null`: elas sempre existem, e zero ali e fato.
  assert.ok(ritmo.includes("metricaV3 === \"Faturamento\" ? d.revenue : metricaV3 === \"Pedidos\" ? d.orders : d.units"),
    "uma serie do ritmo trocou de fonte");

  // Na peca: sem apuracao, so o contorno — e a escala usa o TOTAL, que sempre
  // existe, senao um dia sem lucro encolheria os outros.
  assert.ok(painel.includes("const semApuracao = ritmo.mostraLucro && d.lucro == null;"),
    "o dia sem apuracao deixou de ser distinguido na peca");
  assert.ok(painel.includes("{ritmo.mostraLucro && d.lucro != null ? ("),
    "a parte cheia da coluna deixou de exigir lucro conhecido");
  assert.ok(painel.includes("const teto = Math.max(1, ...ritmo.dias.map((d) => d.total));"),
    "a escala das colunas voltou a depender do lucro — dia desconhecido encolhe os vizinhos");
  assert.ok(painel.includes("{d.rotuloLucro ?? \"—\"}"),
    "o dia desconhecido deixou de aparecer como traco no rotulo");
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
  // ⚠️ MUDOU DE FORMA EM 11/09/2026, nao de regra: o ritmo do v3
  // monta o rotulo na propria linha do dia, sem a variavel `ehHoje` no meio. A
  // comparacao de DATA continua sendo a condicao — era ela que esta guarda
  // protegia, contra "hoje" virar posicao na lista.
  assert.ok(ml.includes('dia: d.date === hojeNoBrasil ? "hoje" : diaDaSemana(d.date),'),
    "\"hoje\" voltou a ser posicao na lista em vez de comparacao de data");

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

test("em tela estreita as tabelas viram cartoes de chave e valor", async () => {
  // ⚠️ TABELA DE SEIS OU OITO COLUNAS NAO ENCOLHE: ela rola na
  // horizontal, e rolagem horizontal dentro de um card e o jeito mais rapido de
  // esconder uma coluna sem ninguem perceber que ela existe. A spec pede cartao
  // empilhado de chave e valor abaixo de 768px, e e isso que esta guarda ancora.
  //
  // Medido em iframes de 1180, 900 e 420px (media query responde a largura do
  // iframe): a 420 as celulas empilham, o cabecalho sai, os rotulos aparecem e o
  // nome do produto fica inteiro. Nas outras duas nada muda.
  const css = (await fonte("src/app/globals.css")).replace(/\/\*[\s\S]*?\*\//g, "");
  const inicio = css.indexOf("@media (max-width: 768px) {");
  assert.ok(inicio >= 0, "a media query de tela estreita sumiu");
  const bloco = css.slice(inicio, css.indexOf(QUEBRA + "}", inicio));

  for (const [oQue, regra] of [
    ["o cabecalho sai de cena", ".card-tabela thead { position: absolute;"],
    ["as celulas empilham", ".card-tabela td { "],
    ["o rotulo de cada valor aparece", "content: attr(data-rotulo);"],
    ["o nome do produto deixa de ser cortado", "white-space: normal;"],
  ]) {
    assert.ok(bloco.includes(regra), oQue + " nao acontece mais em tela estreita: " + regra);
  }

  // ⚠️ O ROTULO VEM DO `data-rotulo` DA CELULA, e por isso ele PRECISA
  // existir em toda celula de valor. Com o `thead` fora de cena, uma celula sem
  // rotulo vira um numero solto no cartao — e a coluna que ela representava
  // some da leitura sem deixar rastro.
  const cards = await fonte("src/app/components/CardsDoCaminho.tsx");
  for (const rotulo of [
    "Pedido", "Venda", "Custos", "Sobrou", "Margem",
    "Impressões", "Cliques", "Gasto", "Vendas atribuídas", "ACOS", "ROAS", "Margem real",
    "Valor", "Sobre a venda", "Situação",
  ]) {
    assert.ok(cards.includes('data-rotulo="' + rotulo + '"'),
      'a celula de "' + rotulo + '" perdeu o data-rotulo: em tela estreita ela vira um numero sem nome');
  }
});
