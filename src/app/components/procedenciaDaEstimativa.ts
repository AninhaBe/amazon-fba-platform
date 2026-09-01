// Texto puro, em arquivo .ts e nao .tsx de propósito: `node --experimental-strip-types`
// (o runner de `npm test`) não carrega `.tsx`, e a frase precisa ser testada pelo
// COMPORTAMENTO — chamando a função e conferindo a saída — e não por casamento no
// fonte, que é a família de teste decorativo que o AGENTS.md proíbe.
/**
 * A frase de procedência, montada a partir do que a Amazon devolveu.
 *
 * Fica no `title`/`aria-label` da marca — é COMPLEMENTO, não a frase que muda a
 * leitura. A que muda a leitura ("inclui R$ X estimados de N pedidos") já
 * renderiza na face do card, sem interação.
 */
export function procedenciaDaEstimativa(partes: { comissao?: number | null; fba?: number | null; moeda?: string }): string {
  const moeda = partes.moeda ?? "BRL";
  const dinheiro = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: moeda }).format(v);
  const detalhe = [
    partes.comissao == null ? null : `comissão ${dinheiro(partes.comissao)}`,
    partes.fba == null ? null : `FBA ${dinheiro(partes.fba)}`,
  ].filter(Boolean).join(" + ");
  // Sem as parcelas, a frase ainda precisa dizer as duas coisas que importam:
  // que é estimativa da Amazon e que o oficial substitui. Detalhe ausente não
  // vira zero nem some com a explicação.
  return detalhe
    ? `Estimado pela Amazon: ${detalhe} — a tarifa oficial entra na liquidação.`
    : "Estimado pela tabela da Amazon — a tarifa oficial entra na liquidação.";
}
