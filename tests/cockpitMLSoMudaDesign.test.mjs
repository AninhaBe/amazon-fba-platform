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
const PECA = "src/app/components/CockpitDoResultado.tsx";

/**
 * ⚠️ A RESTRIÇÃO DA DONA FOI LITERAL (03/09/2026): *"SEM ALTERAÇÃO NENHUMA QUE
 * NÃO SEJA O DESIGN"*. Este arquivo é a guarda dessa frase.
 *
 * O risco de um redesenho não é ficar feio — é mudar um número de lugar e, no
 * caminho, mudar o número. Por isso as asserções abaixo olham para o que a peça
 * NÃO pode fazer: calcular, buscar, decidir condição.
 */

test("a peca do cockpit NAO calcula nada — ela so apresenta", async () => {
  const codigo = semComentarios(await fonte(PECA));
  // Nenhuma aritmética de dinheiro: a peça recebe valores prontos e formatados.
  for (const proibido of [/\/ 100/, /\* 100/, /toFixed\(/, /marginPct/, /estimatedProfit/]) {
    assert.ok(!proibido.test(codigo), `a peça passou a calcular: ${proibido}`);
  }
  // E não busca nada: sem fetch, sem hook de dados.
  assert.ok(!/fetch\(|useEffect|useState/.test(codigo), "a peça ganhou vida própria — ela é de apresentação");
});

test("a cascata OMITE parcela desconhecida em vez de desenhar zero", async () => {
  // ⚠️ `null ≠ 0` vale para a proporção como vale para o número: uma barra que
  // soma o que ninguém sabe mente com a autoridade de um desenho.
  const codigo = semComentarios(await fonte(PECA));
  assert.match(
    codigo,
    /parte\.valor != null && Math\.abs\(parte\.valor\) > 0/,
    "a cascata voltou a aceitar parcela desconhecida como fatia",
  );
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

test("nenhuma classe do cockpit e usada sem existir no CSS", async () => {
  const codigo = (await fonte(PECA)) + (await fonte(ML));
  const css = await fonte("src/app/globals.css");
  // ⚠️ O BACKTICK CONTA: `className={`cockpit-chip${...}`}` nao tem aspas,
  // e a extracao que so olhava aspas deixava a classe fora da conferencia — a
  // quebra de renomear `.cockpit-chip` ficou verde por isso.
  const usadas = new Set([...codigo.matchAll(/["`](cockpit-[\w-]+)/g)].map((m) => m[1]));
  const FIM = [" ", ",", ":", ".", "{", String.fromCharCode(10)];
  const ausentes = [...usadas].filter((classe) => !FIM.some((fim) => css.includes("." + classe + fim)));
  assert.deepEqual(ausentes, [], `classes sem definição: ${ausentes.join(", ")}`);
});

test("a DIREITA DA FAIXA le o mesmo produtor que o bloco de baixo", async () => {
  const codigo = semComentarios(await fonte(ML));
  // ⚠️ ESTA GUARDA JA MUDOU DE INTENCAO DUAS VEZES, e vale registrar as
  // duas: ate 03/09/2026 ela exigia a ROSQUINHA na direita da faixa; depois
  // exigiu a CONTA ESCRITA. Em 06/09/2026 a dona tirou a conta escrita —
  // *"a tela da esquerda ja mostra literalmente isso"* — e pos o Top produtos.
  //
  // O que ela sempre protegeu, e continua protegendo, e que a direita da faixa
  // NAO monte a propria lista: ela le o mesmo produtor que o bloco de baixo.
  // Duas listas do mesmo periodo na mesma pagina podem divergir sem nada ficar
  // vermelho.
  assert.equal(
    (codigo.match(/buildFinancialComposition\(\{/g) ?? []).length, 1,
    "a composicao passou a ser calculada em dois lugares",
  );
  assert.match(codigo, /slices=\{composicaoDoResultado\}/,
    "o painel de baixo deixou de ler a composicao compartilhada");

  // ⚠️ A LISTA DA FAIXA SAI DE `overview.topProducts` DIRETO — sem sort,
  // sem slice, sem filter no caminho. A ordem e o corte sao do produtor, que e
  // quem o bloco de baixo tambem consome.
  const daFaixa = codigo.slice(codigo.indexOf("<TopProdutosNaFaixa"), codigo.indexOf("/>", codigo.indexOf("<TopProdutosNaFaixa")));
  assert.match(daFaixa, /produtos=\{overview\.topProducts\.map\(/,
    "a faixa deixou de ler `overview.topProducts` — a lista virou outra");
  for (const proibido of [".sort(", ".slice(", ".filter("]) {
    assert.ok(!daFaixa.includes(proibido),
      `a faixa passou a ${proibido} a lista: dois rankings do mesmo periodo, e o dia em que discordarem ninguem ve nada vermelho`);
  }
  // E o bloco de baixo continua na pagina, lendo a mesma coisa: a dona nao
  // pediu para tira-lo.
  assert.match(codigo, /<TopProductsRanking products=\{overview\.topProducts\.map\(/,
    "o bloco de baixo saiu da pagina ou trocou de fonte — e ninguem pediu isso");
});

test("a conta escrita saiu SEM ORFAO — peca, preparo e CSS", async () => {
  // ⚠️ CODIGO MORTO DEPOIS DE UMA TROCA DE DESIGN e o que faz a proxima
  // pessoa achar que ha duas formas suportadas. A conta escrita tinha quatro
  // pontas: o componente, o preparo das linhas, o CSS e o import.
  const ml = await fonte(ML);
  const peca = await fonte(PECA);
  const css = await fonte("src/app/globals.css");

  assert.ok(!peca.includes("ContaEscrita"), "o componente da conta escrita ficou no arquivo sem consumidor");
  for (const orfao of ["ContaEscrita", "linhasDaContaEscrita", "fatiaDoResultado", "ORDEM_DA_CONTA"]) {
    assert.ok(!ml.includes(orfao), `sobrou \`${orfao}\` no ML depois da troca`);
  }
  for (const seletor of [".conta-escrita", ".conta-linha", ".conta-sinal"]) {
    assert.ok(!css.includes(seletor), `sobrou \`${seletor}\` no CSS sem ninguem para vestir`);
  }
});

test("o selo de margem usa o limiar GLOBAL — nao um copiado", async () => {
  // ⚠️ A ORDEM FOI EXPLICITA: *"replicar os limiares que a tabela de baixo
  // ja usa, nao inventar novos"*. O jeito silencioso de desobedecer e escrever
  // `marginPct < 12` aqui: funciona hoje, e no dia em que alguem mexer na regra
  // global o MESMO produto sai ambar na faixa e verde na tabela.
  const faixa = semComentarios(await fonte("src/app/components/TopProdutosNaFaixa.tsx"));
  const tabela = semComentarios(await fonte("src/app/components/TopProductsRanking.tsx"));

  assert.match(faixa, /import \{ marginStateClass \} from "@\/lib\/marginTone";/,
    "a faixa deixou de pedir o tom a regra global");
  assert.match(faixa, /marginStateClass\(produto\.marginPct\)/, "o selo parou de consultar a regra global");
  assert.match(tabela, /marginStateClass/, "a tabela de baixo deixou de usar a mesma regra — os dois divergem");
  // ⚠️ COMPARACAO DE STRING LITERAL, e a primeira versao NAO era. Ela
  // usava a RegExp `[<>]=?\s*(12|15)\b` — e o `\b` chegou ao arquivo como um
  // BACKSPACE de verdade (0x08), entao a expressao nunca casou nada e a quebra
  // com `marginPct < 12` injetado ficou VERDE. E a armadilha que o AGENTS.md
  // descreve com todas as letras, e ela pegou de novo. Aqui a lista e chata,
  // literal e verificavel a olho.
  for (const limiar of ["<12", "< 12", "<=12", "<= 12", ">15", "> 15", ">=15", ">= 15", "<15", "< 15", ">12", "> 12"]) {
    assert.ok(!faixa.includes(limiar),
      `apareceu o limiar "${limiar}" escrito a mao na faixa: um dos dois lados vai ficar para tras quando a regra global mudar`);
  }

  // ⚠️ E `null` NAO VIRA 0%: custo nao cadastrado e ausencia, e o selo
  // mostra o traco. Um `?? 0` aqui pintaria de vermelho um produto que ninguem
  // sabe se da lucro.
  assert.match(faixa, /produto\.marginPct == null\s*\?\s*"—"/,
    "margem desconhecida deixou de ser traco — vira 0% e um selo vermelho falso");
});

test("o titulo do produto e UMA linha que nao estoura a coluna", async () => {
  // ⚠️ `min-width: 0` E O QUE FAZ O `text-overflow` FUNCIONAR num item
  // flex: sem ele o item nao encolhe abaixo do proprio conteudo, a linha estica
  // e a lista vaza para fora da faixa. A guarda ancora nos tres juntos porque
  // qualquer um sozinho nao entrega o corte.
  const css = (await fonte("src/app/globals.css")).replace(/\/\*[\s\S]*?\*\//g, "");
  const bloco = css.slice(css.indexOf(".top-faixa-titulo {"), css.indexOf("}", css.indexOf(".top-faixa-titulo {")));
  for (const regra of ["min-width: 0;", "overflow: hidden;", "text-overflow: ellipsis;", "white-space: nowrap;"]) {
    assert.ok(bloco.includes(regra), `o titulo perdeu \`${regra}\` e volta a empurrar a lista para fora da coluna`);
  }
  // A coluna da direita e a largura da prancheta, e nao pode voltar a ser
  // elastica: o titulo encolheria junto com a janela.
  // ⚠️ A LARGURA E FIXA E TEM VALOR EXATO DE PROPOSITO. Ela ja foi
  // 400px; a dona a levou para 470 em 06/09/2026, marcando a divisao no canvas
  // (*"a barra vertical vermelha vai ser a divisao"*). Casar o numero — e nao
  // so "existe um flex-basis" — obriga quem mexer a passar por aqui, porque a
  // largura decide quanto do titulo do produto cabe antes das reticencias.
  assert.ok(css.includes("flex: 0 0 470px;"),
    "a coluna da faixa mudou de largura ou voltou a ser elastica: o corte do titulo muda junto");

  // E o titulo completo continua alcancavel, mesmo cortado na tela.
  const peca = semComentarios(await fonte("src/app/components/TopProdutosNaFaixa.tsx"));
  assert.match(peca, /title=\{produto\.titulo\}/,
    "o titulo cortado deixou de ter o texto inteiro no atributo — nao da mais para saber qual produto e");
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
  // ⚠️ INTENCAO INVERTIDA (06/09/2026): a sequencia era a da Direcao A
  // (faixa do lucro -> chips -> regua de cards -> duas colunas). O canvas do
  // Caminho do Dinheiro poe a faixa de 4 etapas primeiro e os alertas logo
  // depois, porque a leitura e "quanto sobrou -> o que precisa de mim".
  //
  // ⚠️ E O MOTIVO DE ELA EXISTIR NAO MUDOU: a v258 foi reprovada pela
  // dona por blocos certos em ordem errada — *"Eu pedi pra voce fazer exatamente
  // como me apresentou"*. Guarda de existencia nao pega isso.
  const codigo = semComentarios(await fonte(ML));
  const corpo = codigo.slice(codigo.indexOf("<FaixaDeEtapas"));
  const sequencia = [
    ["a faixa de 4 etapas", "<FaixaDeEtapas etapas="],
    ["os alertas", "<AlertasDoCaminho alertas="],
    ["o lucro por dia", "<LucroPorDia titulo="],
    ["o top produtos", "<TopProdutosNaFaixa" + QUEBRA],
    ["a regua de cards", 'className="metric-grid ml-dashboard-metric-grid"'],
    ["as duas colunas", 'className="ml-cockpit-duas-colunas"'],
    ["o grafico e a composicao", 'className="performance-panel"'],
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

test("o verde do ML alcanca a pagina inteira do canal — e so ela", async () => {
  // ⚠️ INTENCAO AJUSTADA (06/09/2026), e o motivo veio de um achado do
  // design-sync: --ml-verde e --ml-coluna so existiam dentro de .cockpit-faixa.
  // Enquanto tudo que as usava morava la dentro, ninguem viu; com a faixa de 4
  // etapas, o lucro por dia e o top produtos viraram irmaos na pagina e a caixa
  // que os continha deixou de existir — as tres pecas ficariam sem cor.
  //
  // O QUE NAO MUDOU, e e a ordem literal dela: *"O verde #337129 e do ML — NAO
  // mexa no token global --positive dos outros canais"*. Ele subiu de escopo,
  // nao virou global.
  const css = (await fonte("src/app/globals.css")).replace(/\/\*[\s\S]*?\*\//g, "");

  assert.ok(css.includes("--positive: oklch(0.505 0.102 161);"),
    "o token global --positive mudou de valor: os outros tres canais mudaram de verde junto");
  assert.ok(css.includes(".ml-dashboard-page { --ml-verde: #337129; --ml-coluna: #17171733; }"),
    "os tokens do ML mudaram de escopo: no :root alcancam quem nao pediu, num seletor menor as pecas ficam sem cor");
  assert.equal((css.match(/#337129/g) ?? []).length, 1,
    "o verde do ML foi copiado para outro seletor; um deles vai ficar para tras");

  for (const tela of [
    "src/app/(app)/amazon/page.tsx",
    "src/app/components/ShopeeWorkspace.tsx",
    "src/app/components/TikTokWorkspace.tsx",
  ]) {
    const fonteDaTela = semComentarios(await fonte(tela));
    assert.ok(!fonteDaTela.includes("FaixaDeEtapas"), tela + " passou a montar a faixa do Caminho do Dinheiro");
    assert.ok(!fonteDaTela.includes("ml-dashboard-page"), tela + " passou a usar a classe do dashboard do ML");
  }
});

test("dia DESCONHECIDO nao vira coluna no chao — nem no caminho ate a tela", async () => {
  // ⚠️ O DEFEITO QUE ESTA GUARDA REPROVA nunca chegou a existir, e o
  // motivo de ela existir mesmo assim e que ele nao ficaria vermelho em lugar
  // nenhum: um `?? 0` no mapeamento passa no TypeScript (o tipo e
  // `number | null | undefined`), passa no build, e desenha uma coluna rente a
  // base num dia em que a custo ainda nao chegou.
  //
  // Numa serie temporal isso e pior que numa tela estatica: zero num grafico nao
  // parece ausencia, parece NOTICIA RUIM — uma queda que nao aconteceu. O
  // contrato do backend distingue os dois na origem (0 = nao vendeu, e fato;
  // null = vendeu e falta custo, tarifa ou aliquota), e a tela tem de preservar
  // a distincao ate o pixel.
  const ml = semComentarios(await fonte(ML));
  const peca = semComentarios(await fonte(PECA));

  // No ML: o lucro do ponto entra como esta, e o `null` vira traco — nao zero.
  assert.match(ml, /const lucro = ponto\.profit \?\? null;/,
    "o lucro do dia deixou de preservar o desconhecido");
  assert.match(ml, /compacto: lucro == null \? "—" :/,
    "o dia desconhecido deixou de aparecer como traco");
  const seteDias = ml.slice(ml.indexOf("const seteDiasDeLucro"), ml.indexOf("const pendenciasDoCanal"));
  assert.ok(!/profit \?\? 0|valor: 0|lucro \?\? 0/.test(seteDias),
    "apareceu um zero no caminho do lucro diario: desconhecido virou queda");

  // Na peca: sem valor, sem altura — e a escala ignora o desconhecido, senao um
  // dia sem dado encolheria os outros.
  assert.match(peca, /dia\.valor == null \? 0 : Math\.abs\(dia\.valor\)/,
    "a escala das colunas voltou a contar o dia desconhecido");
  assert.match(peca, /maior > 0 && dia\.valor != null \? Math\.abs\(dia\.valor\) \/ maior : 0/,
    "a altura da coluna deixou de exigir valor conhecido");
  assert.ok(peca.includes('dia.valor == null ? " is-desconhecido" : ""'),
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

test("as dimensoes do Exemplo 2 estao de pe — a esquerda encolheu para a direita crescer", async () => {
  // ⚠️ ESTA GUARDA E DE DIMENSAO, e ela existe porque a frente inteira ERA
  // dimensao: *"vamos redimensionar ambas telas"* (06/09/2026, Exemplo 2 do
  // canvas). Nao ha regra de dado envolvida — o que quebra aqui e alguem
  // "arrumar" um tamanho isolado e desmontar a proporcao que ela aprovou.
  //
  // As pecas sao interdependentes: o numero caiu de 36 para 28 e a frase de 16
  // para 12 PARA CABEREM NA MESMA LINHA-BASE; a cascata e a legenda encolheram
  // para liberar altura; e a regua do lucro por dia cresceu PARA USAR essa
  // altura. Mexer num sozinho e o que desfaz o conjunto.
  const css = (await fonte("src/app/globals.css")).replace(/\/\*[\s\S]*?\*\//g, "");

  for (const [oQue, regra] of [
    ["o numero do lucro", "font-size: 28px;"],
    ["a frase ao lado dele", ".cockpit-frase { margin: 0; color: var(--ink-muted); font-size: 12px; line-height: 1.5; }"],
    ["a cascata", ".cockpit-cascata { display: flex; height: 10px; border-radius: 5px; overflow: hidden; }"],
    ["a marca da legenda", ".cockpit-marca { display: inline-block; width: 7px; height: 7px; border-radius: 2px; }"],
    ["a regua do lucro por dia", "height: 114px;"],
  ]) {
    assert.ok(css.includes(regra), `${oQue} saiu da dimensao aprovada no Exemplo 2:
  ${regra}`);
  }

  // ⚠️ E O NUMERO E A FRASE PRECISAM DIVIDIR A LINHA-BASE. `baseline`
  // alinha o pe dos dois; `center` ou `flex-start` fariam a frase flutuar ao
  // lado do numero como um segundo paragrafo, que e o que ela pediu para sair.
  assert.ok(css.includes(".cockpit-linha { display: flex; align-items: baseline; flex-wrap: wrap; gap: 10px; }"),
    "o numero e a frase deixaram de dividir a linha-base");
});
