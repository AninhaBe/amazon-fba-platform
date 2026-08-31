import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { amazonFinancialCards } from "../src/app/amazon/amazonFinancialCards.ts";

// A MARGEM IMPOSSIVEL (achada por ela em 30/08/2026).
//
// A tela mostrava, no mesmo instante:
//   Faturamento R$ 1.143,74 · Custo R$ 154,49 · Lucro R$ 263,94 · Margem 63,1%
//
// Nenhum par daqueles numeros produz 63,1%: 263,94 / 1.143,74 = 23,1%. O que
// fechava era 263,94 / 418,43 = 63,08% — e os 418,43 nao estavam em lugar nenhum
// da tela. Ela olhou, nao fechou, e concluiu que estava errado. Estava CERTA.
//
// A CAUSA (`src/app/amazon/page.tsx`): a pagina sobrescrevia o VALOR do card
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

test("a margem continua na base APURADA — somar pendente sem custo inflaria o lucro", () => {
  // Pedido pendente na Amazon nao tem valor, nem item, nem tarifa (medido em
  // 30/08: 40 pendentes, zero itens, zero tarifas). Se o lucro seguisse o
  // faturamento, ele somaria receita sem o custo correspondente.
  const cards = amazonFinancialCards(base);
  assert.equal(carta(cards, "marginPct").raw, (263.94 / 418.43) * 100);
});

test("e a base APARECE na tela, com numero — nunca em silencio", () => {
  const cards = amazonFinancialCards(base);
  const contexto = carta(cards, "marginPct").context;
  assert.match(contexto, /418,43/, "a base apurada precisa estar escrita");
  assert.match(contexto, /1\.270,13/, "e o total de onde ela sai tambem");
  // A invariante e "o que falta, COM NUMERO" — nao a tipografia do plural. A
  // frase saiu de `amazonFinancialCards` para `baseDaMargem` (compartilhada com
  // os quatro canais) e passou a flexionar de verdade: "1 pedido" / "40
  // pedidos", no lugar de "pedido(s)".
  assert.match(contexto, /40 pedidos? aguardando/, "e o que falta, com numero");
  // AGENTS.md: "parcial" explica ao vendedor o que ele ja sabe, em vez de dizer
  // o que falta. A frase acima diz o que falta, com numero.
  assert.doesNotMatch(contexto, /parcial|incompleto/i);
});

test("a base vem em CAMPO PROPRIO, para a tela poder renderizar sem hover", () => {
  // ⚠️ ESTE TESTE NASCEU DE UMA FALHA DO TESTE ACIMA (31/08/2026).
  //
  // O de cima passava — a frase existia — e mesmo assim a vendedora olhou a
  // tela, viu lucro e margem sobre R 748,56 ao lado de um Faturamento de
  // R 1.068,37, e concluiu que estava errado. A declaracao morava no
  // `context`, que a pagina joga no "i": um tooltip que ninguem abre.
  //
  // "O teste garantiu a frase, nao a leitura." O criterio passou a ser: existir
  // num campo que a tela RENDERIZA SEM INTERACAO.
  const cards = amazonFinancialCards(base);
  for (const key of ["marginPct", "profit"]) {
    assert.ok(carta(cards, key).baseDeclarada, `${key} precisa expor a base em campo proprio`);
    assert.match(carta(cards, key).baseDeclarada, /418,43[\s\S]*1\.270,13/);
  }
});

test("bases iguais NAO produzem campo — ruido tambem e defeito", () => {
  const cards = amazonFinancialCards({ ...base, faturamentoTotal: 418.43, pedidosAguardando: 0 });
  for (const key of ["marginPct", "profit"]) {
    assert.equal(carta(cards, key).baseDeclarada, undefined);
  }
});

test("a tela RENDERIZA a base, e nao so no tooltip", async () => {
  // A trava no lugar onde o defeito estava: `sub` aparece sem interacao, `info`
  // exige hover. Se `baseDeclarada` voltar a sair so pelo `info`, isto quebra.
  const page = await fonte("src/app/amazon/page.tsx");
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
  const cards = amazonFinancialCards({ ...base, faturamentoTotal: 418.43, pedidosAguardando: 0 });
  assert.doesNotMatch(carta(cards, "marginPct").context, /apurados de/);
});

test("a tela nao pode voltar a sobrescrever o valor de um card", async () => {
  // A trava no lugar onde o defeito nasceu. O numero do card sai do modulo que
  // tambem calcula a margem; trocar o valor na renderizacao recria as duas
  // definicoes que este teste existe para impedir.
  const page = await fonte("src/app/amazon/page.tsx");
  assert.doesNotMatch(
    page,
    /value=\{faturamento\?\.revenue \?\? card\.raw/,
    "sobrescrever o card de faturamento na tela foi o defeito de 30/08/2026",
  );
  assert.match(page, /faturamentoTotal: pedidosFeitos\?\.revenue/, "a base entra por parametro, nao por override");
});
