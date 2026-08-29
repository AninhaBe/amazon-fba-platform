/**
 * As duas regras do painel de alíquota que NAO sao renderizacao — extraidas do
 * componente porque o teste nao alcanca JSX (o strip de tipos do Node nao le
 * `.tsx`). Mesmo caminho de `custoPorLinha.ts`.
 */

/**
 * QUEM DECIDE SE O PAINEL ABRE — separado do componente para poder ser testado.
 *
 * A ordem importa e nao e negociavel: o clique da pessoa manda sobre tudo. Sem
 * isso, uma releitura das alíquotas reabriria o painel que ela acabou de fechar,
 * e ela clicaria de novo achando que a tela nao obedece.
 *
 * Enquanto le, fica RECOLHIDO: abrir e fechar sozinho no meio do carregamento e
 * um salto de layout que ninguem pediu, e "ainda nao sei" nao e pendencia.
 */
export function painelDeAliquotaAberto(entrada: {
  abertoPeloUsuario: boolean | null;
  lendo: boolean;
  canaisSemAliquota: number;
}): boolean {
  if (entrada.abertoPeloUsuario != null) return entrada.abertoPeloUsuario;
  return !entrada.lendo && entrada.canaisSemAliquota > 0;
}

export function aliquotaEmTexto(salva: number | null): string {
  if (salva == null) return "sem alíquota";
  return `${salva.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}
