import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classificarCobertura, ORDEM_DO_RADAR } from "../src/lib/coberturaDeEstoque.ts";

// O radar de estoque classifica IGUAL em todo canal.
//
// O Mercado Livre tinha uma cópia própria com três status, e nela tudo que não
// era esgotado nem crítico caía em "ok". Um anúncio com 1 unidade e ZERO venda
// no período era exibido como "Saudável" — ausência de velocidade virando
// atestado de saúde, que é o `null ≠ 0` do AGENTS.md ao contrário.
//
// Achado por ela em 24/08/2026, olhando o radar do ML: "tenho 1 em estoque e é
// saudável? caraca".

const fonte = (caminho) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");

test("estoque parado sem venda no periodo NAO e saudavel", () => {
  assert.equal(
    classificarCobertura({ disponivel: 1, porDia: 0, diasRestantes: null }),
    "idle",
    "sem velocidade não há previsão de ruptura — não dá para afirmar cobertura"
  );
  assert.equal(classificarCobertura({ disponivel: 5, porDia: 0, diasRestantes: null }), "idle");
});

test("sem estoque e sem reposicao e esgotado", () => {
  assert.equal(classificarCobertura({ disponivel: 0, porDia: 0, diasRestantes: null }), "out");
  assert.equal(classificarCobertura({ disponivel: 0, porDia: 2, diasRestantes: 0 }), "out");
  // Com reposição a caminho não é esgotado: existe chegada prevista.
  assert.equal(classificarCobertura({ disponivel: 0, aCaminho: 10, porDia: 1, diasRestantes: 0 }), "critical");
});

test("as faixas de urgencia", () => {
  assert.equal(classificarCobertura({ disponivel: 10, porDia: 1, diasRestantes: 10 }), "critical");
  assert.equal(classificarCobertura({ disponivel: 20, porDia: 1, diasRestantes: 20 }), "low");
  assert.equal(classificarCobertura({ disponivel: 50, porDia: 1, diasRestantes: 50 }), "ok");
  assert.equal(classificarCobertura({ disponivel: 200, porDia: 1, diasRestantes: 200 }), "overstock");
});

test("sem venda vai para o fim da fila de urgencia", () => {
  assert.ok(ORDEM_DO_RADAR.out < ORDEM_DO_RADAR.critical);
  assert.ok(ORDEM_DO_RADAR.critical < ORDEM_DO_RADAR.ok);
  assert.equal(
    Math.max(...Object.values(ORDEM_DO_RADAR)),
    ORDEM_DO_RADAR.idle,
    "quem não vendeu não é urgente — vai por último"
  );
});

test("nenhum canal reimplementa a regra por conta", () => {
  for (const caminho of [
    "src/lib/integrations/mercadoLivre.ts",
    "src/lib/integrations/mercadoLivreOverviewCanonical.ts",
  ]) {
    const s = fonte(caminho);
    assert.match(s, /classificarCobertura\(/, `${caminho} tem que usar a regra compartilhada`);
    assert.doesNotMatch(
      s,
      /daysRemaining != null && daysRemaining <= 10 \? "critical" : "ok"/,
      `${caminho} voltou a ter cópia local da classificação`
    );
  }
});

test("a tela do ML sabe nomear os seis status", () => {
  const tela = fonte("src/app/components/MercadoLivreWorkspace.tsx");
  for (const rotulo of ["Esgotado", "Repor já", "Repor em breve", "Saudável", "Excesso", "Sem venda"]) {
    assert.ok(tela.includes(rotulo), `falta o rótulo "${rotulo}"`);
  }
});

test("os dois radares mostram quantidade vendida, nao so ritmo", () => {
  // Ela comparou as duas telas em 24/08/2026: o radar do ML mostra "Vendidos" e
  // o da Amazon só "Vende/dia". Ritmo sem volume não dá para julgar — 0,2/dia
  // pode ser 6 unidades em 30 dias ou 1 em 5, e a decisão de repor muda.
  const amazon = fonte("src/app/estoque/page.tsx");
  const ml = fonte("src/app/components/MercadoLivreWorkspace.tsx");
  assert.match(amazon, />Vendidos</, "o radar da Amazon perdeu a coluna Vendidos");
  assert.match(ml, />Vendidos</, "o radar do ML perdeu a coluna Vendidos");
  assert.match(amazon, /Unidades vendidas/, "falta o total do período no resumo da Amazon");
  assert.match(ml, /Unidades vendidas/, "falta o total do período no resumo do ML");
});
