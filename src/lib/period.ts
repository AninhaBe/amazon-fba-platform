// Período de análise. Suporta preset ("últimos N dias") ou intervalo personalizado.
// O `key` tem granularidade de dia para o cache ser estável dentro do mesmo dia.

export interface Period {
  startISO: string; // início do intervalo (ISO)
  endISO: string; // fim do intervalo (ISO)
  days: number; // span em dias (usado como divisor da velocidade de venda)
  key: string; // chave estável para cache (granularidade de dia)
  custom: boolean;
}

const TZ = "-03:00"; // Brasil
// A Orders/Finances API exige que 'before' seja pelo menos 2 min atrás; usamos 3 de margem.
const SAFETY_MS = 3 * 60_000;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function periodFromDays(days: number): Period {
  const d = Math.max(1, Math.min(365, Math.round(days) || 30));
  const end = new Date(Date.now() - SAFETY_MS);
  const start = new Date(Date.now() - d * 86_400_000);
  return {
    startISO: start.toISOString(),
    endISO: end.toISOString(),
    days: d,
    key: `${ymd(start)}_${ymd(end)}`,
    custom: false,
  };
}

export function periodFromRange(from: string, to: string): Period {
  const start = new Date(`${from}T00:00:00${TZ}`);
  // A SP-API não aceita 'before' no futuro; limita a ~3 min atrás.
  const maxEnd = new Date(Date.now() - SAFETY_MS);
  let end = new Date(`${to}T23:59:59${TZ}`);
  if (isNaN(end.getTime()) || end > maxEnd) end = maxEnd;
  const startMs = isNaN(start.getTime()) ? maxEnd.getTime() - 30 * 86_400_000 : start.getTime();
  const clampedStart = Math.min(startMs, end.getTime() - 86_400_000);
  const days = Math.max(1, Math.round((end.getTime() - clampedStart) / 86_400_000));
  return {
    startISO: new Date(clampedStart).toISOString(),
    endISO: end.toISOString(),
    days,
    key: `${from}_${to}`,
    custom: true,
  };
}

/** Lê o período dos query params: ?from=YYYY-MM-DD&to=YYYY-MM-DD ou ?days=N. */
export function resolvePeriod(sp: URLSearchParams): Period {
  const from = sp.get("from");
  const to = sp.get("to");
  if (from && to) return periodFromRange(from, to);
  const days = sp.get("days") || "30";
  return periodFromDays(days === "today" ? 1 : Number(days));
}
