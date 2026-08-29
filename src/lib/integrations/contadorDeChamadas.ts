import { dbQuery, hasDb } from "../db";
import { runComoFundo } from "../execucaoDeFundo";

/**
 * Quantas vezes o NEXO chamou cada endpoint de cada marketplace, por hora.
 *
 * ## Por que existe (29/08/2026)
 *
 * A Shopee abriu um alerta de comportamento anormal contra o nosso app, e a
 * pergunta óbvia — "quantas chamadas por endpoint e por hora?" — **não tinha
 * como ser respondida**. Não existia contador nenhum, em canal nenhum. A
 * resposta teve que ser derivada de código e configuração, e nesse dia ninguém
 * pôde dizer se a origem do alerta era nossa.
 *
 * Alerta de plataforma vai acontecer de novo. Chegar sem dado numa segunda vez
 * seria escolha, não fatalidade.
 *
 * ## Por que acumula em memória antes de gravar
 *
 * Uma escrita por chamada externa dobraria o tráfego de banco do sync — e o
 * instrumento que custa mais que o que mede é exatamente o coletor de métricas
 * que derrubou a produção às 3h desta mesma madrugada. Aqui o processo soma em
 * memória e descarrega em lote, por hora e por endpoint.
 *
 * ⚠️ A descarga é em intervalo curto (30s) de propósito: contador que só existe
 * na memória não responde "e ontem às 3h?" — que é justamente a pergunta de um
 * incidente. Perder até 30 segundos numa queda é aceitável; perder o dia todo
 * não é.
 *
 * ⚠️ A descarga roda como FUNDO: é trabalho de instrumentação e não pode
 * disputar o slot de quem está esperando a tela.
 */

type Provider = "shopee" | "mercado_livre" | "amazon" | "tiktok_shop";

interface Acumulado {
  provider: Provider;
  endpoint: string;
  hora: string;
  workspaceId: string | null;
  connectionId: string | null;
  chamadas: number;
  erros: number;
  ultimoStatus: number | null;
  ultimoLimite: string | null;
}

const INTERVALO_DE_DESCARGA_MS = Number(process.env.CONTADOR_DESCARGA_MS || 30_000);

const acumulado = new Map<string, Acumulado>();
let agendada: NodeJS.Timeout | null = null;

function horaCheia(): string {
  const agora = new Date();
  agora.setUTCMinutes(0, 0, 0);
  return agora.toISOString();
}

export interface RegistroDeChamada {
  /** Status HTTP da resposta, quando houve resposta. */
  status?: number | null;
  /** Cabeçalho de limite do canal, se ele mandar algum. Hoje jogávamos fora. */
  limite?: string | null;
  /** `true` quando a chamada falhou — erro de transporte ou envelope de erro. */
  erro?: boolean;
  workspaceId?: string | null;
  connectionId?: string | null;
}

/**
 * Registra UMA chamada externa. Nunca lança: instrumentação que derruba o
 * trabalho que ela observa é pior que não ter instrumentação.
 */
export function registrarChamada(
  provider: Provider,
  endpoint: string,
  registro: RegistroDeChamada = {}
): void {
  try {
    const hora = horaCheia();
    const workspaceId = registro.workspaceId ?? null;
    const connectionId = registro.connectionId ?? null;
    const chave = `${provider}|${endpoint}|${hora}|${workspaceId ?? ""}|${connectionId ?? ""}`;
    const atual = acumulado.get(chave);
    if (atual) {
      atual.chamadas += 1;
      if (registro.erro) atual.erros += 1;
      if (registro.status != null) atual.ultimoStatus = registro.status;
      if (registro.limite != null) atual.ultimoLimite = registro.limite;
    } else {
      acumulado.set(chave, {
        provider,
        endpoint,
        hora,
        workspaceId,
        connectionId,
        chamadas: 1,
        erros: registro.erro ? 1 : 0,
        ultimoStatus: registro.status ?? null,
        ultimoLimite: registro.limite ?? null,
      });
    }
    agendarDescarga();
  } catch {
    // Silêncio AQUI é o certo: falhar ao contar não pode quebrar a chamada.
  }
}

function agendarDescarga(): void {
  if (agendada || !hasDb()) return;
  agendada = setTimeout(() => {
    agendada = null;
    void descarregar();
  }, INTERVALO_DE_DESCARGA_MS);
  // Não segura o processo: um contador não pode adiar o encerramento.
  agendada.unref?.();
}

/** Grava o que está acumulado. Exportada para o teste e para o encerramento. */
export async function descarregar(): Promise<void> {
  if (!hasDb() || acumulado.size === 0) return;
  const lote = [...acumulado.values()];
  acumulado.clear();
  try {
    await runComoFundo(async () => {
      for (const linha of lote) {
        await dbQuery(
          `INSERT INTO marketplace_api_calls
             (provider, endpoint, hora, workspace_id, connection_id, chamadas, erros, ultimo_status, ultimo_limite, atualizado_em)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
           ON CONFLICT (provider, endpoint, hora, COALESCE(workspace_id, ''), COALESCE(connection_id, ''))
           DO UPDATE SET
             chamadas = marketplace_api_calls.chamadas + EXCLUDED.chamadas,
             erros = marketplace_api_calls.erros + EXCLUDED.erros,
             ultimo_status = COALESCE(EXCLUDED.ultimo_status, marketplace_api_calls.ultimo_status),
             ultimo_limite = COALESCE(EXCLUDED.ultimo_limite, marketplace_api_calls.ultimo_limite),
             atualizado_em = now()`,
          [
            linha.provider,
            linha.endpoint,
            linha.hora,
            linha.workspaceId,
            linha.connectionId,
            linha.chamadas,
            linha.erros,
            linha.ultimoStatus,
            linha.ultimoLimite,
          ]
        );
      }
    });
  } catch (erro) {
    // O lote se perde, e isso é melhor que reter para sempre: contador que
    // acumula sem conseguir gravar vira vazamento de memória. Mas some do mundo
    // se não for registrado — silêncio por desenho já custou caro hoje.
    console.error("[contador] falha ao gravar chamadas ao marketplace", {
      linhas: lote.length,
      motivo: erro instanceof Error ? erro.message.slice(0, 200) : "erro desconhecido",
    });
  }
}

/** Só para teste: o que está acumulado e ainda não foi gravado. */
export function acumuladoAtual(): ReadonlyArray<Acumulado> {
  return [...acumulado.values()];
}
