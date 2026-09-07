import { referencia } from "./stripeEvent";
import type { EventoStripe, IntencaoStripe } from "./stripeEvent";

// O que a intenção da Stripe faz com a conta.
//
// COMO O ACESSO É LIGADO E DESLIGADO
//
// Reusa o mecanismo do período de avaliação (`src/lib/trial.ts`), o mesmo que
// `scripts/trial-account.mjs` opera e que devolve 403 `TRIAL_EXPIRED` em
// `withAuthenticatedWorkspace`. Não existe segundo portão: um só lugar decide se
// a conta abre, e ele já era reversível por construção — bloquear é gravar uma
// data no passado, liberar é apagar a linha. Nada é excluído em nenhum dos dois
// sentidos, então cancelar e voltar preserva canais conectados, custos e
// histórico.
//
// POR QUE NÃO CRIAR UM WORKSPACE
//
// Em `src/lib/workspaceContext.ts` o `workspaceId` É o `sub` do usuário no
// Supabase. Criar o usuário cria o workspace; não há provisionamento separado a
// fazer aqui.

/** Estado guardado em `workspace_settings`, chave `assinatura`. */
export interface EstadoAssinatura {
  status: "ativa" | "cortada";
  /** `null` = a Stripe não mandou o campo. Nunca confundir com "não tem". */
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  email: string | null;
  atualizadoEm: string;
  ultimoEventoId: string;
  ultimoEventoTipo: string;
  /** Só quando `status === "cortada"`. */
  motivoDoCorte?: string;
}

export interface BloqueioDeAcesso {
  encerradoEm: Date;
  /** Texto lido pela pessoa no aviso da conta. Diz o que houve e o que fazer. */
  nota: string;
}

export interface DependenciasAssinatura {
  /** workspaceId (= id do usuário no Supabase) ou null se o e-mail não tem conta. */
  buscarWorkspacePorEmail(email: string): Promise<string | null>;
  /** Convida por e-mail e devolve o workspaceId recém-criado. */
  convidarPorEmail(email: string): Promise<string>;
  /** Descobre a conta a partir dos identificadores da Stripe já guardados. */
  buscarWorkspacePorStripe(clienteId: string | null, assinaturaId: string | null): Promise<string | null>;
  lerAssinatura(workspaceId: string): Promise<EstadoAssinatura | null>;
  gravarAssinatura(workspaceId: string, estado: EstadoAssinatura): Promise<void>;
  liberarAcesso(workspaceId: string): Promise<void>;
  bloquearAcesso(workspaceId: string, bloqueio: BloqueioDeAcesso): Promise<void>;
  /**
   * Manda o aviso por e-mail. OPCIONAL de propósito: e-mail que não sai não pode
   * derrubar o processamento do pagamento. Quem chama trata a falha como log,
   * nunca como erro do evento — a Stripe reentregaria e a pessoa receberia dois.
   */
  avisar?(
    tipo: "boas-vindas" | "pagamento-falhou",
    dados: { email: string | null; contaNova: boolean }
  ): Promise<void>;
}

export interface ResultadoDaIntencao {
  /** Rastro do que aconteceu, gravado no ledger de eventos. */
  desfecho: string;
  workspaceId: string | null;
  detalhe?: string;
}

const NOTA_POR_MOTIVO: Record<string, string> = {
  "assinatura com pagamento em aberto":
    "A assinatura do NEXO está com pagamento em aberto. Seus dados e canais conectados continuam aqui — regularizar o pagamento devolve o acesso na hora.",
};

const NOTA_PADRAO =
  "A assinatura do NEXO foi encerrada. Seus dados e canais conectados continuam aqui — reativar a assinatura devolve o acesso na hora.";

