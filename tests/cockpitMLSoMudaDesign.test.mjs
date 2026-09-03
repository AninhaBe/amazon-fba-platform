import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
const semComentarios = (codigo) =>
  codigo.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

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

test("os numeros da faixa saem dos MESMOS campos que a tela ja exibia", async () => {
  const codigo = semComentarios(await fonte(ML));
  const faixa = codigo.slice(codigo.indexOf("<CockpitDoResultado"), codigo.indexOf("/>", codigo.indexOf("parcelas=")));
  // Cada parcela tem de vir do produtor, não de uma conta nova na tela.
  // ⚠️ A ANCORA E O PAR `valor: <campo>,` — casar so o nome do campo
  // ficava verde com o valor multiplicado, porque o mesmo campo aparece tambem
  // no ROTULO da parcela. Duas ocorrencias, e a assercao achava a inocente.
  for (const campo of ["overview.profit.fees", "overview.profit.cogs", "overview.profit.sellerShipping", "overview.profit.taxes"]) {
    assert.ok(faixa.includes(`valor: ${campo},`), `a faixa deixou de ler ${campo} cru do produtor`);
  }
  // E a contagem de vendas é a mesma do cartão de pedidos.
  assert.ok(faixa.includes("overview.metrics.paidOrders"), "a contagem de vendas virou outra");
  // ⚠️ O lucro respeita `resultIncomplete`: enquanto falta custo, tarifa ou
  // imposto, ele é DESCONHECIDO. Mostrar o parcial em 44px seria a mentira mais
  // cara possível — o número grande é o que a pessoa lê primeiro.
  // ⚠️ A REGRA DO NUMERO GRANDE E A DO CARTAO DE HOJE, LITERAL. A
  // primeira versao punha `resultIncomplete` como porta e o cartao NAO faz isso:
  // ele mostra o numero sempre que `estimatedProfit != null` e troca o ROTULO
  // quando o resultado e parcial. Gate novo seria mudanca de comportamento, e a
  // ordem era "mesmo payload, mesmos numeros que hoje".
  assert.ok(faixa.includes("lucro={overview.profit.estimatedProfit}"),
    "a faixa ganhou uma regra de exibicao que o cartao nao tem");
  assert.ok(!/resultIncomplete/.test(faixa), "voltou o gate que esconde numero que a pagina de hoje mostra");
  // E o rotulo acompanha: nao chamar de LUCRO o que a pagina chama de resultado
  // processado.
  assert.ok(faixa.includes('resultParcial ? "resultado processado" : "lucro"'),
    "a faixa passou a chamar de lucro o resultado parcial");
});

