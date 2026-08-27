// Rótulo único de "a alíquota do vendedor não está cadastrada".
//
// Decisão dela em 26/08/2026: alíquota ausente PARA de bloquear lucro e margem.
// Os números aparecem calculados sem o imposto, com este rótulo ao lado — e a
// pendência "Cadastrar alíquota →" continua na tela, porque mostrar o número
// não dispensa apontar o que falta.
//
// ⚠️ ISTO NÃO AFROUXA O `null ≠ 0`.
//
// A alíquota é CONFIGURAÇÃO DA VENDEDORA, não dado do canal: ela sabe que não
// cadastrou, e o rótulo diz exatamente o que o número é. Tarifa, frete e custo
// desconhecidos continuam bloqueando lucro e margem — esses são dado que o
// marketplace ainda não entregou, e olhando a tela ninguém consegue distinguir
// "não cobraram" de "ainda não sei". Confundir os dois corromperia decisão de
// preço; dizer "sem imposto" não corrompe nada, porque está escrito.
//
// Compartilhado de propósito: quatro canais escrevendo o mesmo rótulo à mão
// divergiriam na primeira revisão de texto.

export const SUFIXO_SEM_IMPOSTO = " (sem imposto)";

/** Acrescenta o rótulo ao contexto do card quando falta a alíquota. */
export function comSemImposto(contexto: string, semAliquota: boolean): string {
  if (!semAliquota) return contexto;
  return contexto.endsWith(SUFIXO_SEM_IMPOSTO) ? contexto : `${contexto}${SUFIXO_SEM_IMPOSTO}`;
}
