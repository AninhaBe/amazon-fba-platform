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
 * Chave do dismiss do aviso de sincronização completa — uma por conexão. O
 * histórico de conta nova é o mês vigente e cresce para frente (decisão da Ana,
 * 27/08/2026), então o aviso aparece uma vez, ao concluir a primeira
 * importação, e não volta depois do dismiss.
 */
export function chaveDeAvisoSincronizada(connectionId: string): string {
  return `nexo:sync-completa:${connectionId}`;
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
