/**
 * GARANTIA DE 7 DIAS — decidida pela dona do produto em 07/09/2026, verbatim:
 * *"nao tem mais trial, todos os planos passam a valer com o pagamento, mas sera
 * os 7 dias de garantia caso a pessoa queira cancelar, e ela recebe o dinheiro
 * de volta"*.
 *
 * Substitui o período de avaliação: em vez de acesso adiantado, dinheiro de
 * volta. Quem cancela dentro da janela é reembolsado automaticamente.
 *
 * ⚠️ A JANELA CONTA DA PRIMEIRA COBRANÇA DA ASSINATURA, NUNCA DA ÚLTIMA. Se
 * contasse da fatura recorrente, toda renovação reabriria a garantia e a
 * assinatura seria reembolsável para sempre — no 13º mês, cancelar no dia
 * seguinte à cobrança devolveria o dinheiro. Quem chama tem de passar a data da
 * PRIMEIRA fatura paga, e é por isso que o campo se chama `primeiraCobrancaEm`
 * e não `ultimaCobrancaEm`.
 */
export const DIAS_DE_GARANTIA = 7;

const DIA = 86_400_000;

export type MotivoDoReembolso =
  | "dentro-da-garantia"
  | "fora-da-garantia"
  | "ja-reembolsado"
  | "sem-cobranca-conhecida";

export interface DecisaoDeReembolso {
  reembolsar: boolean;
  motivo: MotivoDoReembolso;
  /** Dias inteiros desde a primeira cobrança. `null` quando não dá para saber. */
  diasDesdeACobranca: number | null;
}

export function decidirReembolso(entrada: {
  /** Quando a PRIMEIRA fatura desta assinatura foi paga. `null` = não sabemos. */
  primeiraCobrancaEm: Date | null;
  /** A Stripe já devolveu (parte de) essa cobrança? */
  jaReembolsado: boolean;
  agora: Date;
}): DecisaoDeReembolso {
  // ⚠️ IDEMPOTÊNCIA VEM ANTES DE TUDO. A Stripe reentrega evento, e dinheiro
  // devolvido duas vezes por um cancelamento só não deixa nada vermelho.
  //
  // 📌 E a ORDEM importa por um motivo estreito, que eu só achei depois de
  // escrever um teste que ficou verde com a checagem movida para o fim: todos os
  // outros ramos já devolvem `false`, então mover a checagem entre eles não muda
  // desfecho. O único ramo que devolve `true` cedo é o da cobrança datada no
  // futuro — se a idempotência ficasse depois DELE, um evento reentregue com
  // fatura pré-datada reembolsaria de novo.
  if (entrada.jaReembolsado) {
    return { reembolsar: false, motivo: "ja-reembolsado", diasDesdeACobranca: null };
  }

  // Não sabemos quando cobrou: não reembolsa sozinho. Devolver dinheiro por
  // engano é irreversível do nosso lado; não devolver é uma conversa.
  if (!entrada.primeiraCobrancaEm) {
    return { reembolsar: false, motivo: "sem-cobranca-conhecida", diasDesdeACobranca: null };
  }

  const decorrido = entrada.agora.getTime() - entrada.primeiraCobrancaEm.getTime();
  const dias = Math.floor(decorrido / DIA);

  // Cobrança "no futuro" (relógio torto, fatura pré-datada) não é garantia
  // vencida — mas também não é motivo para recusar quem acabou de pagar.
  if (decorrido < 0) {
    return { reembolsar: true, motivo: "dentro-da-garantia", diasDesdeACobranca: 0 };
  }

  return decorrido <= DIAS_DE_GARANTIA * DIA
    ? { reembolsar: true, motivo: "dentro-da-garantia", diasDesdeACobranca: dias }
    : { reembolsar: false, motivo: "fora-da-garantia", diasDesdeACobranca: dias };
}
