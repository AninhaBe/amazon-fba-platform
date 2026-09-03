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

test("a ROSQUINHA subiu de lugar, nao de conteudo — e o calculo e UM so", async () => {
  const codigo = semComentarios(await fonte(ML));
  // ⚠️ UM CALCULO, DOIS CONSUMIDORES. A faixa do topo e o painel de baixo
  // leem a MESMA constante. Se cada um montasse a sua, bastaria alguem editar um
  // lado para a tela mostrar duas composicoes diferentes do mesmo periodo, sem
  // nada ficar vermelho — o defeito de "dois consumidores, dois universos".
  assert.equal(
    (codigo.match(/buildFinancialComposition\(\{/g) ?? []).length, 1,
    "a composicao passou a ser calculada em dois lugares",
  );
  assert.equal((codigo.match(/slices=\{composicaoDoResultado\}/g) ?? []).length, 2,
    "a faixa e o painel deixaram de ler a mesma composicao");
  // E o total da rosquinha continua sendo a receita processada, como no painel.
  assert.match(codigo, /total=\{overview\.profit\.revenueProcessed\}/);
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

test("A COR DA CASCATA SAI DO MESMO MAPA DA ROSQUINHA — nao de hex copiado", async () => {
  // ⚠️ Ordem da dona (03/09/2026): *"as cores de identificacao de cada um
  // pode mudar. Senao vai ficar tudo cinza"*. A escolha foi: uma categoria, UMA
  // cor na pagina inteira — a vendedora aprende a cor uma vez e le a barra e a
  // rosquinha juntas.
  //
  // Dois mapas seriam dois universos visuais do mesmo numero: a versao grafica
  // do defeito de "dois consumidores, dois universos".
  const donut = semComentarios(await fonte("src/app/components/CompositionDonut.tsx"));
  const ml = semComentarios(await fonte(ML));

  // O mapa existe UMA vez, e e exportado.
  assert.match(donut, /export function tomDaFatia\(/, "o mapa de cor deixou de ser compartilhavel");
  assert.equal((donut.match(/const TONS_CUSTO = \[/g) ?? []).length, 1, "a escala de tinta foi duplicada");
  // E a propria rosquinha consome a funcao, em vez de repetir a regra.
  assert.match(donut, /tom: tomDaFatia\(i, s\)/, "a rosquinha voltou a decidir a cor por conta propria");

  // A cascata busca pela CATEGORIA, nao pela posicao na barra: as duas listas
  // tem ordens diferentes de proposito.
  assert.match(ml, /composicaoDoResultado\.findIndex\(\(fatia\) => fatia\.id === id\)/,
    "a cascata voltou a pintar por posicao, e a mesma categoria muda de cor entre a barra e a rosquinha");
  for (const categoria of ["fees", "cogs", "shipping", "taxes"]) {
    assert.ok(ml.includes(`cor: corDaCategoria("${categoria}")`), `a parcela ${categoria} voltou a ter cor propria`);
  }
  // ⚠️ E NENHUM HEX OU TOM SOLTO na cascata: o unico literal permitido e
  // o verde do lucro, que e estado e nao categoria de custo.
  const faixa = ml.slice(ml.indexOf("parcelas={["), ml.indexOf("]}", ml.indexOf("parcelas={[")));
  assert.ok(!/#[0-9a-fA-F]{3,8}/.test(faixa), "voltou hex copiado para a cascata");
  assert.ok(!/color-mix/.test(faixa), "a cascata voltou a escrever a propria tinta");
  assert.match(faixa, /cor: "var\(--positive\)"/, "o lucro deixou de usar a cor de estado");
});
