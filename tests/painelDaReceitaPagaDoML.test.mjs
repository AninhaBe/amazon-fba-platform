import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// ⚠️ O PAINEL DE COMPOSICAO DO ML FECHA NO UNIVERSO QUE DECLARA — [ADR-028].
//
// QUAL DEFEITO ISTO REPROVA, com o numero real: o painel mostra no centro a
// RECEITA PROCESSADA e exibia embaixo o "Lucro estimado" e a "Margem" do
// PERIODO INTEIRO, calculados sobre o faturamento. Centro de um universo,
// resultado de outro. E a quinta forma da mesma familia em dois dias:
//
//   - margem de 91,7% afirmada sobre 1 pedido ao lado de um faturamento de 31;
//   - widget da Shopee estourando o proprio todo em R$ 1.636,99;
//   - painel da Amazon com centro de R$ 12,89 e "Lucro estimado" de R$ 731,27 —
//     margem de 5673%.
//
// Nenhum numero estava errado sozinho. Falso era afirmar que pertenciam a mesma
// conta. Aqui o resultado e o RESIDUO do proprio bloco, a margem sai do proprio
// centro, e o nome diz de que universo ele fala.
//
// ⚠️ E O ML TEM DOIS CAMINHOS — canonico e legado (API ao vivo). O tipo do
// overview e INFERIDO do legado, entao expor a composicao so no canonico nem
// compilaria. Os dois expoem, e este teste cobre os dois: um painel que muda de
// comportamento conforme quem serviu a resposta e pior que um painel errado,
// porque so aparece as vezes.

const ler = (caminho) => readFile(new URL(caminho, import.meta.url), "utf8");

test("os DOIS produtores do ML expoem a composicao da receita paga", async () => {
  // Ancoras por arquivo: no canonico a composicao e uma const (4 espacos), no
  // legado ela vive dentro de `profit:` (8). Comparar string literal com a
  // indentacao de cada um e chato e verificavel — foi um recorte "esperto" que
  // deixou tres guardas verdes com o defeito de volta em 02/09 (AGENTS.md).
  for (const [caminho, recuo] of [
    ["../src/lib/integrations/mercadoLivreOverviewCanonical.ts", "    "],
    ["../src/lib/integrations/mercadoLivre.ts", "        "],
  ]) {
    const fonte = await ler(caminho);
    // Ancorado na DEFINICAO — de onde o valor nasce —, nao no uso: casar o nome
    // continuaria verde se alguem trocasse a FONTE uma linha acima, porque o
    // nome nao muda e a origem sim (AGENTS.md, 02/09/2026).
    assert.ok(fonte.includes(`${recuo}receita: processedRevenue,`),
      `${caminho}: o centro da composicao tem de ser a receita processada`);
    assert.ok(fonte.includes(`${recuo}lucro: +(processedRevenue - fees - sellerShipping - cogs - (`),
      `${caminho}: o resultado tem de ser o residuo do proprio bloco`);
  }
});

test("no canonico o imposto do painel incide sobre o centro do painel", async () => {
  const fonte = await ler("../src/lib/integrations/mercadoLivreOverviewCanonical.ts");
  // A armadilha exata que a Shopee e o ML ja tiveram: o imposto do periodo
  // incide sobre o faturamento. Usa-lo aqui faria a subtracao cobrir um universo
  // maior que a soma — e o bloco nao fecharia por centavos que ninguem acha.
  // ⚠️ O `null` VIROU `0` em 07/09/2026 (ADR-038) — a intencao anterior estava
  // certa no mundo anterior. O que este teste cobra continua sendo o mesmo e e
  // outra coisa: a BASE. O imposto do painel incide sobre `processedRevenue`, o
  // centro do proprio painel, e nao sobre o faturamento do periodo.
  assert.ok(fonte.includes(
    "  const impostoDaReceitaPaga = taxRate == null ? 0 : +(processedRevenue * taxRate / 100).toFixed(2);"),
    "o imposto do painel sai da receita processada, nao do faturamento");
  // E o lucro do PERIODO continua saindo do faturamento — os dois convivem.
  assert.ok(fonte.includes(
    "  const estimatedProfit = faturamentoDoLucro - fees - cogs - (taxes ?? 0) - sellerShipping;"),
    "o lucro do periodo nao pode ter sido movido junto");
});

test("a tela do ML le a composicao, e NAO o lucro do periodo", async () => {
  const tela = await ler("../src/app/components/MercadoLivreWorkspace.tsx");
  assert.ok(tela.includes("  const resultadoDoPainel = composicaoDoPainel ? composicaoDoPainel.lucro : null;"),
    "o resultado do painel tem de vir da composicao");
  assert.ok(tela.includes("  const margemDoPainel = composicaoDoPainel ? composicaoDoPainel.margemPct : null;"),
    "a margem do painel tem de vir da composicao");
  // ⚠️ Sem composicao o painel mostra AUSENCIA, nunca um numero remontado: a
  // conta local `revenueProcessed - knownCosts` traria o imposto do faturamento
  // de volta pela porta dos fundos.
  const codigo = tela.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(codigo, /resultadoDoPainel\s*=\s*[^;]*knownCosts/,
    "fallback que remonta a conta mistura universos de novo");
});

test("o resultado do painel tem NOME PROPRIO — nao se chama Lucro", async () => {
  const tela = await ler("../src/app/components/MercadoLivreWorkspace.tsx");
  // Dois numeros legitimos e diferentes; o nome e o que impede a confusao. A
  // asserção e sobre a linha inteira do bloco, nao sobre a frase solta: um
  // rotulo igual num comentario nao pode fazer esta guarda passar.
  assert.ok(tela.includes('comSemImposto("Resultado da receita paga", semAliquota)'),
    "o resultado do painel precisa dizer de que universo fala");
});
