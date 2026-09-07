import type { EstadoAssinatura } from "./assinatura";

/**
 * A CONTA ABRE OU NÃO ABRE — uma decisão, um lugar.
 *
 * ⚠️ MODELO v3, decidido pela dona do produto em 07/09/2026, verbatim: *"nao tem
 * mais trial, todos os planos passam a valer com o pagamento, mas sera os 7 dias
 * de garantia caso a pessoa queira cancelar, e ela recebe o dinheiro de volta"*.
 *
 * **Só entra quem tem assinatura ativa — ou é admin.** Não há período de
 * avaliação: o que substitui a experimentação é a GARANTIA DE 7 DIAS, que é
 * dinheiro de volta, não acesso adiantado (ver `garantiaDeSeteDias.ts`).
 *
 * ⚠️ O TRIAL SAIU DA DECISÃO, e não é o mesmo que ter sido removido. As colunas,
 * o `src/lib/trial.ts` e o aviso na tela continuam existindo, dormentes: quem
 * tiver linha de trial hoje **não ganha acesso por ela**. Remover a infra é
 * limpeza própria, não desta frente — e enquanto ela existir, este arquivo é o
 * único lugar que decide, então ninguém volta a entrar por engano.
 *
 * ⚠️ ADMIN SEMPRE ENTRA, inclusive com assinatura cortada: é chave-mestra por
 * definição, e as contas de admin são as contas reais de quem opera o produto.
 * A exceção é ancorada na MESMA allowlist do `/admin` (`ADMIN_EMAILS`), nunca
 * num `workspace_id` escrito aqui — ver `adminWorkspaces.ts`. Um id fixo seria
 * uma segunda allowlist que ninguém revisa junto com a primeira.
 */
export type MotivoDeAcesso =
  | "admin"
  /** Não deu para perguntar ao banco. Nunca vira "não pagou". */
  | "sem-banco"
  | "sem-assinatura"
  | "assinatura-ativa"
  | "assinatura-cortada";

export interface DecisaoDeAcesso {
  liberado: boolean;
  motivo: MotivoDeAcesso;
}

export function decidirAcesso(entrada: {
  /** `true` quando o e-mail da conta está na allowlist de `/admin`. */
  admin: boolean;
  assinatura: Pick<EstadoAssinatura, "status"> | null;
}): DecisaoDeAcesso {
  // Chave-mestra primeiro, e sem olhar mais nada: se admin dependesse do estado
  // da assinatura, um corte acidental trancaria justamente quem precisa entrar
  // para consertá-lo.
  if (entrada.admin) return { liberado: true, motivo: "admin" };

  // ⚠️ E só `"ativa"` libera — qualquer outro valor bloqueia. O tipo só admite
  // dois, mas o dado vem de JSON no banco: se um dia chegar `"pausada"` ou uma
  // string vazia, o desconhecido PARA, em vez de abrir. É a mesma escolha do
  // `currentWorkspaceId()`, que lança em vez de devolver um padrão.
  if (entrada.assinatura) {
    return entrada.assinatura.status === "ativa"
      ? { liberado: true, motivo: "assinatura-ativa" }
      : { liberado: false, motivo: "assinatura-cortada" };
  }
  return { liberado: false, motivo: "sem-assinatura" };
}

/** O que a pessoa lê na página de reativação. Diz o que houve e o que fazer. */
export function textoDoBloqueio(motivo: MotivoDeAcesso): string {
  if (motivo === "assinatura-cortada") {
    return "Sua assinatura do NEXO foi encerrada. Seus dados continuam guardados — reative para voltar a usar.";
  }
  if (motivo === "sem-assinatura") {
    return "Esta conta ainda não tem uma assinatura do NEXO. Assine para começar a usar.";
  }
  return "Esta conta está sem acesso ao NEXO no momento.";
}

/**
 * A avaliação guardada no banco vale? `false` quando a data não converte.
 *
 * ⚠️ `new Date("sei la").getTime()` é `NaN`, e `Date.now() > NaN` é `false` — ou
 * seja, o caminho ingênuo trata dado torto como avaliação VÁLIDA. Enquanto
 * ausência de registro passava, isso era inofensivo; desde 07/09/2026, em que
 * ausência bloqueia, viraria uma chave: bastava um `endsAt` corrompido para a
 * conta abrir. Desconhecido para tudo.
 */
export function trialGuardadoEhValido(endsAt: string | null | undefined): boolean {
  if (!endsAt) return false;
  return Number.isFinite(new Date(endsAt).getTime());
}
