import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// A regra que este teste trava nasceu de uma medicao em producao (28/08/2026,
// registrada no ADR-017): o `AnimatedNumber` animava do valor do periodo
// ANTERIOR ate o novo, e no caminho com cache — sem esqueleto para esconder —
// a tela exibia o total de "hoje" sob o rotulo "7 dias" por ~550ms.
//
// O conserto tem duas metades, e as duas precisam continuar valendo:
//   1. o componente so anima com prova de que o recorte e o mesmo;
//   2. as telas que trocam de periodo declaram qual e o recorte.
//
// A metade 2 depende de disciplina de quem escreve tela nova, e disciplina e
// exatamente o que falhou na Amazon: ela foi a unica das quatro que nao passou
// a prop, e foi a unica que continuou mentindo. Por isso ela virou teste.

const TELAS_COM_PERIODO = [
  "src/app/amazon/page.tsx",
  "src/app/components/MercadoLivreWorkspace.tsx",
  "src/app/components/ShopeeWorkspace.tsx",
  "src/app/page.tsx",
];

async function ler(caminho) {
  return readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
}

test("AnimatedNumber so anima com o periodo declarado e inalterado", async () => {
  const fonte = await ler("src/app/components/AnimatedNumber.tsx");
  // Sem `periodo` declarado nao ha como saber se o valor novo e do mesmo
  // recorte — e na duvida nao se anima.
  assert.match(fonte, /periodo !== undefined && periodoRef\.current === periodo/);
  // O caminho que pinta direto tem de incluir o caso "recorte diferente".
  assert.match(fonte, /if \(reduceMotion \|\| !mesmoPeriodo \|\| from === value\)/);
  // A memoria entre montagens tambem exige o mesmo periodo.
  assert.match(fonte, /periodo !== undefined && lembrado\?\.periodo === periodo/);
});

test("toda tela que usa AnimatedNumber declara o periodo do numero", async () => {
  for (const caminho of TELAS_COM_PERIODO) {
    const fonte = await ler(caminho);
    const usos = fonte.match(/<AnimatedNumber\b[^>]*/g) ?? [];
    assert.ok(usos.length > 0, `${caminho} deveria usar AnimatedNumber`);
    for (const uso of usos) {
      assert.match(
        uso,
        /periodo=\{/,
        `${caminho}: <AnimatedNumber> sem a prop \`periodo\`. Sem ela o numero nao anima ` +
          `(o default e seguro), mas a tela perde a animacao em silencio — declare o recorte.`
      );
    }
  }
});

test("a identidade do periodo e string derivada, nunca objeto novo por render", async () => {
  // Objeto novo a cada render faria o componente achar que o periodo mudou
  // SEMPRE, e a animacao sumiria de vez — o oposto do defeito, igualmente errado.
  for (const caminho of TELAS_COM_PERIODO) {
    const fonte = await ler(caminho);
    for (const uso of fonte.match(/<AnimatedNumber\b[^>]*/g) ?? []) {
      const valor = /periodo=\{([^}]*(?:\}[^}]*)?)\}/.exec(uso)?.[1] ?? "";
      assert.doesNotMatch(
        valor,
        /^\s*\{|^\s*\[/,
        `${caminho}: a identidade do periodo precisa ser string comparavel por valor, nao objeto/array.`
      );
    }
  }
});
