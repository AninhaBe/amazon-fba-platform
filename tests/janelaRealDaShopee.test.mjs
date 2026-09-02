import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// ⚠️ A JANELA REAL DA INGESTAO PRECISA CHEGAR NA TELA — Shopee.
//
// QUAL DEFEITO ISTO REPROVA: um recorte de "30 dias" sobre um historico mais
// curto mostra menos venda **sem uma palavra de explicacao**, e o numero menor
// parece queda de faturamento. E a mesma familia de "tela sem dado mostra o
// estado real, nunca zeros que parecam nao vendeu nada" (AGENTS.md), aplicada ao
// meio-termo: nao e zero, e menos — e menos sem explicacao engana igual.
//
// 📌 A GARANTIA E REPLICADA DO ML; O MECANISMO E O NUMERO, NUNCA. A regra da
// dona do produto (02/09/2026) e que cada API tem seu proprio calendario. Por
// isso o que atravessa canais e o CAMPO (`historicoDesde`, que sai do
// `covered_from` DESTA conexao), e nao uma frase fixa: um texto dizendo "a
// janela real da Shopee e de ~7 dias" seria FALSO nesta conexao — medido em
// 02/09/2026, o historico vai de 28/06 (dez semanas), com item e tarifa em
// 99-100% das semanas. Aviso fixo que a medicao desmente e mentira, nao zelo.
//
// COMO VER VERMELHO: apague `historicoDesde` da montagem de `revenueCoverage`
// no produtor da Shopee.

const ler = (caminho) => readFile(new URL(caminho, import.meta.url), "utf8");

test("a cobertura da Shopee carrega a janela ingerida, nao so o 'completo'", async () => {
  const fonte = await ler("../src/lib/integrations/shopeeOverviewCanonical.ts");
  // Ancorado na montagem inteira, nao no identificador solto: casar o nome
  // `historicoDesde` continuaria verde se alguem trocasse a FONTE dele uma linha
  // acima — o nome nao muda, a origem sim (AGENTS.md, 02/09/2026).
  assert.ok(fonte.includes(
    `        sincronizadoAte: syncRow.covered_to ? new Date(syncRow.covered_to).toISOString() : null,
        historicoDesde: syncRow.covered_from ? new Date(syncRow.covered_from).toISOString() : null,`),
    "a janela real tem de sair do covered_from/covered_to DESTA conexao");
});

test("a peca que monta a frase ja existe e nao inventa numero", async () => {
  // A central so consegue avisar porque le os dois campos. Se a frase mudar de
  // lugar, que seja com este teste vermelho, e nao em silencio.
  const central = await ler("../src/app/centralChannels.ts");
  assert.ok(central.includes("Histórico importado a partir de"),
    "a frase que aponta a janela e a que a casa usa: aponta, nao se desculpa");
  // E ela e CONDICIONAL ao periodo pedido comecar antes do historico — avisar
  // sempre seria ruido, e aviso que aparece sempre deixa de ser lido.
  assert.ok(central.includes("new Date(coverage.historicoDesde) > inicioDoPeriodo"),
    "o aviso so aparece quando o periodo pedido comeca antes do historico");
});

test("nenhum canal afirma uma janela FIXA em dias", async () => {
  // A armadilha nomeada: "a janela real e de N dias" envelhece e vira mentira,
  // porque a ingestao avanca. O que a tela pode dizer e a DATA que ela mediu.
  for (const caminho of [
    "../src/lib/integrations/shopeeOverviewCanonical.ts",
    "../src/app/components/ShopeeWorkspace.tsx",
  ]) {
    const fonte = await ler(caminho);
    // ⚠️ Proibicao olha o fonte SEM COMENTARIOS, sempre: o comentario que explica
    // por que algo e proibido CITA a coisa proibida (AGENTS.md).
    const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(codigo, /janela real (e|é) de \d+ dias/i,
      `${caminho}: janela fixa em dias envelhece e vira mentira`);
  }
});
