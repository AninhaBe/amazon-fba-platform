/**
 * O quadro em que o **NX vira a seta** — o morfismo propriamente dito.
 *
 * ⚠️ ISTO EXISTE PORQUE A PRIMEIRA ENTREGA ERA CORTE, NÃO EFEITO.
 * Verbatim dela, 09/09/2026: *"isso nao é efeito, sao takes, nexo, nx e depois
 * seta, eu disse que quero o nx se TRANSFORMANDO na seta"*. Trocar um elemento
 * por outro com fade é montagem; o que ela pediu é a forma virando a outra.
 *
 * ## Por que dá para fazer isso sem biblioteca de morph
 *
 * A seta do NEXO é um ponteiro: a ponta fica no canto superior esquerdo e dela
 * saem **duas arestas longas** — uma para a direita e outra para baixo. O **X**
 * também é feito de duas hastes. Então o morfismo não é uma metáfora: cada
 * haste do X viaja até coincidir com uma aresta da seta.
 *
 * O caminho de cada haste é `M a b L c d` — duas âncoras. Um `d` assim
 * interpola para outro `d` da mesma estrutura, e o navegador anima o traço
 * ponto a ponto. É por isso que o desenho aqui é feito de `path`, e não de
 * `line`: `line` não tem `d` para animar.
 *
 * O **N** não vira nada — ele desaba para dentro da ponta e sai. Forçar as três
 * hastes do N a virarem alguma coisa produziria movimento sem leitura: a seta
 * tem duas arestas, não cinco.
 *
 * ⚠️ A DEMÃO PRETA ENTRA POR BAIXO, no fim do trajeto. Enquanto as
 * hastes viajam, o que se vê é o traço; quando elas chegam, o corpo da seta já
 * está lá e os traços somem dentro dele. Sem isso o efeito terminaria num
 * contorno vazio e a seta cheia apareceria por corte — de volta ao problema.
 *
 * ⚠️ O `d` DO CORPO É CÓPIA DE `public/nexo-symbol.svg`. Se a marca
 * mudar de desenho, este arquivo precisa mudar junto, ou o morfismo termina
 * numa seta que não é a do produto. Não dá para importar o `.svg` e animar por
 * cima dele: o `<img>` é opaco para o CSS da página.
 */

const CORPO =
  "M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z";

export function MarcaMorfismo() {
  return (
    <svg className="nexo-marca-morf" viewBox="0 0 24 24" aria-hidden>
      {/* O N desaba para dentro da ponta e sai de cena. */}
      <path className="nexo-marca-morf-n" d="M6 17V7l7 10V7" />
      {/* O corpo da seta, que chega por baixo no fim do trajeto. */}
      <path className="nexo-marca-morf-corpo" d={CORPO} />
      {/* As duas hastes do X. Cada uma viaja para uma aresta da seta — o `d`
          de partida e o de chegada estão no CSS, porque quem os interpola é a
          animação, não o React. */}
      <path className="nexo-marca-morf-haste is-desce" />
      <path className="nexo-marca-morf-haste is-abre" />
    </svg>
  );
}
