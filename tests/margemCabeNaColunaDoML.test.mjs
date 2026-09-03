import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const fonte = (caminho) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
const semComentarios = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

const MODULO = "src/app/components/OrderProfitabilityTable.module.css";
const GLOBAIS = "src/app/globals.css";

/**
 * ⚠️ O DEFEITO QUE ESTE ARQUIVO REPROVA (03/09/2026, dois prints da dona): na
 * Rentabilidade dos pedidos, a 100% de zoom a pílula de MARGEM saía CORTADA
 * pela direita. Verbatim: *"o usuario ta tendo que tirar 10% de zoom pra
 * enxergar sem cortar a margem"*.
 *
 * Medido numa fixture com o CSS de produção, largura da coluna do ML numa tela
 * de 1920 (790px): a borda direita da pílula caía 37px FORA da coluna. A 1366
 * de viewport (coluna de 519px), 308px fora. Em largura cheia (1620px) sempre
 * coube — por isso ninguém tinha visto: os outros três canais usam a tabela em
 * largura inteira.
 *
 * ⚠️ A CAUSA NÃO ERA FALTA DE RESPONSIVIDADE. As duas adaptações que resolvem
 * isso já existiam em `globals.css`; elas perguntavam a largura da JANELA, e a
 * janela estava larga — quem estava estreito era a COLUNA. A correção é trocar
 * a pergunta, e é isso que as asserções abaixo ancoram.
 */

test("a linha da tabela é um container — sem isso, nenhuma @container dispara", async () => {
  const css = semComentarios(await fonte(MODULO));
  const bloco = css.slice(css.indexOf(".sale {"), css.indexOf("}", css.indexOf(".sale {")));
  assert.ok(
    bloco.includes("container-type: inline-size"),
    "`.sale` precisa declarar `container-type: inline-size`: as @container abaixo " +
      "medem a largura DESTA linha, e sem o container elas nunca chegam a valer.",
  );
});

test("os limiares cobrem as larguras reais da coluna do ML (790px e 519px)", async () => {
  const css = semComentarios(await fonte(MODULO));
  const limiares = [...css.matchAll(/@container \(max-width: (\d+)px\)/g)].map((m) => Number(m[1]));

  assert.equal(limiares.length, 2, "são duas adaptações: equação em linha própria, e os três campos empilhados");

  const [largo, estreito] = limiares.sort((a, b) => b - a);
  assert.ok(
    largo >= 790,
    `o limiar mais largo é ${largo}px e precisa alcançar 790px — a coluna do ML numa tela de 1920. ` +
      "Abaixo disso o defeito volta exatamente onde ela o viu.",
  );
  assert.ok(
    estreito >= 519,
    `o limiar estreito é ${estreito}px e precisa alcançar 519px — a coluna do ML a 1366 de viewport.`,
  );
});

test("na coluna estreita a equação sai da terceira coluna e ganha a linha inteira", async () => {
  const css = semComentarios(await fonte(MODULO));
  const inicio = css.indexOf("@container (max-width: 920px)");
  assert.ok(inicio > 0, "o bloco de 920px é o que tira a equação da disputa por espaço");
  const bloco = css.slice(inicio, css.indexOf("\n}", inicio));

  assert.ok(
    bloco.includes("grid-column: 1 / 3;") && bloco.includes("grid-row: 2;"),
    "a equação precisa ir para a linha 2 ocupando duas colunas; só encolher a fonte " +
      "empurraria o defeito para o próximo número de quatro dígitos.",
  );
  assert.ok(
    bloco.includes("grid-template-columns: minmax(0, 1fr) minmax(150px, .7fr) 40px;"),
    "a primeira coluna precisa de piso ZERO (`minmax(0, …)`): é o piso fixo que " +
      "empurrava a equação para fora.",
  );
});

test("a adaptação é por LARGURA, não por canal — nenhum fork no CSS da tabela", async () => {
  const css = semComentarios(await fonte(MODULO));
  for (const canal of ["mercado-livre", "meli", "amazon", "shopee", "tiktok", "cockpit"]) {
    assert.ok(
      !css.includes(canal),
      `o CSS da tabela cita "${canal}". A tabela é compartilhada pelos quatro canais: ` +
        "quem decide o layout é o espaço que a linha recebeu, não quem a renderiza. " +
        "Um fork por canal dá o mesmo pixel e uma manutenção a mais para sempre.",
    );
  }
});

test("os outros três canais continuam com as regras de janela que sempre tiveram", async () => {
  const css = semComentarios(await fonte(GLOBAIS));
  for (const regra of [
    ".profit-sale-main { grid-template-columns: minmax(220px, 1fr) minmax(170px, .7fr) 40px; }",
    ".profit-equation { grid-column: 1 / 3; grid-row: 2; }",
    ".profit-equation { grid-column: 1 / -1; grid-row: 3; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; padding: 7px; }",
  ]) {
    assert.ok(
      css.includes(regra),
      `a regra de janela sumiu de globals.css:\n  ${regra}\n` +
        "As @container ACRESCENTAM um gatilho; elas não substituem o comportamento " +
        "de janela estreita que Amazon, Shopee e TikTok já tinham.",
    );
  }
});
