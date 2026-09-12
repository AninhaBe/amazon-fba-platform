import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");

/**
 * OS DOIS DEFEITOS QUE ESTE ARQUIVO REPROVA — fotografados pela dona do produto
 * em 11/09/2026, validando o v3 em producao com a conta dela:
 *
 *   1. *"nome do produto aparece em cima de pedido e data"* — titulos longos do
 *      Mercado Livre atravessavam a linha inteira e pintavam POR CIMA das
 *      colunas de SKU, numero do pedido e data. A linha ficava ilegivel.
 *   2. *"ainda aparece branco no fundo junto com cinza, precisa padronizar
 *      tudo"* — o cinza da identidade pintava um wrapper INTERNO (1160x1279)
 *      dentro de uma area de conteudo de 1200x1375, entao sobrava branco nas
 *      laterais, embaixo e na barra de periodo.
 */

/** Le as declaracoes de UMA regra do CSS, como mapa propriedade -> valor. */
function declaracoes(css, seletor) {
  const semComentario = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const i = semComentario.indexOf(seletor + " {");
  if (i < 0) return null;
  const corpo = semComentario.slice(semComentario.indexOf("{", i) + 1, semComentario.indexOf("}", i));
  const mapa = {};
  for (const par of corpo.split(";")) {
    const [k, ...resto] = par.split(":");
    if (resto.length) mapa[k.trim()] = resto.join(":").trim();
  }
  return mapa;
}

test("o titulo do produto CORTA no espaco dele — e a elipse so existe se ele for bloco", async () => {
  const css = await fonte("src/app/globals.css");
  const d = declaracoes(css, ".v3-margem-titulo");
  assert.ok(d, "a regra do titulo sumiu do CSS");

  // ⚠️ A ARMADILHA QUE CAUSOU O DEFEITO: as tres propriedades
  // de corte ja estavam la e nao cortavam nada, porque o seletor veste um
  // `<span>` e CAIXA INLINE IGNORA `overflow`. Uma guarda que conferisse so
  // `overflow/text-overflow/white-space` teria ficado VERDE com a tela quebrada
  // — foi exatamente esse o estado que subiu para producao.
  assert.ok(d.display && d.display !== "inline",
    "o titulo voltou a ser caixa inline: `overflow` e `text-overflow` nao tem efeito e o texto pinta por cima das colunas vizinhas");
  assert.equal(d.overflow, "hidden", "o titulo perdeu o corte");
  assert.equal(d["text-overflow"], "ellipsis", "o titulo perdeu a elipse");
  assert.equal(d["white-space"], "nowrap", "o titulo voltou a quebrar linha");

  // E o nome completo continua alcancavel sem abrir a linha.
  for (const arquivo of [
    "src/app/components/OrderProfitabilityTableV3.tsx",
    "src/app/components/PainelV3Baixo.tsx",
  ]) {
    const tsx = await fonte(arquivo);
    assert.match(tsx, /<span className="v3-margem-titulo" title=\{/,
      `${arquivo}: o titulo truncado ficou sem o nome completo no hover`);
  }
});

test("o fundo do Mercado Livre e UM SO — e pintado na area de conteudo, nao num filho", async () => {
  const css = await fonte("src/app/globals.css");
  const d = declaracoes(css, '.app-shell[data-channel="mercado_livre"] .operations-canvas');
  assert.ok(d, "o fundo do canal saiu do CSS — a tela volta a misturar branco e cinza");
  assert.ok(d.background, "a regra existe mas nao pinta fundo nenhum");

  // ⚠️ O ESCOPO E A METADE QUE NAO PODE CAIR. Sem o
  // `[data-channel="mercado_livre"]` esta regra pinta Amazon, Shopee e TikTok
  // junto — que e exatamente o vazamento que a leva inteira existiu para
  // desfazer. A guarda casa o seletor COMPLETO por isso.
  const codigo = css.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/^\s*\.operations-canvas\s*\{[^}]*background/m.test(codigo),
    "apareceu um fundo em `.operations-canvas` sem escopo de canal: a identidade do ML vazou para os outros tres");
});