test("as PENDENCIAS sao as mesmas — mesma condicao, mesmo texto, mesmo destino", async () => {
  const codigo = semComentarios(await fonte(ML));
  const lista = codigo.slice(codigo.indexOf("const pendenciasDoCanal"), codigo.indexOf("];", codigo.indexOf("const pendenciasDoCanal")));
  for (const parte of [
    "semAliquota",
    "Cadastrar alíquota",
    "overview.metrics.productsWithoutCost > 0",
    "/mercado-livre/produtos",
    "overview.metrics.cancelledOrders > 0",
    "/mercado-livre/monitor",
    "critical.length > 0",
    "/mercado-livre/estoque",
  ]) {
    assert.ok(lista.includes(parte), `a pendência mudou de condição ou destino: ${parte}`);
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

test("a CONTA ESCRITA leu a mesma composicao — e o calculo continua sendo UM so", async () => {
  const codigo = semComentarios(await fonte(ML));
  // ⚠️ ESTA GUARDA JA TEVE OUTRA INTENCAO, e vale registrar qual: ate
  // 03/09/2026 ela exigia que a ROSQUINHA estivesse na faixa (`slices=` duas
  // vezes, `total={overview.profit.revenueProcessed}`). A dona aprovou a Direcao
  // D — conta escrita no lugar da rosquinha —, entao a exigencia antiga passou a
  // defender o desenho anterior. O que NAO mudou, e e o que ela sempre quis
  // proteger, e o UM CALCULO: quem substituiu a rosquinha le a mesma constante.
  assert.equal(
    (codigo.match(/buildFinancialComposition\(\{/g) ?? []).length, 1,
    "a composicao passou a ser calculada em dois lugares",
  );
  // As linhas da conta escrita NASCEM da composicao — nao de uma lista propria.
  assert.match(codigo, /const linhasDaContaEscrita = composicaoDoResultado/,
    "a conta escrita passou a montar a propria lista, e pode fechar enquanto a barra nao fecha");
  assert.match(codigo, /const fatiaDoResultado = composicaoDoResultado\.find\(\(fatia\) => fatia\.isRemainder\)/,
    "a linha do resultado deixou de sair da composicao");
  // E o painel de baixo continua lendo a mesma constante.
  assert.match(codigo, /slices=\{composicaoDoResultado\}/,
    "o painel de baixo deixou de ler a composicao compartilhada");
  // ⚠️ O ML FICA SEM ROSQUINHA NENHUMA, e isso e o esperado: a de baixo
  // ja tinha saido com `semDonut`, e a de cima virou conta escrita.
  assert.ok(!codigo.includes("<CompositionDonut"),
    "voltou uma rosquinha ao ML — a Direcao D aprovada substitui as duas");
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

test("A ORDEM DOS BLOCOS E A DA PRANCHETA — reprovada uma vez por nao ser", async () => {
  // ⚠️ A v258 FOI REPROVADA PELA DONA por isto, verbatim: *"Eu pedi pra
  // voce fazer exatamente como me apresentou na direcao A"*.
  //
  // O que estava no ar tinha os blocos certos na ORDEM ERRADA: depois da regua
  // de cards vinham o grafico de evolucao e o painel de composicao, e o Top
  // produtos + Rentabilidade ficavam la embaixo. A leitura chegava ao grafico
  // antes de chegar ao produto — o contrario da prancheta aprovada.
  //
  // Ancorado nos BLOCOS REAIS (a marcacao que cada um abre), nao em nomes
  // soltos: casar "TopProductsRanking" provaria que a peca existe, nao que ela
  // esta na posicao aprovada.
  const codigo = semComentarios(await fonte(ML));
  const corpo = codigo.slice(codigo.indexOf("<CockpitDoResultado"));
  const sequencia = [
    ["a faixa do resultado", "<CockpitDoResultado"],
    // ⚠️ OS SETE DIAS MORAM DENTRO DA FAIXA, debaixo da legenda — e a
    // prova disso e ele aparecer ANTES do fechamento da faixa, ou seja, antes
    // dos chips. Fora dela ele viraria mais um cartao, e a leitura "quanto
    // sobrou hoje -> foi um dia bom?" se quebraria no meio.
    ["o lucro por dia", "<LucroPorDia titulo="],
    ["os chips de pendencia", "<LinhaDePendencias itens={pendenciasDoCanal}"],
    ["a regua de cards", 'className="metric-grid ml-dashboard-metric-grid"'],
    ["as duas colunas", 'className="ml-cockpit-duas-colunas"'],
    ["o grafico e a composicao", 'className="performance-panel"'],
  ];
  let anterior = -1;
  for (const [nome, marcador] of sequencia) {
    const posicao = corpo.indexOf(marcador);
    assert.ok(posicao >= 0, `${nome}: o bloco sumiu da pagina`);
    assert.ok(posicao > anterior, `${nome}: saiu da ordem da prancheta`);
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

test("A COR SAI DO MAPA UNICO — e a paleta nova e opt-in do ML", async () => {
  // ⚠️ ESTA GUARDA MUDOU DE INTENCAO UMA VEZ. Ate 03/09/2026 ela PROIBIA
  // hex no ML e exigia `cor: "var(--positive)"` no lucro. A dona aprovou uma
  // paleta por categoria so para o ML (Custo #FF0000 -> Impostos #FFC2C2, lucro
  // no verde #337129 da marca), entao a proibicao passou a defender o cinza que
  // ela mandou tirar.
  //
  // O que a guarda protege agora e a MESMA propriedade por outro caminho: os
  // hex existem em UM dicionario, passado ao mapa de cor compartilhado. A
  // cascata continua sem conhecer tinta nenhuma.
  const donut = semComentarios(await fonte("src/app/components/CompositionDonut.tsx"));
  const ml = semComentarios(await fonte(ML));

  assert.match(donut, /export function tomDaFatia\(/, "o mapa de cor deixou de ser compartilhavel");
  assert.equal((donut.match(/const TONS_CUSTO = \[/g) ?? []).length, 1, "a escala de tinta foi duplicada");
  assert.match(donut, /tom: tomDaFatia\(i, s\)/, "a rosquinha voltou a decidir a cor por conta propria");

  // A cascata busca pela CATEGORIA, nao pela posicao na barra.
  assert.match(ml, /composicaoDoResultado\.findIndex\(\(fatia\) => fatia\.id === id\)/,
    "a cascata voltou a pintar por posicao, e a mesma categoria muda de cor entre os dois lados da faixa");
  for (const categoria of ["fees", "cogs", "shipping", "taxes", "result"]) {
    assert.ok(ml.includes(`cor: corDaCategoria("${categoria}")`), `a parcela ${categoria} voltou a ter cor propria`);
  }

  // ⚠️ OS HEX MORAM NUM LUGAR SO. A cascata e a conta escrita pedem a
  // cor a `corDaCategoria`; nenhuma das duas escreve tinta.
  const paleta = ml.slice(ml.indexOf("const PALETA_DO_ML"), ml.indexOf("};", ml.indexOf("const PALETA_DO_ML")));
  for (const [id, hex] of [["cogs", "#FF0000"], ["shipping", "#FF4D4D"], ["fees", "#FF8585"], ["taxes", "#FFC2C2"], ["result", "#337129"]]) {
    assert.ok(paleta.includes(`${id}: "${hex}"`), `a paleta aprovada mudou: ${id} deixou de ser ${hex}`);
  }
  const semPaleta = ml.slice(0, ml.indexOf("const PALETA_DO_ML")) + ml.slice(ml.indexOf("};", ml.indexOf("const PALETA_DO_ML")));
  assert.ok(!/#[0-9a-fA-F]{6}/.test(semPaleta),
    "apareceu hex fora da paleta: cor copiada e como a mesma categoria acaba com duas tintas");

  // ⚠️ E A PALETA E OPT-IN. Sem o parametro, `tomDaFatia` devolve o que
  // sempre devolveu — e por isso os outros tres canais nao mudam de cor.
  assert.match(donut, /paleta\?: PaletaDeCategoria,/, "a paleta deixou de ser opcional e repinta os quatro canais");
  assert.match(donut, /const daCategoria = paleta && fatia\.id \? paleta\[fatia\.id\] : undefined;/,
    "a consulta a paleta mudou de forma");
  assert.match(ml, /tomDaFatia\(indice, composicaoDoResultado\[indice\], PALETA_DO_ML\)/,
    "o ML parou de passar a paleta e voltaria ao cinza");
});

test("o verde do ML nao vaza para os outros canais", async () => {
  // ⚠️ A ORDEM FOI EXPLICITA (03/09/2026): *"O verde #337129 e do ML — NAO
  // mexa no token global --positive dos outros canais"*.
  //
  // O jeito silencioso de desobedecer seria trocar o token: a tela do ML ficaria
  // certa, e Amazon, Shopee e TikTok mudariam de verde sem ninguem notar, porque
  // nenhum teste olha a cor deles. Por isso a guarda ancora na DEFINICAO do
  // token, nao no uso.
  const css = (await fonte("src/app/globals.css")).replace(/\/\*[\s\S]*?\*\//g, "");

  // ⚠️ COMPARACAO DE STRING LITERAL, e a primeira versao desta assercao
  // NAO era. Ela proibia `--positive: #337129` — e ficou VERDE com a quebra
  // rodada, porque o token nunca foi hex: ele e `oklch(...)`. A guarda "esperta"
  // vigiava uma forma que nao acontece. O que reprova e o valor de hoje, inteiro.
  assert.ok(css.includes("--positive: oklch(0.505 0.102 161);"),
    "o token global --positive mudou de valor: os outros tres canais mudaram de verde junto");

  // O verde do ML mora num token LOCAL da faixa, que so o ML renderiza.
  assert.ok(css.includes(".cockpit-faixa { --ml-verde: #337129; --ml-coluna: #17171733; }"),
    "o verde do ML saiu do escopo da faixa — fora dela ele alcanca quem nao pediu");

  // E o unico lugar do CSS que escreve este hex e essa declaracao.
  assert.equal((css.match(/#337129/g) ?? []).length, 1,
    "o verde do ML foi copiado para outro seletor; um deles vai ficar para tras");

  // ⚠️ E A FAIXA E DO ML: nenhuma outra tela monta o cockpit. Se um dia
  // alguem a reusar, o `--ml-verde` vai junto — e ai a decisao tem de ser da
  // dona, nao efeito colateral de um import.
  for (const tela of [
    "src/app/(app)/amazon/page.tsx",
    "src/app/components/ShopeeWorkspace.tsx",
    "src/app/components/TikTokWorkspace.tsx",
  ]) {
    const fonteDaTela = semComentarios(await fonte(tela));
    assert.ok(!fonteDaTela.includes("CockpitDoResultado"), `${tela} passou a montar a faixa do ML`);
    assert.ok(!fonteDaTela.includes("ContaEscrita"), `${tela} passou a montar a conta escrita do ML`);
    assert.ok(!fonteDaTela.includes("PaletaDeCategoria"), `${tela} passou a pedir a paleta por categoria`);
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
