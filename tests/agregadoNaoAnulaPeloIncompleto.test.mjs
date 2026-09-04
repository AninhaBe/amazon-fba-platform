import test from "node:test";
import assert from "node:assert/strict";
import { amazonFinancialCards } from "../src/app/(app)/amazon/amazonFinancialCards.ts";

const carta = (cards, key) => cards.find((c) => c.key === key);

// ⚠️ O BALAIO, TERCEIRA APARICAO — e a vendedora provou com planilha na mao.
//
// Defeito real que este teste reprova (04/09/2026, conta A15NQMF7A6J1Y0, print
// as 12:01): Taxas, Repasse, Lucro e Margem em TRAVESSAO enquanto o produtor
// entregava `fees = R$ 136,54`, `cogs = R$ 163,69` e `lucro = R$ 252,55`. Ela,
// verbatim: *"está simulando conforme tabela amazon, mas vc nao ta conseguindo
// entregar essa informação no front"*. O numero certo estava no payload; a
// camada de card o jogava fora.
//
// 📌 A CAUSA era `semRepassePostado` — guarda escrita quando o extrato era a
// UNICA fonte de tarifa. Ali "nao postou" significava mesmo "nao sei quanto".
// A tarifa calculada pela tabela (ADR-027) acabou com a exclusividade, e a
// guarda sobreviveu a limitacao que a justificava: e o capitulo "recusa
// temporaria morre junto com a limitacao" do AGENTS, em forma de travessao.
//
// ⚠️ E O PONTO QUE ESTE ARQUIVO EXISTE PARA FIXAR: agregado soma o que e
// CONHECIDO. Pedido sem valor publicado fica de fora da soma e vira
// APONTAMENTO COM NUMERO — nunca anula o total dos que estao completos, e
// nunca aparece como a palavra "parcial".

/** 13 pedidos completos + 2 sem valor publicado — o cenario exato do print. */
const CENARIO = {
  // `orderCount: 0` = a Amazon nao postou repasse de NENHUM pedido. E o estado
  // normal de uma manha, e era ele que apagava a tela inteira.
  finance: { currency: "BRL", revenue: 12.89, fees: null, refunds: 0, promotions: 0, buyerShipping: 0, orderCount: 0, feeBreakdown: [] },
  faturamentoTotal: 552.78,
  baseDoLucro: 552.78,
  feesDoLucro: 136.54,
  pedidosComTarifaEstimada: 13,
  cogs: 163.69,
  estimatedProfit: 252.55,
  unitsWithoutCost: 0,
  pedidosDoPeriodo: 15,
  pedidosSemValor: 2,
  taxRate: 0,
  ads: null,
};

test("agregado com pedidos incompletos", async (t) => {
  const cards = amazonFinancialCards(CENARIO);

  await t.test("🔴 Taxas mostra o total CALCULADO, mesmo sem repasse postado", () => {
    const c = carta(cards, "fees");
    assert.equal(c.raw, 136.54, "13 pedidos calculados nao podem virar travessao por causa de 2 sem valor");
    assert.match(c.value, /136,54/);
  });

  await t.test("🔴 Lucro existe e sai do mesmo numero do produtor", () => {
    const c = carta(cards, "profit");
    assert.equal(c.raw, 252.55, "a manchete afirmava o lucro enquanto o card o negava — a mesma pagina nao pode fazer as duas");
    assert.notEqual(c.value, "—");
  });

  await t.test("🔴 Margem e afirmada, sobre a base declarada", () => {
    const c = carta(cards, "marginPct");
    assert.notEqual(c.value, "—", "com 13 de 15 valorizados a base cobre a MAIORIA; a margem descreve o periodo");
    // 252,55 / 552,78 = 45,7%
    assert.match(c.value, /45/);
  });

  await t.test("Custo aparece — e cadastro dela, nao extrato da Amazon", () => {
    assert.equal(carta(cards, "cogs").raw, 163.69);
  });

  await t.test("🔴 a falta vira APONTAMENTO COM NUMERO, nunca a palavra parcial", () => {
    const texto = JSON.stringify(cards);
    assert.match(texto, /2 de 15 pedidos do período ainda sem valor publicado/,
      "o que falta se aponta com numero (AGENTS.md)");
    assert.ok(!/parcial/i.test(texto), "a palavra 'parcial' se desculpa em vez de apontar");
  });
});

