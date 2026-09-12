import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// ⚠️ O DEFEITO QUE ESTES TESTES REPROVAM, no print da vendedora de 02/09/2026 —
// o painel "Repasses, taxas e lucro" da Amazon:
//
//   centro: "R$ 12,89 Faturamento conciliado"
//   fatias: Custo 446,50 + Logística 45,01 + Comissão 13,98 + Lucro 731,27
//   lista:  Faturamento 12,89 − Taxas 58,99 − Custo 446,50 = "Lucro" 731,27
//   Margem: 5673%
//
// A subtração literal dá NEGATIVA (12,89 − 58,99 − 446,50 = −492,60) e o 731,27
// não é resíduo de nada visível ali: é o lucro DO PERÍODO, cuja conta fecha em
// OUTRO card (1.665,54 − 487,77 − 446,50). Centro de um universo, fatias e
// resultado de outro.
//
// 📌 É a MESMA anatomia do painel da Shopee (f88dbb9 + c37a8bd), e a distância
// aqui é maior — 12,89 contra 1.665,54 —, que é o que faz a margem explodir.
// A família apareceu em DOIS canais; estas guardas existem para que o terceiro
// não repita.
//
// 📌 E A LIÇÃO DA SHOPEE ESTÁ APLICADA: o painel tem DOIS consumidores dos
// mesmos números — a rosquinha e a lista de fluxo. Lá eu corrigi um, dei por
// pronto, e a vendedora reprovou. Aqui as duas são cobradas.

const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
const semComentario = (texto) =>
  texto
    .split("\n")
    .map((l) => l.replace(/\r$/, "").replace(/\s*\/\/.*$/, ""))
    .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("/*") && !l.trim().startsWith("{/*"))
    .join("\n");

test("o produtor soma a composicao a partir das MESMAS linhas do centro", async () => {
  // Coerência por construção: quem entra no centro entra nos três termos, e
  // quem fica de fora fica de fora dos três. É isso que faz a subtração fechar
  // sem precisar de uma consulta separada que possa divergir.
  const canonico = semComentario(await fonte("src/lib/integrations/amazonOverviewCanonical.ts"));
  assert.ok(canonico.includes("if (lineRevenue != null) {"),
    "só a linha com receita conhecida entra na composição");
  for (const termo of ["conciliado.receita += lineRevenue;",
                       "conciliado.custo += lineProductCost ?? 0;",
                       "conciliado.tarifa += lineFees ?? 0;"]) {
    assert.ok(canonico.includes(termo), `o termo tem de ser somado no mesmo ramo: ${termo}`);
  }
  // E o resultado é o RESÍDUO, nunca o lucro do período.
  assert.ok(canonico.includes("lucro: +(conciliado.receita - conciliado.custo - conciliado.tarifa).toFixed(2),"),
    "o resultado do painel é o resíduo do universo dele");
  assert.ok(canonico.includes("margemPct: conciliado.receita > 0"),
    "e a margem sai sobre o próprio centro — dividir pelo outro universo deu 5673%");
});

/**
 * O PAINEL SAIU DA TELA DA AMAZON EM 12/09/2026 — e este arquivo mudou de
 * intencao junto, sem perder nada do que sabia.
 *
 * A ordem dela foi *"cara, e replicar a mesma estrutura do mercado livre na
 * amazon"*: o PainelV3 substituiu o corpo antigo do dashboard, e a rosquinha
 * "Repasses, taxas e lucro" e a cascata escrita sairam juntas. Com elas, saiu o
 * unico bloco da tela que podia misturar universos — porque agora ha UM bloco de
 * numeros, a faixa do periodo, com a propria base (`baseDoLucro`).
 *
 * O QUE CONTINUA COBRADO, e nao e pouco:
 *   1. o PRODUTOR continua somando a composicao no mesmo ramo (teste acima) — ele
 *      nao foi tocado, e e de onde o defeito de 02/09 nasceria de novo;
 *   2. se o painel VOLTAR, volta com os DOIS consumidores na forma certa. Meio
 *      painel lendo a composicao e meio lendo `profit.finance` e exatamente a
 *      mistura que a ADR-028 proibe — e foi o erro que ela reprovou na Shopee.
 *
 * 📌 REGISTRADO PARA O BACKEND: `composicaoDoConciliado` segue sendo produzida e
 * enviada no payload, e hoje NENHUMA tela a le. Nao foi removida de proposito —
 * e ela que faz o painel voltar em uma linha.
 */
test("se o painel voltar, os DOIS consumidores voltam juntos e na forma certa", async () => {
  const pagina = await fonte("src/app/(app)/amazon/page.tsx");
  const codigo = semComentario(pagina);

  // Enquanto nao ha painel, nao ha o que conferir — e dizer isso em voz alta e
  // parte da guarda: laco vazio que parece verde foi o que o AGENTS chama de
  // teste decorativo.
  if (!codigo.includes("FinancialSummaryPanel")) {
    assert.ok(!codigo.includes("conciliadoDoPainel"),
      "a composicao voltou a ser lida sem o painel que a explica — de onde ela entra na tela?");
    return;
  }

  // A ROSQUINHA.
  assert.ok(codigo.includes("value: conciliadoDoPainel.tarifa"), "a fatia de taxas");
  assert.ok(codigo.includes("value: conciliadoDoPainel.custo"), "a fatia de custo");
  assert.ok(codigo.includes("result: conciliadoDoPainel ? conciliadoDoPainel.lucro : lucroComAnuncio,"),
    "e o resultado é o resíduo, não o lucro do período");

  // A LISTA DE FLUXO — a guarda que faltou na Shopee. La a rosquinha ficou certa
  // e a lista continuou lendo os cards; a vendedora reprovou o painel "consertado".
  assert.ok(codigo.includes("money(conciliadoDoPainel?.tarifa ?? profit?.finance.fees ?? 0, currency)"),
    "a linha de Taxas da lista");
  assert.ok(codigo.includes("money(conciliadoDoPainel?.custo ?? profit?.cogs ?? 0, currency)"),
    "a linha de Custo da lista");
  assert.ok(codigo.includes("conciliadoDoPainel?.margemPct ??"),
    "e a margem da lista sai sobre o centro do painel");

  // O NOME, que e a mudanca em relacao a ADR-025 e o motivo dela: este painel
  // mostra "Resultado dos repasses" (sem anuncio, universo conciliado) e o card
  // mostra "Lucro" (com anuncio, universo do periodo). Dois nomes diferentes para
  // dois numeros legitimamente diferentes.
  assert.ok(codigo.includes('label={conciliadoDoPainel ? "Resultado dos repasses"'),
    "o resultado da lista sai da composição e muda de NOME");
  assert.ok(codigo.includes("conciliadoDoPainel == null && (anuncioNoLucro != null || anuncio.desconhecido)"),
    "a linha de Anúncios só aparece no caminho antigo, sem a composição");

  // E o caminho antigo continua existindo para periodo sem linha detalhada:
  // consertar nao e remover.
  assert.ok(codigo.includes("conciliadoDoPainel?.receita ?? profit?.finance.revenue ?? 0"),
    "o centro cai no valor antigo quando não há composição");
});
