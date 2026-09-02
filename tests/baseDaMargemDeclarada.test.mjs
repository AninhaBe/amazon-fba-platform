import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { amazonFinancialCards } from "../src/app/(app)/amazon/amazonFinancialCards.ts";

// A MARGEM IMPOSSIVEL (achada por ela em 30/08/2026).
//
// A tela mostrava, no mesmo instante:
//   Faturamento R$ 1.143,74 · Custo R$ 154,49 · Lucro R$ 263,94 · Margem 63,1%
//
// Nenhum par daqueles numeros produz 63,1%: 263,94 / 1.143,74 = 23,1%. O que
// fechava era 263,94 / 418,43 = 63,08% — e os 418,43 nao estavam em lugar nenhum
// da tela. Ela olhou, nao fechou, e concluiu que estava errado. Estava CERTA.
//
// A CAUSA (`src/app/(app)/amazon/page.tsx`): a pagina sobrescrevia o VALOR do card
// "Faturamento" mantendo o ROTULO, enquanto `amazonFinancialCards` seguia
// calculando a margem sobre `finance.revenue`, a base apurada. Lucro e margem de
// um universo, exibidos ao lado do faturamento de outro.
//
// ⚠️ A REGRA QUE FICA: margem nunca pode ser calculada sobre base diferente da
// que o card ao lado exibe SEM DECLARAR qual e. Nao e proibido ter duas bases —
// e proibido ter duas bases em silencio.

const carta = (cards, key) => cards.find((c) => c.key === key);
const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");

const FINANCE = {
  currency: "BRL", revenue: 418.43, fees: 0, refunds: 0, buyerShipping: 0,
  orderCount: 22, feeBreakdown: [{ type: "commission", amount: 0 }],
};
const base = {
  finance: FINANCE, cogs: 154.49, estimatedProfit: 263.94, unitsWithoutCost: 0,
  faturamentoTotal: 1270.13, pedidosAguardando: 40,
};

test("o card Faturamento mostra TODOS os pedidos — decisao dela de 30/08/2026", () => {
  // "Faturamento deve significar todos os pedidos independente de status
  // Confirmado. Pode ser Pendente que entrara na conta."
  const cards = amazonFinancialCards(base);
  assert.equal(carta(cards, "revenue").raw, 1270.13);
});

test("a margem sai do FATURAMENTO — a base apurada foi abolida em 31/08/2026", () => {
  // ⚠️ ESTE TESTE MUDOU DE INTENCAO, e a anterior fica registrada.
  //
  // ATE 31/08/2026 ele exigia o CONTRARIO: margem sobre `finance.revenue` (a
  // base apurada), com o argumento "somar pendente sem custo inflaria o lucro".
  // O argumento era honesto e a vendedora o derrubou explicitamente, na quarta
  // vez que pediu a mesma coisa e a primeira em caixa alta:
  //
  //   "TEM QUE ESQUECER O APURADO E LEVAR EM CONSIDERACAO SOMENTE O FATURAMENTO."
  //
  // O que ela respondeu ao argumento: o pendente sem custo NAO reduz a base —
  // ele vira SINAL ao lado do numero, com quantidade. O erro do dado que falta
  // nao e dela e nao justifica encolher a conta.
  const cards = amazonFinancialCards({ ...base, baseDoLucro: 1270.13 });
  assert.equal(carta(cards, "marginPct").raw, (263.94 / 1270.13) * 100);
});

test("a margem diz sobre o que ela e, e nao inventa uma segunda base", () => {
  // ⚠️ ESTE TESTE MUDOU DE INTENCAO, e a anterior fica registrada.
  //
  // ATE 31/08/2026 ele exigia OS DOIS numeros no contexto ("418,43 apurados de
  // 1.270,13"), porque havia duas bases e o SILENCIO entre elas era o defeito.
  // A vendedora aboliu a segunda base — "TEM QUE ESQUECER O APURADO" — entao
  // declarar duas agora reintroduziria a confusao que a frase resolvia.
  const cards = amazonFinancialCards({ ...base, baseDoLucro: 1270.13 });
  const contexto = carta(cards, "marginPct").context;
  assert.match(contexto, /faturamento/i, "a margem precisa dizer sobre o que ela e");
  assert.doesNotMatch(contexto, /apurados de/, "duas bases nao existem mais");
  assert.doesNotMatch(contexto, /parcial|incompleto/i);
});

