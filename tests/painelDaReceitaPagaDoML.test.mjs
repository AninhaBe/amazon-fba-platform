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

test("a tela do ML nao remonta a conta do painel por conta propria", async () => {
  // ⚠️ INTENCAO REDUZIDA (07/09/2026). Esta guarda exigia que o
  // dashboard do ML LESSE a composicao da receita paga. O painel que a
  // exibia saiu com o corpo antigo, no corte do canvas do Caminho do
  // Dinheiro: nao ha mais leitor no ML, e exigir a leitura seria pedir de
  // volta o bloco que a Ana mandou cortar.
  //
  // ⚠️ O QUE ELA SEMPRE PROTEGEU DE VERDADE CONTINUA, e e a metade
  // que pode voltar sozinha: se alguem reintroduzir um resultado no ML, ele
  // NAO pode ser remontado com uma conta local — a conta
  // `revenueProcessed - knownCosts` traz o imposto do faturamento de volta
  // pela porta dos fundos, misturando universos de novo. E o defeito que
  // produziu margem de 5673% no painel da Amazon.
  const tela = await ler("../src/app/components/MercadoLivreWorkspace.tsx");
  // ⚠️ Sem composicao o painel mostra AUSENCIA, nunca um numero remontado: a
  // conta local `revenueProcessed - knownCosts` traria o imposto do faturamento
  // de volta pela porta dos fundos.
  const codigo = tela.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(codigo, /resultadoDoPainel\s*=\s*[^;]*knownCosts/,
    "fallback que remonta a conta mistura universos de novo");
});

/*
 * ⚠️ AQUI MORAVA "o resultado do painel tem NOME PROPRIO — nao se chama
 * Lucro", de 02/09/2026. Ela existia porque o painel da receita paga e o card
 * de lucro do periodo sao numeros de UNIVERSOS diferentes, e exibir o nome de
 * um sobre o centro do outro produziu margem de 5673% no painel da Amazon
 * (ADR-028: nomes distintos para universos distintos).
 *
 * Ela saiu em 07/09/2026 porque o painel saiu do dashboard do ML — nao ha mais
 * rotulo para carregar o nome. A REGRA nao saiu: ela segue cobrada na Amazon,
 * e a metade que sobrevive no ML (nao remontar a conta localmente) esta na
 * guarda acima.
 */
