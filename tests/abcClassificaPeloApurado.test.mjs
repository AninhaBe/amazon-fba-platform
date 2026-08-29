import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Frente da ABC (29/08/2026): linha sem tarifa postada entrava com tarifa ZERO
// na contribuição, então o lucro saía inflado E a classe A/B/C — que é calculada
// a partir dele — ficava contaminada: produto podia ser "A" por lhe FALTAREM
// tarifas. Medido em 12 meses: 50 de 71 produtos e 74% da receita; 18 produtos
// sem NENHUMA tarifa apareciam com margem cheia.
//
// Os dois canais são gêmeos: o que valer para um vale para o outro.
const GEMEOS = [
  ["../src/lib/integrations/amazonAbc.ts", "Amazon"],
  ["../src/lib/integrations/mercadoLivreAbc.ts", "Mercado Livre"],
];

async function fonte(caminho) {
  return readFile(new URL(caminho, import.meta.url), "utf8");
}

test("a contribuição sai do APURADO, e é null quando nenhum pedido tem repasse", async () => {
  for (const [caminho, canal] of GEMEOS) {
    const src = await fonte(caminho);
    assert.match(src, /const semApurado = acc\.revenueApurada <= 0/, `${canal}: sem a guarda de apurado`);
    assert.match(src, /costMissing \|\| semApurado[\s\S]{0,40}\? null/, `${canal}: contribuição precisa ser null sem apurado`);
    // A receita da contribuição é a apurada, nunca a total.
    assert.match(src, /acc\.revenueApurada - acc\.custoApurado - acc\.fees/, `${canal}: contribuição sobre a receita errada`);
  }
});

test("a margem divide pela receita APURADA — dividir pela total inverteria o erro", async () => {
  for (const [caminho, canal] of GEMEOS) {
    const src = await fonte(caminho);
    assert.match(src, /contribution \/ acc\.revenueApurada \* 100/, `${canal}: margem sobre a receita total`);
    assert.doesNotMatch(src, /contribution \/ acc\.revenue \* 100/, `${canal}: margem voltou para a receita total`);
  }
});

test("a receita TOTAL continua sendo reportada — ela é fato e não muda", async () => {
  for (const [caminho, canal] of GEMEOS) {
    const src = await fonte(caminho);
    assert.match(src, /revenue: \+acc\.revenue\.toFixed\(2\)/, `${canal}: a receita total sumiu`);
    assert.match(src, /revenueApurada: \+acc\.revenueApurada\.toFixed\(2\)/, `${canal}`);
  }
});

test("os dois campos da frase existem — e valem também para quem TEM apurado", async () => {
  for (const [caminho, canal] of GEMEOS) {
    const src = await fonte(caminho);
    // São calculados por subtração, sem nenhuma condição de "só se zerado":
    // é o único jeito de a tela dizer que um número verde é PISO, não total.
    assert.match(src, /receitaSemRepasse: \+\(acc\.revenue - acc\.revenueApurada\)\.toFixed\(2\)/, `${canal}`);
    assert.match(src, /pedidosSemRepasse: acc\.pedidosSemRepasse/, `${canal}`);
    assert.doesNotMatch(src, /receitaSemRepasse: semApurado/, `${canal}: campo condicionado ao produto zerado`);
  }
});

test("CONDIÇÃO INEGOCIÁVEL: sair da classificação não pode virar sumir da tela", async () => {
  for (const [caminho, canal] of GEMEOS) {
    const src = await fonte(caminho);
    // `profitClass` é null para quem não tem contribuição — o mesmo que já
    // acontecia com custo faltando, então a tela não muda nesse ponto.
    assert.match(src, /p\.contribution == null \? null : \(profitClass\.get\(key\) \?\? "C"\)/, `${canal}`);
    // E NADA filtra o produto para fora da lista por causa disso.
    assert.doesNotMatch(src, /\.filter\(\([^)]*\) => [^)]*contribution != null\)\s*;/, `${canal}: produto sem contribuição sendo removido`);
    // `salesClass` (por receita) continua valendo para todos — é o eixo de giro.
    assert.match(src, /salesClass = classify\(partial\.map/, `${canal}`);
  }
});

test("o nome do campo é profitClass — 'class' quebraria a coluna, o filtro e o Pareto", async () => {
  for (const [caminho, canal] of GEMEOS) {
    const src = await fonte(caminho);
    for (const campo of ["profitClass", "salesClass", "quadrant"]) {
      assert.match(src, new RegExp(`${campo}`), `${canal}: ${campo} sumiu do contrato`);
    }
  }
});

test("o agregado sai da soma dos PRÓPRIOS produtos — nunca discorda da tabela", async () => {
  for (const [caminho, canal] of GEMEOS) {
    const src = await fonte(caminho);
    assert.match(src, /receita: \+products\.reduce\(\(s, p\) => s \+ p\.receitaSemRepasse, 0\)/, `${canal}`);
    assert.match(src, /produtosSemClasse: products\.filter\(\(p\) => p\.contribution == null\)\.length/, `${canal}`);
  }
});

test("Shopee e TikTok NÃO têm o defeito — não classificam por lucro", async () => {
  const shopee = await fonte("../src/lib/integrations/shopeeModules.ts");
  // A ABC da Shopee declara o lucro indisponível em vez de estimá-lo.
  assert.match(shopee, /profitAvailable: false/);
  assert.match(shopee, /profit: null/);
});
