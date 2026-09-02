import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildFinancialComposition } from "../src/app/components/composicaoFinanceira.ts";

const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
const semComentarios = (codigo) =>
  codigo.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/**
 * ⚠️ O DEFEITO, com as palavras dela (02/09/2026) sobre o painel "Repasses,
 * taxas e resultado": *"redundante e mal formatada"*. No print: uma fatia
 * `Composição pendente R$ 192.280,57` sem dizer O QUE falta, três linhas
 * seguidas exibindo só "—", e dois avisos que se desmentiam.
 */

test("SEM decomposicao, o painel continua igual — as outras telas nao mudam", () => {
  const fatias = buildFinancialComposition({
    total: 1000,
    costs: [{ id: "fees", label: "Taxas", value: 200 }],
    result: null,
  });
  const pendente = fatias.find((f) => f.isPending);
  assert.equal(pendente.label, "Composição pendente", "a fatia unica mudou para quem nao pediu decomposicao");
  assert.equal(pendente.value, 800);
});

test("COM decomposicao, a pendencia vira partes NOMEADAS", () => {
  const fatias = buildFinancialComposition({
    total: 1000,
    costs: [{ id: "fees", label: "Taxas", value: 200 }],
    result: null,
    pendencias: [
      { rotulo: "Aguardando repasse da Shopee (12 venda(s))", valor: 500 },
      { rotulo: "Sem custo cadastrado (3 unidade(s))" },
    ],
  });
  const rotulos = fatias.filter((f) => f.isPending).map((f) => f.label);
  assert.ok(rotulos.some((r) => /Aguardando repasse/.test(r)), "a parte da espera sumiu");
  assert.ok(rotulos.some((r) => /Sem custo cadastrado/.test(r)), "a parte do custo sumiu");
  assert.ok(!rotulos.includes("Composição pendente"), "o balaio voltou junto com as partes");
});

test("e o que sobra depois das partes CONTINUA aparecendo — a soma nao pode furar", () => {
  // ⚠️ Esconder o resto faria o painel deixar de fechar: as fatias somariam
  // menos que o total, e ninguem veria a diferenca. Some o NOME, nunca o valor.
  const fatias = buildFinancialComposition({
    total: 1000,
    costs: [{ id: "fees", label: "Taxas", value: 200 }],
    result: null,
    pendencias: [{ rotulo: "Aguardando repasse", valor: 300 }],
  });
  const soma = fatias.reduce((total, f) => total + f.value, 0);
  assert.equal(Math.round(soma), 1000, "as fatias deixaram de somar o total");
  assert.ok(fatias.some((f) => f.label === "Ainda sem classificação"), "o resto sumiu do painel");
});

