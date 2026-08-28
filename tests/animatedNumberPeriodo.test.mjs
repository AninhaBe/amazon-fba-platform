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
  "src/app/components/TikTokWorkspace.tsx",
  "src/app/page.tsx",
];

async function ler(caminho) {
  return readFile(new URL(`../${caminho}`, import.meta.url), "utf8");
}

test("a contagem nunca parte do valor de OUTRO periodo", async () => {
  const fonte = await ler("src/app/components/AnimatedNumber.tsx");
  // Esta e a linha inteira do conserto: `from` so pode ser o numero anterior
  // quando o recorte e o mesmo. Trocou de recorte, parte do ZERO — zero nao e
  // total de periodo nenhum, entao nenhum quadro afirma valor alheio.
  assert.match(fonte, /const from = trocou \? 0 : displayedRef\.current;/);
  assert.match(fonte, /periodo !== undefined && periodoRef\.current === periodo/);
  // Sem `periodo` declarado nao da para saber de que recorte o valor e: pinta
  // direto. Esse e o default seguro, e ele nao pode sumir.
  assert.match(fonte, /if \(reduceMotion \|\| \(!mesmoPeriodo && !trocou\) \|\| from === value\)/);
  // A memoria entre montagens (caminho com esqueleto) segue a mesma regra.
  assert.match(fonte, /periodo !== undefined && lembrado\?\.periodo === periodo/);
  assert.match(fonte, /const seed = trocaDeRecorte \? 0 :/);
});

test("o primeiro quadro da troca e zero, nao o valor que estava na tela", async () => {
  const fonte = await ler("src/app/components/AnimatedNumber.tsx");
  // O ajuste no render acontece ANTES da pintura. Se alguem trocar este `0`
  // pelo valor anterior, volta o defeito de 28/08/2026 (numero de "hoje" sob o
  // rotulo "7 dias"); se trocar pelo valor NOVO, some a contagem que a dona do
  // produto pediu de volta. As duas regressoes caem aqui.
  const bloco = fonte.slice(fonte.indexOf("if (periodo !== periodoAnterior)"), fonte.indexOf("useEffect("));
  assert.match(bloco, /setDisplayed\(0\);/);
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
      // E precisa ser ESTAVEL dentro do mesmo recorte. O `to` que as rotas de
      // overview devolvem e "agora", com milissegundos: interpolado cru, a
      // resposta do cache e a da revalidacao viram periodos diferentes e a
      // contagem reinicia do zero no meio. Use `identidadeDePeriodo`.
      assert.doesNotMatch(
        valor,
        /\$\{[^}]*\.to\}/,
        `${caminho}: nao interpole o \`to\` cru na identidade do periodo — ele muda a cada resposta.`
      );
    }
  }
});

test("o ajuste no render compara por valor e nao pode virar loop", async () => {
  const fonte = await ler("src/app/components/AnimatedNumber.tsx");
  // Padrao documentado do React: ajustar estado durante o render quando a prop
  // muda. So e seguro com comparacao ESTRITA de valor — `periodo` e string
  // derivada. Objeto/array cria referencia nova a cada render, a guarda nunca
  // fecha e o componente re-renderiza para sempre.
  assert.match(fonte, /if \(periodo !== periodoAnterior\) \{/);
  assert.match(fonte, /setPeriodoAnterior\(periodo\);/);
  // O tipo e o que impede objeto de entrar em primeiro lugar.
  assert.match(fonte, /periodo\?: string;/);
  // E refs continuam fora do render (`react-hooks/refs`).
  const bloco = fonte.slice(fonte.indexOf("if (periodo !== periodoAnterior)"), fonte.indexOf("useEffect("));
  assert.doesNotMatch(bloco, /Ref\.current\s*=/, "refs nao podem ser tocados durante o render");
});

test("uma duracao e uma curva so, para os dois casos de contagem", async () => {
  const fonte = await ler("src/app/components/AnimatedNumber.tsx");
  // Mesmo periodo e troca de periodo usam a MESMA animacao. Uma segunda curva
  // aqui faria a troca parecer outro efeito, e nao e isso que foi pedido.
  assert.match(fonte, /requestAnimationFrame\(step\)/);
  assert.equal(fonte.match(/DURATION_MS = 550/g)?.length, 1);
  assert.equal(fonte.match(/const startedAt = performance\.now\(\)/g)?.length, 1);
  assert.match(fonte, /easeOutCubic/);
  // prefers-reduced-motion continua saindo antes de qualquer quadro animado.
  assert.match(fonte, /matchMedia\("\(prefers-reduced-motion: reduce\)"\)/);
  // A entrada (fade + subida) NAO pode voltar a remontar o span a cada troca:
  // o fade de 180ms esconderia o comeco da contagem de 550ms.
  // Olha o JSX, nao o comentario: o proprio comentario explica por que a chave
  // saiu, entao procurar o texto no arquivo inteiro sempre acharia.
  const jsx = /return <span[^>]*>/.exec(fonte)?.[0] ?? "";
  assert.match(jsx, /className="numero-animado"/);
  assert.doesNotMatch(jsx, /key=/);
});
