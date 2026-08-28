/**
 * Qual data cada número usa.
 *
 * Nasceu de uma pergunta da Ana em 27/08/2026: o monitor dizia "hoje R$ 194,25"
 * e o dashboard dizia "hoje R$ 56,90". Os dois estavam certos — um conta pela
 * data em que a VENDA foi feita, o outro pela data em que o marketplace LANÇOU
 * o dinheiro —, mas nenhuma das telas dizia qual era qual. "Não tá claro."
 *
 * ⚠️ POR QUE UMA LINHA DA SEÇÃO, E NÃO UM SUFIXO NO RÓTULO
 *
 * O contrato sugeria "Faturamento (por data do pedido)". Não cabe: `.metric-label-text`
 * é `white-space: nowrap` com reticências dentro de uma faixa que rola na
 * horizontal, então a parte cortada seria justamente a base — o único pedaço que
 * importa. E a faixa da Amazon não aceita texto embaixo do número por decisão
 * dela (24/08/2026: "todos esses textos que estão embaixo... pode colocar no i").
 * Uma linha por seção diz a mesma coisa uma vez só, não trunca, e é a MESMA
 * frase nos quatro canais — que é o que faz duas telas pararem de se contradizer.
 *
 * Regra do contrato que esta linha existe para cumprir: nunca colocar as duas
 * bases lado a lado sem rótulo.
 */

export type Base = "pedido" | "lancamento" | "pedido-extrato";

const TEXTO: Record<Base, { titulo: string; explica: string }> = {
  pedido: {
    titulo: "por data do pedido",
    // Sem jargão: não diz "occurred_at" nem "base pedido", diz o que acontece.
    explica: "entram no dia da venda, mesmo que o marketplace ainda não tenha lançado o dinheiro",
  },
  lancamento: {
    titulo: "por data do lançamento",
    explica: "entram no dia em que o dinheiro foi lançado, mesmo que a venda seja de outro dia",
  },
  // A pegadinha do TikTok: o extrato oficial troca a AUTORIDADE do valor, não a
  // data. Quem lê "extrato" espera data de repasse e recebe data de pedido.
  "pedido-extrato": {
    titulo: "por data do pedido",
    explica: "o extrato oficial confirma o valor, mas a data continua sendo a da venda",
  },
};

export function BaseDeData({ base, prefixo = "Valores" }: { base: Base; prefixo?: string }) {
  const { titulo, explica } = TEXTO[base];
  return (
    <p className="base-de-data" role="note">
      {prefixo} <strong>{titulo}</strong>: {explica}.
    </p>
  );
}

/** Mesma frase, para caber num `info` de card sem repetir texto. */
export function explicacaoDaBase(base: Base): string {
  const { titulo, explica } = TEXTO[base];
  return `Contado ${titulo}: ${explica}.`;
}