test("o que vem SO do extrato continua em travessao, com o motivo", async (t) => {
  const cards = amazonFinancialCards(CENARIO);
  // ⚠️ Isto NAO e sobra do defeito: e a metade da guarda que continua certa.
  // Repasse liquido, Logistica FBA e Frete do comprador nao tem estimativa —
  // para eles "nao postou" e mesmo "nao sei quanto", e inventar numero ali
  // seria trocar um defeito por outro pior.
  // ⚠️ A PRIMEIRA VERSAO DESTE BLOCO ITERAVA "netProceeds", QUE NAO EXISTE —
  // e com `if (!c) continue` ele passava sem medir nada. Guarda vacua e pior
  // que guarda nenhuma: da a sensacao de cobertura. As chaves agora sao
  // conferidas contra os cards de verdade, e a contagem entra na assercao.
  const SO_DO_EXTRATO = ["fbaShipping", "buyerShipping", "commission", "refunds"];
  const encontrados = SO_DO_EXTRATO.map((k) => carta(cards, k)).filter(Boolean);
  await t.test("as chaves testadas existem de verdade", () => {
    assert.equal(encontrados.length, SO_DO_EXTRATO.length,
      "chave inexistente faria este teste passar sem medir nada");
  });
  for (const c of encontrados) {
    await t.test(`${c.key} espera o extrato e diz isso`, () => {
      assert.equal(c.value, "—", `${c.key} nao tem estimativa: inventar numero seria trocar um defeito por outro`);
      assert.match(c.context, /Aguardando/);
    });
  }
});

test("sem extrato E sem estimativa, a tarifa volta a ser desconhecida", () => {
  // A guarda nao foi removida — foi ESTREITADA. Sem nenhuma das duas fontes,
  // travessao continua sendo a resposta honesta.
  const cards = amazonFinancialCards({ ...CENARIO, feesDoLucro: null, pedidosComTarifaEstimada: 0 });
  assert.equal(carta(cards, "fees").value, "—");
  assert.match(carta(cards, "fees").context, /Aguardando repasse postado/);
});

test("a margem so e suprimida por quem esta FORA do resultado", async (t) => {
  // ⚠️ DEFEITO REAL, conta da vendedora em 04/09/2026: 2 pedidos no dia, os dois
  // sem valor publicado, os dois COM custo cadastrado. O lucro saia (R$ 8,90) e
  // a margem ficava em travessao, porque a guarda contava `pedidosSemValor` —
  // conceito do mundo em que esse pedido ficava FORA da base.
  //
  // 📌 Hoje ele esta DENTRO (entra pelo preco de anuncio). Quem fica de fora e o
  // pedido sem CUSTO cadastrado. A guarda continua existindo com a mesma
  // intencao — nao afirmar percentual que cobre menos da metade do periodo —,
  // medida sobre quem esta realmente fora.
  const CENARIO_DELA = {
    finance: { currency: "BRL", revenue: 0, fees: null, refunds: 0, promotions: 0, buyerShipping: 0, orderCount: 0, feeBreakdown: [] },
    faturamentoTotal: 44.22, baseDoLucro: 44.22, pedidosCompletos: 2,
    feesDoLucro: 11.30, pedidosComTarifaEstimada: 2, cogs: 13.64, estimatedProfit: 8.90,
    unitsWithoutCost: 0, pedidosDoPeriodo: 2, pedidosSemValor: 2, taxRate: 0, ads: null,
  };

  await t.test("🔴 todos sem valor publicado, todos com custo: a margem e AFIRMADA", () => {
    const c = carta(amazonFinancialCards(CENARIO_DELA), "marginPct");
    assert.notEqual(c.value, "—", "os 2 pedidos estao DENTRO da base; suprimir a margem nega o proprio numero");
    assert.match(c.value, /20,1/);
  });

  await t.test("🔴 a base declarada diz COMO o numero foi feito", () => {
    // ⚠️ ESTE TESTE JA NASCEU ERRADO E FOI CORRIGIDO NO MESMO DIA. A primeira
    // versao PROIBIA o apontamento "ainda sem valor publicado" ao lado da base
    // declarada, por parecer repeticao. Quatro guardas antigas — vindas de
    // pedido dela — exigem o contrario: o que falta vem em CAMPO PROPRIO, para
    // a tela renderizar sem hover. As duas frases tem papeis distintos: a base
    // diz COMO (preco de anuncio), o apontamento diz O QUE FALTA (valor
    // oficial). Prevaleceu a regra dela.
    const c = carta(amazonFinancialCards(CENARIO_DELA), "profit");
    // `\s` e nao " ": o Intl pt-BR separa "R$" do numero com espaco NAO-QUEBRAVEL.
    assert.match(c.baseDeclarada, /Sobre R\$\s44,22 em 2 pedidos/);
    assert.match(c.baseDeclarada, /preço de anúncio nos 2 ainda não publicados/);
  });

  await t.test("🔴 com a MAIORIA fora do resultado, a margem some — a guarda continua viva", () => {
    // 10 pedidos no periodo, so 4 com custo cadastrado: 6 fora, 6*2 > 10.
    const c = carta(amazonFinancialCards({ ...CENARIO_DELA, pedidosDoPeriodo: 10, pedidosCompletos: 4 }), "marginPct");
    assert.equal(c.value, "—", "percentual que cobre menos da metade do periodo nao descreve o periodo");
    assert.match(c.context, /6 de 10 pedidos do período sem custo cadastrado/);
  });
});

