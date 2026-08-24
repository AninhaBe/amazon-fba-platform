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

const TELAS = [
  ["src/app/amazon/page.tsx", "Amazon"],
  ["src/app/components/MercadoLivreWorkspace.tsx", "Mercado Livre"],
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
  const amazon = fonte("src/app/amazon/page.tsx");
  const ml = fonte("src/app/components/MercadoLivreWorkspace.tsx");
  assert.match(amazon, /nota="A Amazon confirma o pagamento/);
  assert.match(ml, /nota="O Mercado Livre só confirma a venda/);
  // Nota genérica seria pior que nota nenhuma: cada marketplace tem regra
  // própria, e uma frase que serve para todos não ensina nada sobre nenhum.
  assert.notEqual(
    (amazon.match(/nota="([^"]+)"/) ?? [])[1],
    (ml.match(/nota="([^"]+)"/) ?? [])[1]
  );
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
