// Leitura do evento da Stripe e a decisão do que ele significa para o acesso.
//
// Módulo puro de propósito: nada aqui toca banco, rede ou relógio. Quem decide
// "libera" e "corta" é a parte do sistema que mais precisa ser lida de cabo a
// rabo sem subir infraestrutura.
//
// A regra que dá o tom: **evento não é pagamento**. `checkout.session.completed`
// só quer dizer que a pessoa terminou o checkout — no Pix ela sai dali para
// pagar no banco, e a sessão nasce `payment_status: "unpaid"`. Liberar nesse
// momento entregaria o produto de graça a quem só clicou. A confirmação do Pix
// chega depois, em `checkout.session.async_payment_succeeded`.

export interface EventoStripe {
  id: string;
  type: string;
  objeto: Record<string, unknown>;
}

/** Sessão de checkout paga, ou assinatura ativa: acesso liberado. */
export interface IntencaoLiberar {
  acao: "liberar";
  /** `null` quando o evento não carrega e-mail (assinatura só tem o cliente). */
  email: string | null;
  clienteId: string | null;
  assinaturaId: string | null;
}

/** Porta fechada, nada apagado. */
export interface IntencaoCortar {
  acao: "cortar";
  clienteId: string | null;
  assinaturaId: string | null;
  motivo: string;
}

/** Evento legítimo que não muda acesso. O motivo fica registrado. */
export interface IntencaoIgnorar {
  acao: "ignorar";
  motivo: string;
}

export type IntencaoStripe = IntencaoLiberar | IntencaoCortar | IntencaoIgnorar;

function texto(valor: unknown): string | null {
  if (typeof valor === "string" && valor.trim()) return valor.trim();
  return null;
}

/** A Stripe manda ora o id, ora o objeto expandido, no mesmo campo. */
function referencia(valor: unknown): string | null {
  if (typeof valor === "string") return texto(valor);
  if (valor && typeof valor === "object") return texto((valor as { id?: unknown }).id);
  return null;
}

export function lerEventoStripe(valor: unknown): EventoStripe {
  if (!valor || typeof valor !== "object") throw new RangeError("Evento da Stripe inválido.");
  const bruto = valor as { id?: unknown; type?: unknown; data?: { object?: unknown } };
  const id = texto(bruto.id);
  const type = texto(bruto.type);
  const objeto = bruto.data?.object;
  if (!id || !type || !objeto || typeof objeto !== "object") {
    throw new RangeError("Evento da Stripe incompleto.");
  }
  return { id, type, objeto: objeto as Record<string, unknown> };
}

/**
 * `paid` e `no_payment_required` (assinatura 100% coberta por cupom) são
 * pagamento de verdade. Qualquer outro valor — inclusive um que a Stripe venha
 * a inventar — não libera nada: fail-closed é o único padrão seguro aqui.
 */
function pagou(objeto: Record<string, unknown>): boolean {
  const status = texto(objeto.payment_status);
  return status === "paid" || status === "no_payment_required";
}

function emailDaSessao(objeto: Record<string, unknown>): string | null {
  const detalhes = objeto.customer_details as { email?: unknown } | undefined;
  const email = texto(detalhes?.email) ?? texto(objeto.customer_email);
  return email ? email.toLowerCase() : null;
}

function daSessao(objeto: Record<string, unknown>): IntencaoLiberar {
  return {
    acao: "liberar",
    email: emailDaSessao(objeto),
    clienteId: referencia(objeto.customer),
    assinaturaId: referencia(objeto.subscription),
  };
}

/**
 * Status de assinatura que fecham a porta. `past_due` fica **fora** de propósito:
 * é o cartão que venceu ou a cobrança que ainda vai ser tentada de novo, e a
 * Stripe leva dias nesse estado antes de desistir. Cortar ali castiga quem só
 * precisa trocar o cartão.
 */
const STATUS_QUE_CORTAM: Record<string, string> = {
  unpaid: "assinatura com pagamento em aberto",
  canceled: "assinatura cancelada",
  incomplete_expired: "primeira cobrança nunca foi concluída",
};

export function decidirIntencao(evento: EventoStripe): IntencaoStripe {
  const objeto = evento.objeto;
  switch (evento.type) {
    case "checkout.session.completed": {
      // Pix/boleto: o checkout termina antes do pagamento existir.
      if (!pagou(objeto)) {
        return {
          acao: "ignorar",
          motivo: `checkout concluído com payment_status ${texto(objeto.payment_status) ?? "ausente"}; o acesso espera a confirmação do pagamento`,
        };
      }
      return daSessao(objeto);
    }
    case "checkout.session.async_payment_succeeded":
      // Este evento É a confirmação do Pix/boleto. Chega depois do `completed`.
      return daSessao(objeto);
    case "checkout.session.async_payment_failed":
      return { acao: "ignorar", motivo: "pagamento assíncrono falhou; nada havia sido liberado" };
    case "checkout.session.expired":
      return { acao: "ignorar", motivo: "sessão de checkout expirou sem pagamento" };

    case "customer.subscription.deleted":
      return {
        acao: "cortar",
        clienteId: referencia(objeto.customer),
        assinaturaId: texto(objeto.id),
        motivo: "assinatura encerrada na Stripe",
      };
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const status = texto(objeto.status) ?? "";
      const motivo = STATUS_QUE_CORTAM[status];
      if (motivo) {
        return {
          acao: "cortar",
          clienteId: referencia(objeto.customer),
          assinaturaId: texto(objeto.id),
          motivo,
        };
      }
      if (status === "active" || status === "trialing") {
        // Também é o caminho de volta: quem foi cortado por `unpaid` e pagou
        // volta para `active`, e o acesso precisa voltar junto.
        return {
          acao: "liberar",
          email: null,
          clienteId: referencia(objeto.customer),
          assinaturaId: texto(objeto.id),
        };
      }
      return { acao: "ignorar", motivo: `assinatura em status ${status || "desconhecido"}; acesso inalterado` };
    }

    case "invoice.payment_failed":
      // Não corta. A Stripe ainda vai tentar de novo; o corte tem um evento
      // próprio (`unpaid`/`deleted`) e é ele quem manda.
      return { acao: "ignorar", motivo: "falha de cobrança é transitória; o corte só vem de subscription unpaid/deleted" };

    default:
      return { acao: "ignorar", motivo: `evento ${evento.type} não altera acesso` };
  }
}