test("lucro e margem sao um PAR — mesma base, mesma condicao", async (t) => {
  // ⚠️ DEFEITO REAL (04/09/2026): a tela dela exibia Lucro R$ 8,90 com a base
  // "sobre R$ 44,22 em 2 pedidos" e, LOGO ABAIXO, Margem em travessao exibindo
  // a MESMA base. A pagina afirmava e negava o resultado no mesmo bloco.
  //
  // 📌 A regra: margem so pode faltar quando o LUCRO tambem falta, ou quando a
  // cobertura e minoritaria — e nesse caso o lucro tambem some. Nunca um sem o
  // outro por condicao PROPRIA da margem, que foi o que aconteceu.
  const BASE = {
    finance: { currency: "BRL", revenue: 0, fees: null, refunds: 0, promotions: 0, buyerShipping: 0, orderCount: 0, feeBreakdown: [] },
    faturamentoTotal: 44.22, baseDoLucro: 44.22, feesDoLucro: 11.30, pedidosComTarifaEstimada: 2,
    cogs: 13.64, estimatedProfit: 8.90, unitsWithoutCost: 0, taxRate: 0, ads: null,
  };
  // Varre a fronteira dos dois lados: cobertura total, maioria, fronteira exata
  // e minoria. Dado que nao exercita a regra nao testa a regra (AGENTS.md).
  const CENARIOS = [
    { nome: "cobertura total", pedidosDoPeriodo: 2, pedidosCompletos: 2, pedidosSemValor: 2 },
    { nome: "maioria coberta", pedidosDoPeriodo: 10, pedidosCompletos: 6, pedidosSemValor: 3 },
    { nome: "fronteira exata", pedidosDoPeriodo: 10, pedidosCompletos: 5, pedidosSemValor: 0 },
  ];
  for (const c of CENARIOS) {
    await t.test(`🔴 ${c.nome}: lucro e margem aparecem JUNTOS`, () => {
      const cards = amazonFinancialCards({ ...BASE, ...c });
      const lucro = carta(cards, "profit");
      const margem = carta(cards, "marginPct");
      assert.equal(
        lucro.raw != null, margem.raw != null,
        `${c.nome}: lucro=${lucro.value} margem=${margem.value} — a mesma pagina nao pode afirmar e negar o resultado`,
      );
    });
  }

  // ⚠️ A UNICA EXCECAO AO PAR, E ELA E DECISAO DELA, DE 01/09/2026: quando a
  // cobertura e MINORITARIA, o lucro FICA na tela e o que sai e a AFIRMACAO da
  // margem — "o numero continua nos dois casos; o que sai e a afirmacao, nao a
  // informacao". Ha guarda propria para isso (`margemNaoAfirmaSobreMinoria`).
  //
  // 📌 Registrado aqui porque a invariante "lucro non-null exige margem
  // non-null" foi pedida como universal, e NAO e — forca-la reverteria uma
  // decisao dela por dentro de um teste. O que a excecao exige em troca e que a
  // margem DIGA o motivo, senao vira o travessao mudo que originou tudo isto.
  await t.test("na minoria, o lucro fica e a margem DIZ por que nao afirma", () => {
    const cards = amazonFinancialCards({ ...BASE, pedidosDoPeriodo: 10, pedidosCompletos: 4, pedidosSemValor: 0 });
    assert.notEqual(carta(cards, "profit").raw, null, "o resultado nao some — so a afirmacao do percentual");
    const margem = carta(cards, "marginPct");
    assert.equal(margem.value, "—");
    assert.match(margem.context, /6 de 10 pedidos do período sem custo cadastrado/,
      "travessao sem motivo e o defeito que originou esta frente");
  });
});
