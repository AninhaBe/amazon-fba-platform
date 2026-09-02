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

test("a ROSQUINHA consome a composicao do conciliado", async () => {
  const pagina = await fonte("src/app/(app)/amazon/page.tsx");
  assert.ok(pagina.includes("value: conciliadoDoPainel.tarifa"), "a fatia de taxas");
  assert.ok(pagina.includes("value: conciliadoDoPainel.custo"), "a fatia de custo");
  assert.ok(pagina.includes("result: conciliadoDoPainel ? conciliadoDoPainel.lucro : lucroComAnuncio,"),
    "e o resultado é o resíduo, não o lucro do período");
});

test("a LISTA DE FLUXO consome a MESMA composicao — dois consumidores, duas guardas", async () => {
  // ⚠️ Esta é a guarda que faltou na Shopee. Lá a rosquinha ficou certa e a lista
  // continuou lendo os cards; a vendedora reprovou o painel "consertado".
  const pagina = await fonte("src/app/(app)/amazon/page.tsx");
  assert.ok(pagina.includes("money(conciliadoDoPainel?.tarifa ?? profit?.finance.fees ?? 0, currency)"),
    "a linha de Taxas da lista");
  assert.ok(pagina.includes("money(conciliadoDoPainel?.custo ?? profit?.cogs ?? 0, currency)"),
    "a linha de Custo da lista");
  assert.ok(pagina.includes('label={conciliadoDoPainel ? "Resultado dos repasses"'),
    "o resultado da lista sai da composição e muda de NOME");
  assert.ok(pagina.includes("conciliadoDoPainel?.margemPct ??"),
    "e a margem da lista sai sobre o centro do painel");
});

test("o ANUNCIO fica FORA deste painel, e o resultado muda de nome por isso", async () => {
  // ⚠️ MUDANÇA EM RELAÇÃO À ADR-025, e o motivo é o MESMO que a motivou.
  //
  // A ADR-025 mandou pôr o anúncio na composição porque a tela exibia dois
  // números chamados "lucro" com sinais opostos. Mas anúncio é custo DE PERÍODO
  // e não tem atribuição por pedido: somá-lo ao painel do conciliado quebraria a
  // igualdade centro = fatias que acabamos de restaurar.
  //
  // A saída não é esconder a diferença — é NOMEAR: este painel mostra
  // "Resultado dos repasses" (sem anúncio, universo conciliado) e o card mostra
  // "Lucro" (com anúncio, universo do período). Dois nomes diferentes para dois
  // números que são legitimamente diferentes é exatamente o que a ADR-025 queria.
  const pagina = await fonte("src/app/(app)/amazon/page.tsx");
  assert.ok(pagina.includes("conciliadoDoPainel == null && (anuncioNoLucro != null || anuncio.desconhecido)"),
    "a linha de Anúncios só aparece no caminho antigo, sem a composição");
  assert.ok(pagina.includes('"Resultado dos repasses"'),
    "o nome tem de mudar — dois números iguais de nome e diferentes de valor foi o defeito da ADR-025");
});

test("o caminho antigo continua existindo para quem nao tem a composicao", async () => {
  // Períodos sem linha detalhada, telas de teste e o estado de carregamento
  // caem no comportamento anterior em vez de exibir vazio. Consertar não é
  // remover.
  const pagina = await fonte("src/app/(app)/amazon/page.tsx");
  assert.ok(pagina.includes("conciliadoDoPainel?.receita ?? profit?.finance.revenue ?? 0"),
    "o centro cai no valor antigo quando não há composição");
});