test("o custo nao cadastrado NAO vira fatia de valor zero", async () => {
  // ⚠️ CORRECAO DE DOUTRINA (02/09/2026): a primeira versao mandava o
  // custo faltante como parte com valor 0, e isso viola o `null != 0` na cara —
  // zero AFIRMA que o custo que falta e zero.
  //
  // E na tela ele nem aparecia: o donut filtra fatia com valor 0
  // (`slices.filter((s) => s.value > 0)`), entao a pendencia sumia inteira. O
  // zero era invisivel e errado ao mesmo tempo.
  //
  // Ele vive no RODAPE, com contagem e link — a forma da casa para pendencia.
  const tela = semComentarios(await fonte("src/app/components/ShopeeModulePage.tsx"));
  assert.ok(!/Sem custo cadastrado \(\$\{profit\.unitsWithoutCost\}/.test(tela),
    "o custo faltante voltou a ser fatia da composicao");
  assert.match(tela, /\{profit\.unitsWithoutCost\} unidade\(s\) sem custo cadastrado/,
    "a contagem sumiu do rodape");
  assert.match(tela, /href="\/shopee\/produtos" className="meli-financial-link">cadastrar/,
    "o caminho para resolver sumiu");

  // E a peca continua aceitando parte sem valor sem inventar numero — quem
  // passar uma vai ver zero, e por isso ninguem passa mais.
  const fatias = buildFinancialComposition({
    total: 1000, costs: [], result: null,
    pendencias: [{ rotulo: "Alguma espera sem valor" }],
  });
  assert.equal(fatias.find((f) => /Alguma espera/.test(f.label)).value, 0);
});

test("as linhas que so mostrariam travessao NAO sao renderizadas", async () => {
  const codigo = semComentarios(await fonte("src/app/components/ShopeeModulePage.tsx"));
  // Ancorado na RAMIFICACAO de cada uma: casar o rotulo provaria so que o texto
  // existe, nao que ele deixou de aparecer vazio.
  assert.match(codigo, /\{profit\.composicaoDaReceitaPaga\.lucro!=null&&<Flow/, "a linha do lucro voltou a mostrar travessao");
  assert.match(codigo, /\{margemDaReceitaPaga!=null&&<Flow/, "a linha da margem voltou a mostrar travessao");
  assert.match(codigo, /\{knownCosts!=null&&<FlowExpandable/, "a linha de custos voltou a mostrar travessao");
});

test("os dois avisos param de se desmentir — a descricao diz o que falta", async () => {
  const codigo = semComentarios(await fonte("src/app/components/ShopeeModulePage.tsx"));
  assert.match(codigo, /description=\{descricaoDaComposicao\(profit\)\}/, "a descricao voltou a ser a contagem crua");
  // ⚠️ A frase antiga dizia "processado em X de Y" mesmo com 100% processado e
  // custo faltando — o selo dizia "Faltam custos" ao lado. A proibicao le o
  // fonte SEM COMENTARIOS: a nota que explica a troca cita a frase trocada.
  assert.ok(!/Detalhamento processado em/.test(codigo), "a frase que se desmentia voltou");
});

test("e a TELA passa a decomposicao — a peca sozinha nao basta", async () => {
  // ⚠️ ESTA QUEBRA FICOU VERDE NA PRIMEIRA RODADA: apagar
  // `pendencias:pendenciasDaComposicao(profit)` devolvia o balaio a tela e
  // nenhum teste reclamava. Os outros mediam a PECA; ninguem media a ligacao.
  // E o mesmo buraco do mapeador da procedencia, dois dias atras.
  const codigo = semComentarios(await fonte("src/app/components/ShopeeModulePage.tsx"));
  assert.match(codigo, /pendencias:pendenciasDaComposicao\(profit\)/, "a tela parou de nomear a pendencia");
  // E as duas partes precisam existir na funcao que as monta.
  assert.match(codigo, /Aguardando itens do pedido/, "a parte da espera sumiu da tela");
  // ⚠️ O CUSTO NAO E MAIS FATIA — ele saiu daqui em 02/09/2026 e foi para o
  // rodape, com contagem e link, porque fatia de valor zero afirma que o custo
  // que falta e zero. A assercao dele vive no teste da doutrina, logo acima.
  assert.match(codigo, /sem custo cadastrado/, "a pendencia do custo sumiu da tela inteira");
});

test("A HIPOTESE DA TARIFA FOI MEDIDA E DERRUBADA — ela nao entra na tela", async () => {
  // ⚠️ ESTE TESTE NASCEU DE UM ERRO MEU (02/09/2026). Eu ia nomear o
  // buraco de R$ 192.629,78 como "Tarifa + resultado — aguardando conciliacao
  // da Shopee", porque o card dizia "Tarifas: ainda nao conciliadas" e o topo
  // falava em 10.143 de 10.146.
  //
  // A MEDICAO NO BANCO DERRUBOU: zero tarifas com valor nulo nessa conexao, e a
  // receita sem comissao e R$ 1.820,49 — nao 192 mil. O buraco e, em boa parte,
  // RESULTADO mais custo nao cadastrado.
  //
  // E a leitura errada tinha nome: `processedOrders` e
  // `COUNT(*) FILTER (WHERE has_items)` — pedido que TEM ITEM, nao pedido
  // conciliado. Eu li uma contagem como se fosse outra.
  //
  // Chamar resultado de pendencia e a familia que este projeto passou dois dias
  // tirando da tela; a guarda existe para nao voltar por aqui.
  const codigo = semComentarios(await fonte("src/app/components/ShopeeModulePage.tsx"));
  assert.ok(!/aguardando conciliação da Shopee/.test(codigo), "a causa que a medicao derrubou voltou a tela");
  assert.ok(!/Tarifa \+ resultado/.test(codigo), "o rotulo que afirma tarifa faltando voltou");
  // E o nome do que sobra segue o SCHEMA: itens do pedido, nao repasse.
  assert.match(codigo, /Aguardando itens do pedido/, "o nome voltou a afirmar um estado financeiro que a contagem nao mede");
  assert.ok(!/aguardando repasse da Shopee/i.test(codigo), "voltou a chamar 'tem item' de 'repasse processado'");
});

test("sem herdeira, o resto CONTINUA aparecendo sem nome — honesto e nao escondido", () => {
  const fatias = buildFinancialComposition({
    total: 1000, costs: [], result: null,
    pendencias: [{ rotulo: "Aguardando repasse", valor: 300 }],
  });
  assert.ok(fatias.some((f) => f.label === "Ainda sem classificação"), "o resto sumiu quando ninguem responde por ele");
});

test("o CUSTO nao aparece mais no subtitulo do painel — uma vez so, no rodape", async () => {
  // ⚠️ O print dela mostrava "sem custo cadastrado" TRES vezes na mesma
  // tela: alerta do topo (por SKU), subtitulo do painel e rodape do painel.
  // Ficou a que tem CAMINHO. A proibicao le o fonte sem comentarios — a nota
  // que explica a remocao cita a frase removida.
  const codigo = semComentarios(await fonte("src/app/components/ShopeeModulePage.tsx"));
  const descricao = codigo.slice(codigo.indexOf("function descricaoDaComposicao"), codigo.indexOf("function pendenciasDaComposicao"));
  assert.ok(!/unitsWithoutCost/.test(descricao), "o custo voltou ao subtitulo do painel");
  assert.match(descricao, /aguardando itens do pedido/, "a espera real sumiu do subtitulo");
  // E o rodape, que e o que fica, continua com contagem E link.
  assert.match(codigo, /\{profit\.unitsWithoutCost\} unidade\(s\) sem custo cadastrado/);
  assert.match(codigo, /className="meli-financial-link">cadastrar/);
});

test("Lucro e Margem em branco APONTAM A CAUSA, nao o recorte", async () => {
  const codigo = semComentarios(await fonte("src/app/components/ShopeeModulePage.tsx"));
  // Os DOIS cards, nao um: casar a funcao uma vez ficava verde com o outro
  // cartao revertido — a quebra mostrou isso.
  assert.match(codigo, /profit\.estimatedProfit==null\?porQueSemResultado\(profit\)/, "o card de Lucro voltou a descrever so o periodo");
  assert.match(codigo, /profit\.marginPct==null\?porQueSemResultado\(profit\)/, "o card de Margem voltou a descrever so o periodo");
  assert.match(codigo, /falta custo cadastrado/, "a causa medida como dominante sumiu");
  // ⚠️ E nao pode ser adjetivo que se desculpa (AGENTS.md).
  // ⚠️ A PROIBICAO OLHA AS FRASES, NAO O FONTE INTEIRO: `resultIncomplete`
  // e `custoIncompleto` sao IDENTIFICADORES, e casá-los reprovaria codigo que
  // nunca chega a tela. Guarda que acusa inocente e desligada na primeira
  // semana (docs/achado-guarda-que-depende-da-forma.md).
  const frases = [...codigo.matchAll(/return "([^"]+)";/g)].map((m) => m[1]);
  for (const frase of frases) {
    assert.ok(!/parcial|incompleto/i.test(frase), `voltou adjetivo que se desculpa: "${frase}"`);
  }
});
