// Cobertura do período selecionado vs. histórico já importado (frente K).
//
// Com a fase dupla do backfill (30 dias imediatos + histórico em background),
// um filtro num mês ainda não importado devolveria cards zerados — e zero
// fabricado é proibido: "não vendeu nada" e "ainda não importei" são fatos
// diferentes. Este helper é a única fonte da distinção, compartilhado pelos
// quatro dashboards; a copy fica em cada canal, sempre com data e número,
// nunca com a palavra "parcial".

export interface CoberturaDoPeriodo {
  /** O início do período está dentro do histórico coberto (com tolerância). */
  periodoCoberto: boolean;
  /** O período INTEIRO termina antes do histórico coberto — não há nada real para mostrar. */
  periodoInteiroDescoberto: boolean;
  /**
   * O buraco ainda vai encher sozinho (backfill pending/syncing). Quando falso
   * com período descoberto, o certo é dizer de onde o histórico começa — não
   * prometer importação que não está acontecendo.
   */
  emImportacao: boolean;
  /** Início do histórico coberto (ISO), ou null se nada foi coberto ainda. */
  cobreDesde: string | null;
}

const TOLERANCIA_PADRAO_MS = 15 * 60_000;
const DIA_MS = 86_400_000;

/**
 * Meses de histórico coberto, para o aviso "sua loja está 100% sincronizada —
 * histórico de N meses completo". Arredonda por mês comercial (30 dias) e nunca
 * devolve menos de 1 quando há cobertura.
 */
export function mesesDeHistorico(coveredFrom: string | null | undefined, coveredTo: string | null | undefined): number | null {
  if (!coveredFrom || !coveredTo) return null;
  const deMs = new Date(coveredFrom).getTime();
  const ateMs = new Date(coveredTo).getTime();
  if (!Number.isFinite(deMs) || !Number.isFinite(ateMs) || ateMs <= deMs) return null;
  return Math.max(1, Math.round((ateMs - deMs) / (30 * DIA_MS)));
}

/**
 * Chave do dismiss do aviso de sincronização completa. Inclui os meses de
 * propósito: quando o alvo de histórico for aprofundado (ex.: 60d → 12 meses) e
 * a fase 2 fechar de novo, o aviso reaparece com o número novo.
 */
export function chaveDeAvisoSincronizada(connectionId: string, meses: number): string {
  return `nexo:sync-completa:${connectionId}:${meses}`;
}

/**
 * Range do período a partir da query do filtro de dashboard ("days=30" ou
 * "from=YYYY-MM-DD&to=YYYY-MM-DD") — o mesmo formato que as rotas resolvem no
 * servidor (fuso de Brasília no período personalizado).
 */
export function periodoDaQuery(query: string, agoraMs: number): { deMs: number; ateMs: number } | null {
  const params = new URLSearchParams(query);
  const from = params.get("from");
  const to = params.get("to");
  if (from && to) {
    const deMs = new Date(`${from}T00:00:00-03:00`).getTime();
    const ateMs = new Date(`${to}T23:59:59.999-03:00`).getTime();
    return Number.isFinite(deMs) && Number.isFinite(ateMs) && deMs <= ateMs ? { deMs, ateMs } : null;
  }
  const dias = Number(params.get("days") ?? "30");
  if (!Number.isFinite(dias) || dias <= 0) return null;
  return { deMs: agoraMs - dias * DIA_MS, ateMs: agoraMs };
}

export function coberturaDoPeriodo(input: {
  periodoDeMs: number;
  periodoAteMs: number;
  coveredFrom: string | null | undefined;
  status: string | null | undefined;
  toleranciaMs?: number;
}): CoberturaDoPeriodo {
  const tolerancia = input.toleranciaMs ?? TOLERANCIA_PADRAO_MS;
  const emImportacao = input.status === "pending" || input.status === "syncing";
  const cobreDesdeMs = input.coveredFrom ? new Date(input.coveredFrom).getTime() : null;

  // Nunca cobriu nada: sem dado real, qualquer período está descoberto.
  if (cobreDesdeMs == null || Number.isNaN(cobreDesdeMs)) {
    return { periodoCoberto: false, periodoInteiroDescoberto: true, emImportacao, cobreDesde: null };
  }

  const cobreDesde = new Date(cobreDesdeMs).toISOString();
  if (cobreDesdeMs - tolerancia > input.periodoAteMs) {
    return { periodoCoberto: false, periodoInteiroDescoberto: true, emImportacao, cobreDesde };
  }
  if (cobreDesdeMs - tolerancia > input.periodoDeMs) {
    return { periodoCoberto: false, periodoInteiroDescoberto: false, emImportacao, cobreDesde };
  }
  return { periodoCoberto: true, periodoInteiroDescoberto: false, emImportacao, cobreDesde };
}
