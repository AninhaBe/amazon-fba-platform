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
  assert.match(contexto, /40 pedido\(s\) aguardando/, "e o que falta, com numero");
  // AGENTS.md: "parcial" explica ao vendedor o que ele ja sabe, em vez de dizer
  // o que falta. A frase acima diz o que falta, com numero.
  assert.doesNotMatch(contexto, /parcial|incompleto/i);
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
