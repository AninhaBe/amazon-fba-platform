import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { dbQuery, hasDb } from "../db";
import { clearTrial, getTrialFor, setTrial } from "../trial";
import { enviarAviso } from "./emailsDaAssinatura";
import { reembolsarSeDentroDaGarantia } from "./reembolsoStripe";
import type {
  BloqueioDeAcesso,
  DependenciasAssinatura,
  EstadoAssinatura,
  ResultadoDaIntencao,
} from "./assinatura";
import type { EventoStripe } from "./stripeEvent";
import type { RegistroDeEventos } from "./webhookStripe";

// Implementação real das dependências do webhook. Tudo que fala com banco ou com
// o Supabase mora aqui; o resto de `src/lib/billing` é puro e testável.

const DIA = 86_400_000;

/** Chave em `workspace_settings` com o estado da assinatura do workspace. */
export const CHAVE_ASSINATURA = "assinatura";

/**
 * Reserva do evento em uma única instrução atômica.
 *
 * O `ON CONFLICT ... DO UPDATE ... WHERE` é o que faz a idempotência valer
 * inclusive com duas instâncias recebendo a mesma entrega ao mesmo tempo: a
 * segunda espera o lock da linha, reavalia o predicado com `received_at` já
 * atualizado e sai sem linha — portanto sem efeito.
 *
 * A janela de 15 minutos existe para o caso do processo morrer no meio do
 * efeito: a reserva órfã destrava sozinha e a retentativa da Stripe funciona.
 * Sem ela, uma compra sumiria em silêncio.
 */
export const SQL_REIVINDICAR_EVENTO = `
  INSERT INTO billing_stripe_events (event_id, event_type, received_at, attempts)
       VALUES ($1, $2, now(), 1)
  ON CONFLICT (event_id) DO UPDATE
          SET received_at = now(),
              attempts = billing_stripe_events.attempts + 1
        WHERE billing_stripe_events.processed_at IS NULL
          AND billing_stripe_events.received_at < now() - interval '15 minutes'
    RETURNING event_id`;

export function registroDeEventos(): RegistroDeEventos {
  return {
    async reivindicar(evento: EventoStripe): Promise<boolean> {
      const linhas = await dbQuery<{ event_id: string }>(SQL_REIVINDICAR_EVENTO, [
        evento.id,
        evento.type,
      ]);
      return linhas.length === 1;
    },
    async concluir(eventoId: string, resultado: ResultadoDaIntencao): Promise<void> {
      await dbQuery(
        `UPDATE billing_stripe_events
            SET processed_at = now(), outcome = $2, workspace_id = $3, detail = $4
          WHERE event_id = $1`,
        [eventoId, resultado.desfecho, resultado.workspaceId, resultado.detalhe ?? null]
      );
    },
    async devolver(eventoId: string): Promise<void> {
      await dbQuery(`DELETE FROM billing_stripe_events WHERE event_id = $1 AND processed_at IS NULL`, [
        eventoId,
      ]);
    },
  };
}

function clienteAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const segredo = process.env.SUPABASE_SECRET_KEY;
  if (!url || !segredo) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SECRET_KEY ausentes no ambiente.");
  }
  return createClient(url, segredo, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Para onde o link do convite leva. `/auth/confirm` troca o token do e-mail por
 * sessão e só então manda para a tela da senha — ir direto para `/nova-senha`
 * cairia no proxy sem sessão. É o mesmo caminho da recuperação de senha.
 */
export function destinoDoConvite(): string {
  const base = process.env.APP_BASE_URL || "http://localhost:3000";
  return `${base}/auth/confirm?next=/nova-senha`;
}

/** Páginas de 1000; o `filter` por e-mail não existe na API admin do Supabase. */
const POR_PAGINA = 1000;
const LIMITE_DE_PAGINAS = 20;

export function dependenciasDeAssinatura(): DependenciasAssinatura {
  return {
    async buscarWorkspacePorEmail(email: string): Promise<string | null> {
      const admin = clienteAdmin();
      const alvo = email.toLowerCase();
      for (let pagina = 1; pagina <= LIMITE_DE_PAGINAS; pagina += 1) {
        const { data, error } = await admin.auth.admin.listUsers({ page: pagina, perPage: POR_PAGINA });
        if (error) throw new Error(`Não foi possível listar contas no Supabase: ${error.message}`);
        const encontrado = data.users.find((usuario) => usuario.email?.toLowerCase() === alvo);
        if (encontrado) return encontrado.id;
        if (!data.nextPage) return null;
      }
      // Não devolver `null` aqui: seria "não tem conta" quando o certo é "não
      // terminei de procurar" — e o passo seguinte convidaria alguém que já tem.
      throw new Error("Busca de conta por e-mail excedeu o limite de páginas.");
    },

    async convidarPorEmail(email: string): Promise<string> {
      const admin = clienteAdmin();
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: destinoDoConvite(),
      });
      if (error || !data?.user?.id) {
        throw new Error(`Não foi possível convidar ${email}: ${error?.message ?? "resposta sem usuário"}`);
      }
      return data.user.id;
    },

    async buscarWorkspacePorStripe(clienteId, assinaturaId): Promise<string | null> {
      if (!clienteId && !assinaturaId) return null;
      const linhas = await dbQuery<{ workspace_id: string }>(
        `SELECT workspace_id
           FROM workspace_settings
          WHERE key = $1
            AND ( ($2::text IS NOT NULL AND value->>'stripeCustomerId' = $2)
               OR ($3::text IS NOT NULL AND value->>'stripeSubscriptionId' = $3) )
          LIMIT 2`,
        [CHAVE_ASSINATURA, clienteId, assinaturaId]
      );
      // Duas contas com o mesmo cliente Stripe é defeito de dado. Escolher uma
      // seria mexer no workspace errado — fail-closed, o evento fica registrado
      // como conta não encontrada e alguém olha.
      if (linhas.length !== 1) return null;
      return linhas[0].workspace_id;
    },

    async lerAssinatura(workspaceId: string): Promise<EstadoAssinatura | null> {
      const linhas = await dbQuery<{ value: EstadoAssinatura }>(
        `SELECT value FROM workspace_settings WHERE workspace_id = $1 AND key = $2`,
        [workspaceId, CHAVE_ASSINATURA]
      );
      return linhas[0]?.value ?? null;
    },

    async gravarAssinatura(workspaceId: string, estado: EstadoAssinatura): Promise<void> {
      await dbQuery(
        `INSERT INTO workspace_settings (workspace_id, key, value, updated_at)
              VALUES ($1, $2, $3::jsonb, now())
         ON CONFLICT (workspace_id, key)
           DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [workspaceId, CHAVE_ASSINATURA, JSON.stringify(estado)]
      );
    },

    /** Apaga o prazo: a conta volta a abrir. Nada mais é tocado. */
    async liberarAcesso(workspaceId: string): Promise<void> {
      await clearTrial(workspaceId);
    },

    /**
     * Fecha a porta gravando um prazo já vencido — o mesmo caminho do período de
     * avaliação. Voltar é mudar a data; nenhum canal, custo ou pedido é apagado.
     */
    async reembolsarSeDentroDaGarantia(assinaturaId, agora) {
      return reembolsarSeDentroDaGarantia(assinaturaId, agora);
    },

    async avisar(tipo, dados): Promise<void> {
      const falha = await enviarAviso(tipo, dados);
      // Log, nunca exceção: ver a dependência `avisar` em `assinatura.ts`.
      if (falha) console.error(`[billing] aviso "${tipo}" não saiu: ${falha}`);
    },

    async bloquearAcesso(workspaceId: string, bloqueio: BloqueioDeAcesso): Promise<void> {
      const atual = await getTrialFor(workspaceId).catch(() => null);
      const inicioAtual = atual ? new Date(atual.startsAt) : null;
      const inicio =
        inicioAtual && inicioAtual.getTime() < bloqueio.encerradoEm.getTime()
          ? inicioAtual
          : bloqueio.encerradoEm;
      await setTrial(workspaceId, {
        startsAt: inicio,
        days: (bloqueio.encerradoEm.getTime() - inicio.getTime()) / DIA,
        note: bloqueio.nota,
      });
    },
  };
}

/** `false` quando falta banco: o webhook responde 503 e a Stripe reentrega. */
export function webhookPronto(): boolean {
  return hasDb();
}
