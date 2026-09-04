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
