import {
  AssinaturaStripeInvalida,
  verificarAssinaturaStripe,
} from "./stripeSignature";
import { decidirIntencao, lerEventoStripe, type EventoStripe } from "./stripeEvent";
import { aplicarIntencao, type DependenciasAssinatura, type ResultadoDaIntencao } from "./assinatura";

// Orquestração do webhook, sem nada de Next dentro: a rota é só o adaptador
// HTTP. É aqui que o comportamento inteiro pode ser exercitado em teste — do
// header inválido ao evento repetido — sem subir servidor nem banco.

/**
 * Ledger de eventos já vistos. A Stripe reentrega o mesmo evento (retentativa,
 * replay manual, duas instâncias recebendo em paralelo), e cada reentrega
 * chegaria aqui como uma compra nova.
 */
export interface RegistroDeEventos {
  /**
   * Reserva o evento para ESTA execução. `true` só para quem reservou; qualquer
   * concorrente recebe `false` e não faz efeito nenhum.
   */
  reivindicar(evento: EventoStripe): Promise<boolean>;
  concluir(eventoId: string, resultado: ResultadoDaIntencao): Promise<void>;
  /** Devolve o evento para a fila quando o efeito falhou no meio. */
  devolver(eventoId: string): Promise<void>;
}

export interface DependenciasWebhook {
  registro: RegistroDeEventos;
  assinatura: DependenciasAssinatura;
}

export interface EntradaWebhook {
  /** Corpo bruto, exatamente como chegou. */
  corpo: string;
  cabecalhoAssinatura: string | null | undefined;
  segredo: string | undefined;
  agora?: Date;
}

export interface RespostaWebhook {
  status: number;
  corpo: Record<string, unknown>;
}

export async function processarWebhookStripe(
  entrada: EntradaWebhook,
  deps: DependenciasWebhook
): Promise<RespostaWebhook> {
  const agora = entrada.agora ?? new Date();

  if (!entrada.segredo?.trim()) {
    // 503, não 400: o problema é do servidor, e a Stripe reentrega depois que
    // o segredo existir. Aceitar sem verificar seria abrir a porta.
    return { status: 503, corpo: { error: "Webhook da Stripe não configurado." } };
  }

  try {
    verificarAssinaturaStripe({
      corpo: entrada.corpo,
      cabecalho: entrada.cabecalhoAssinatura,
      segredo: entrada.segredo,
      agora: agora.getTime(),
    });
  } catch (erro) {
    if (erro instanceof AssinaturaStripeInvalida) {
      // Nada foi reivindicado, nada foi criado: a validação vem antes de tudo.
      return { status: 400, corpo: { error: erro.message } };
    }
    throw erro;
  }

  let evento: EventoStripe;
  try {
    evento = lerEventoStripe(JSON.parse(entrada.corpo));
  } catch {
    return { status: 400, corpo: { error: "Corpo do evento da Stripe inválido." } };
  }

  if (!(await deps.registro.reivindicar(evento))) {
    // Já processado (ou sendo processado agora por outra instância). 200 porque
    // do ponto de vista da Stripe está entregue — reentregar de novo não muda nada.
    return { status: 200, corpo: { recebido: true, duplicado: true } };
  }

  try {
    const intencao = decidirIntencao(evento);
    const resultado = await aplicarIntencao(evento, intencao, deps.assinatura, agora);
    await deps.registro.concluir(evento.id, resultado);
    return {
      status: 200,
      corpo: { recebido: true, desfecho: resultado.desfecho },
    };
  } catch (erro) {
    // Sem isto o evento ficaria reservado para sempre e a retentativa da Stripe
    // seria descartada como duplicada — a compra sumiria em silêncio.
    await deps.registro.devolver(evento.id).catch(() => {});
    console.error("Falha ao processar evento da Stripe", {
      eventoId: evento.id,
      tipo: evento.type,
      motivo: erro instanceof Error ? erro.message : "erro desconhecido",
    });
    return { status: 503, corpo: { error: "Não foi possível processar o evento agora." } };
  }
}