test("o que FALTA vem em campo proprio, para a tela renderizar sem hover", () => {
  // ⚠️ ESTE TESTE NASCEU DE UMA FALHA DO TESTE ACIMA (31/08/2026), e a parte
  // que importa dele NAO mudou: o que a tela precisa dizer vai num campo
  // RENDERIZADO SEM INTERACAO, nunca no "i".
  //
  // O de cima passava — a frase existia — e mesmo assim a vendedora olhou a
  // tela, viu lucro e margem sobre R 748,56 ao lado de um Faturamento de
  // R 1.068,37, e concluiu que estava errado. A declaracao morava no `context`,
  // que a pagina joga no tooltip. "O teste garantiu a frase, nao a leitura."
  //
  // O QUE MUDOU e o CONTEUDO: nao ha segunda base para declarar. O campo passa
  // a carregar o que FALTA — pedidos ainda sem custo e tarifa apurados, com
  // numero. Eles seguem DENTRO da base; o sinal existe porque tornam o lucro
  // otimista, nunca porque encolhem a conta.
  const cards = amazonFinancialCards({ ...base, baseDoLucro: 1270.13, pedidosSemValor: 40 });
  for (const key of ["marginPct", "profit"]) {
    assert.ok(carta(cards, key).baseDeclarada, `${key} precisa expor em campo proprio`);
  // ⚠️ A FRASE MUDOU DE PROPOSITO EM 01/09/2026, e este vermelho foi legitimo.
  // Ela dizia "ainda sem custo e tarifa apurados" e apontava o componente
  // ERRADO: o que falta nesses pedidos e o VALOR, que a Amazon nao publicou.
  // Custo e tarifa nos temos — a tarifa observada cobria 12 dos 13 ASINs do dia.
  // A frase antiga mandava cadastrar custo que ja estava cadastrado.
    assert.match(carta(cards, key).baseDeclarada, /40 pedidos do período ainda sem valor publicado pela Amazon/);
    assert.doesNotMatch(carta(cards, key).baseDeclarada, /apurados de/);
  }
});

test("bases iguais NAO produzem campo — ruido tambem e defeito", () => {
  const cards = amazonFinancialCards({ ...base, faturamentoTotal: 418.43, baseDoLucro: 418.43, pedidosSemValor: 0 });
  for (const key of ["marginPct", "profit"]) {
    assert.equal(carta(cards, key).baseDeclarada, undefined);
  }
});

test("a tela RENDERIZA a base, e nao so no tooltip", async () => {
  // A trava no lugar onde o defeito estava: `sub` aparece sem interacao, `info`
  // exige hover. Se `baseDeclarada` voltar a sair so pelo `info`, isto quebra.
  const page = await fonte("src/app/(app)/amazon/page.tsx");
  const ocorrencias = (page.match(/sub=\{card\.baseDeclarada\}/g) ?? []).length;
  assert.equal(ocorrencias, 2, "os dois ramos de card (lucro e demais) precisam renderizar a base");
  // E ela nunca pode sair pelo "i": foi ali que a frase ficou invisivel o dia
  // inteiro em 31/08/2026.
  const codigo = page.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(!/info=\{card\.baseDeclarada/.test(codigo), "a base nunca pode sair pelo 'i'");
});

test("bases IGUAIS nao ganham declaracao — ruido tambem e defeito", () => {
  // Quando todo o periodo esta apurado, nao ha duas bases e nao ha o que
  // declarar. Explicar uma diferenca que nao existe treina a pessoa a ignorar a
  // frase justamente no dia em que ela importa.
  const cards = amazonFinancialCards({ ...base, faturamentoTotal: 418.43, baseDoLucro: 418.43, pedidosSemValor: 0 });
  assert.doesNotMatch(carta(cards, "marginPct").context, /apurados de/);
});

test("a tela nao pode voltar a sobrescrever o valor de um card", async () => {
  // A trava no lugar onde o defeito nasceu. O numero do card sai do modulo que
  // tambem calcula a margem; trocar o valor na renderizacao recria as duas
  // definicoes que este teste existe para impedir.
  const page = await fonte("src/app/(app)/amazon/page.tsx");
  assert.doesNotMatch(
    page,
    /value=\{faturamento\?\.revenue \?\? card\.raw/,
    "sobrescrever o card de faturamento na tela foi o defeito de 30/08/2026",
  );
  assert.match(page, /faturamentoTotal: pedidosFeitos\?\.revenue/, "a base entra por parametro, nao por override");
});
