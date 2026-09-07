import type { EstadoAssinatura } from "./assinatura";
import type { TrialInfo } from "../trial";

/**
 * A CONTA ABRE OU NÃO ABRE — uma decisão, um lugar.
 *
 * ⚠️ POR QUE ISTO EXISTE COMO SINAL PRÓPRIO (07/09/2026).
 *
 * Antes, "cortada" era gravada como um trial com data no passado: cancelar
 * escrevia em `trial` e a tranca lia `trial`. Funcionava — e era exatamente a
 * família de defeito que já custou caro duas vezes neste projeto
 * (`last_success_at` e `updated_at` em 02–03/09): **uma coluna com dois
 * significados**. Quem lesse `trial.expired` não sabia dizer se a pessoa está
 * em avaliação vencida ou se cancelou a assinatura — e as duas coisas pedem
 * texto diferente na tela e caminho diferente de volta.
 *
 * Aqui a assinatura responde por si. O trial continua respondendo por si. Esta
 * função junta os dois numa decisão e devolve **por que**, para que a tela
 * possa dizer a verdade em vez de um genérico.
 *
 * ⚠️ A FRONTEIRA QUE NÃO PODE ESCORREGAR: conta **sem registro nenhum** passa.
 * É o mundo de hoje — a conta da dona do produto, a do colega e as de
 * demonstração não têm linha de trial nem de assinatura, e trancá-las por
 * engano seria derrubar o produto inteiro para cobrar de quem nunca foi
 * cobrado. Ausência aqui é "não se aplica", nunca "não pagou".
 */
export type MotivoDeAcesso =
  | "sem-registro"
  | "assinatura-ativa"
  | "trial-ativo"
  | "assinatura-cortada"
  | "trial-vencido";

export interface DecisaoDeAcesso {
  liberado: boolean;
  motivo: MotivoDeAcesso;
}

export function decidirAcesso(entrada: {
  assinatura: Pick<EstadoAssinatura, "status"> | null;
  trial: Pick<TrialInfo, "expired"> | null;
}): DecisaoDeAcesso {
  // A assinatura decide primeiro quando existe: é o sinal específico. Uma conta
  // que pagou e ainda tem sobra de avaliação não pode ser barrada pelo trial,
  // e uma que cancelou não pode ser liberada por ele.
  if (entrada.assinatura) {
    return entrada.assinatura.status === "cortada"
      ? { liberado: false, motivo: "assinatura-cortada" }
      : { liberado: true, motivo: "assinatura-ativa" };
  }
  if (entrada.trial) {
    return entrada.trial.expired
      ? { liberado: false, motivo: "trial-vencido" }
      : { liberado: true, motivo: "trial-ativo" };
  }
  return { liberado: true, motivo: "sem-registro" };
}

/** O que a pessoa lê na página de reativação. Diz o que houve e o que fazer. */
export function textoDoBloqueio(motivo: MotivoDeAcesso): string {
  if (motivo === "assinatura-cortada") {
    return "Sua assinatura do NEXO foi encerrada. Seus dados continuam guardados — reative para voltar a usar.";
  }
  if (motivo === "trial-vencido") {
    return "Seu período de avaliação do NEXO terminou. Seus dados continuam guardados — assine para continuar.";
  }
  return "Esta conta está sem acesso ao NEXO no momento.";
}
