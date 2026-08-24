import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// A legenda do gráfico é a MESMA nos canais.
//
// Ela nasceu dentro da página da Amazon e o Mercado Livre ficou sem: a tela do
// ML mostrava só "R$ 2.247,76 no período", sem dizer quantos pedidos foram
// confirmados, quantos aguardam pagamento e quantos foram cancelados. Cobrado
// por ela em 24/08/2026, comparando as duas telas lado a lado.

const fonte = (caminho) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");

// OS QUATRO. Equalizar dois e esquecer dois é o mesmo defeito mudado de lugar —
// foi o que ela cobrou em 24/08/2026: "você tá pecando na regra de deixar os
// marketplaces atualizados".
const TELAS = [
  ["src/app/amazon/page.tsx", "Amazon"],
  ["src/app/components/MercadoLivreWorkspace.tsx", "Mercado Livre"],
  ["src/app/components/ShopeeWorkspace.tsx", "Shopee"],
  ["src/app/components/TikTokWorkspace.tsx", "TikTok Shop"],
];

test("os dois canais usam o mesmo componente de legenda", () => {
  for (const [caminho, canal] of TELAS) {
    const s = fonte(caminho);
    assert.match(s, /<LegendaDeVendas/, `${canal} não usa a legenda compartilhada`);
    assert.doesNotMatch(
      s,
      /className="sales-split"/,
      `${canal} voltou a montar a legenda por conta — o markup mora no componente`
    );
  }
});

test("cada canal explica a PROPRIA regra de quando o dinheiro entra", () => {
  const notas = TELAS.map(([caminho, canal]) => {
    const nota = (fonte(caminho).match(/nota="([^"]+)"/) ?? [])[1];
    assert.ok(nota, `${canal} não explica a regra do próprio marketplace`);
    return nota;
  });
  // Nota genérica seria pior que nota nenhuma: cada marketplace tem regra
  // própria, e uma frase que serve para todos não ensina nada sobre nenhum.
  assert.equal(new Set(notas).size, notas.length, "dois canais estão repetindo a mesma explicação");
});

test("cancelado entra por quantidade, nunca por valor", () => {
  const componente = fonte("src/app/components/LegendaDeVendas.tsx");
  assert.match(componente, /cancelados\?:\s*\{\s*pedidos:\s*number\s*\}/);
  for (const [caminho, canal] of TELAS) {
    const s = fonte(caminho);
    const chamada = s.slice(s.indexOf("<LegendaDeVendas"), s.indexOf("<LegendaDeVendas") + 700);
    assert.doesNotMatch(
      chamada,
      /cancelados=\{\{[^}]*valor/,
      `${canal} passou valor de cancelado — na Amazon isso é estimativa nossa`
    );
  }
});

test("a legenda aparece quando ha pedido, mesmo sem pendente", () => {
  const componente = fonte("src/app/components/LegendaDeVendas.tsx");
  // A condição de sumir tem que exigir os TRÊS zerados. Quando dependia só de
  // "aguardando > 0", o filtro Hoje — com o único pedido já confirmado — fazia
  // a linha inteira desaparecer (23/08/2026).
  assert.match(
    componente,
    /confirmados\.pedidos <= 0 && pedidosAguardando <= 0 && pedidosCancelados <= 0/
  );
});

test("o monitor tem as mesmas tres abas nos dois canais", () => {
  const amazon = fonte("src/app/monitor/page.tsx");
  const ml = fonte("src/app/components/MercadoLivreWorkspace.tsx");
  // "Transações" faltava no ML: o extrato do Mercado Pago existia só no card do
  // dashboard, e quem abria o monitor não achava onde ver quando o dinheiro cai.
  for (const aba of ["Composição", "Transações", "Rentabilidade por venda"]) {
    assert.ok(amazon.includes(aba), `Amazon perdeu a aba "${aba}"`);
    assert.ok(ml.includes(aba), `Mercado Livre perdeu a aba "${aba}"`);
  }
});