export async function aplicarIntencao(
  evento: EventoStripe,
  intencao: IntencaoStripe,
  deps: DependenciasAssinatura,
  agora: Date = new Date()
): Promise<ResultadoDaIntencao> {
  if (intencao.acao === "ignorar") {
    // ⚠️ "Ignorar" é sobre ACESSO, não sobre a pessoa. A cobrança que falhou não
    // corta ninguém (a Stripe ainda vai tentar de novo), mas ficar calado
    // deixaria a assinatura morrer sem que ela soubesse por quê.
    if (evento.type === "invoice.payment_failed" && deps.avisar) {
      // Os ids vêm do objeto do evento: a intenção "ignorar" não os carrega,
      // porque ela é sobre acesso, e acesso não muda aqui.
      const dono = await deps
        .buscarWorkspacePorStripe(
          referencia(evento.objeto.customer),
          referencia(evento.objeto.subscription)
        )
        .catch(() => null);
      const conta = dono ? await deps.lerAssinatura(dono).catch(() => null) : null;
      await deps.avisar("pagamento-falhou", { email: conta?.email ?? null, contaNova: false }).catch(() => {});
    }
    return { desfecho: "ignorado", workspaceId: null, detalhe: intencao.motivo };
  }

  if (intencao.acao === "cortar") {
    const workspaceId = await deps.buscarWorkspacePorStripe(intencao.clienteId, intencao.assinaturaId);
    if (!workspaceId) {
      // Não adivinhar de quem é: mexer no workspace errado é pior que não mexer.
      return { desfecho: "conta_nao_encontrada", workspaceId: null, detalhe: intencao.motivo };
    }
    const anterior = await deps.lerAssinatura(workspaceId);
    await deps.bloquearAcesso(workspaceId, {
      encerradoEm: agora,
      nota: NOTA_POR_MOTIVO[intencao.motivo] ?? NOTA_PADRAO,
    });
    await deps.gravarAssinatura(workspaceId, {
      status: "cortada",
      stripeCustomerId: intencao.clienteId ?? anterior?.stripeCustomerId ?? null,
      stripeSubscriptionId: intencao.assinaturaId ?? anterior?.stripeSubscriptionId ?? null,
      email: anterior?.email ?? null,
      atualizadoEm: agora.toISOString(),
      ultimoEventoId: evento.id,
      ultimoEventoTipo: evento.type,
      motivoDoCorte: intencao.motivo,
    });
    return { desfecho: "acesso_cortado", workspaceId, detalhe: intencao.motivo };
  }

  // liberar ------------------------------------------------------------------
  // A ordem importa: quem já tem conta é encontrado ANTES de qualquer convite.
  // Convidar de novo mandaria um "crie sua senha" para quem já tem senha, e o
  // trial em andamento perderia o sentido de ter existido.
  let workspaceId =
    (intencao.email ? await deps.buscarWorkspacePorEmail(intencao.email) : null) ??
    (await deps.buscarWorkspacePorStripe(intencao.clienteId, intencao.assinaturaId));
  let desfecho = "assinatura_confirmada";

  if (!workspaceId) {
    if (!intencao.email) {
      return {
        desfecho: "conta_nao_encontrada",
        workspaceId: null,
        detalhe: "evento sem e-mail e sem cliente Stripe conhecido",
      };
    }
    workspaceId = await deps.convidarPorEmail(intencao.email);
    desfecho = "conta_convidada";
  }

  const anterior = await deps.lerAssinatura(workspaceId);
  await deps.gravarAssinatura(workspaceId, {
    status: "ativa",
    stripeCustomerId: intencao.clienteId ?? anterior?.stripeCustomerId ?? null,
    stripeSubscriptionId: intencao.assinaturaId ?? anterior?.stripeSubscriptionId ?? null,
    email: intencao.email ?? anterior?.email ?? null,
    atualizadoEm: agora.toISOString(),
    ultimoEventoId: evento.id,
    ultimoEventoTipo: evento.type,
  });
  // Depois de gravar: se o processo morrer no meio, o pior caso é a conta ainda
  // bloqueada com a assinatura já registrada — e a Stripe reentrega o evento.
  // O inverso (acesso aberto sem registro de quem pagou) não teria conserto.
  await deps.liberarAcesso(workspaceId);

  // ⚠️ SÓ NA TRANSIÇÃO. `customer.subscription.updated` chega a cada renovação e
  // a cada mudança de cartão; mandar boas-vindas em todas transformaria o aviso
  // em spam e ensinaria a pessoa a ignorar justamente o e-mail que importa.
  if (deps.avisar && (!anterior || anterior.status === "cortada")) {
    await deps
      .avisar("boas-vindas", {
        email: intencao.email ?? anterior?.email ?? null,
        contaNova: desfecho === "conta_convidada",
      })
      .catch(() => {});
  }
  return { desfecho, workspaceId };
}
