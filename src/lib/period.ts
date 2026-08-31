// Período de análise. Suporta preset ("últimos N dias") ou intervalo personalizado.
// O `key` tem granularidade de dia para o cache ser estável dentro do mesmo dia.

export interface Period {
  startISO: string; // início do intervalo (ISO)
  endISO: string; // fim do intervalo (ISO)
  days: number; // span em dias (usado como divisor da velocidade de venda)
  key: string; // chave estável para cache (granularidade de dia)
  custom: boolean;
}

const TZ = "-03:00"; // Brasil (sem horário de verão desde 2019: offset fixo)
const TZ_OFFSET_MS = 3 * 60 * 60_000;
// A Orders/Finances API exige que 'before' seja pelo menos 2 min atrás; usamos 3 de margem.
const SAFETY_MS = 3 * 60_000;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Data de hoje no fuso de Brasília (YYYY-MM-DD), independente do fuso do servidor. */
function hojeEmBrasilia(agora = Date.now()): string {
  // Desloca o instante para que os métodos UTC devolvam o relógio de parede BRT.
  return new Date(agora - TZ_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Preset "últimos N dias" alinhado ao DIA-CALENDÁRIO de Brasília — não a uma
 * janela móvel de 24h.
 *
 * O bug que isto corrige (medido em 22/08/2026): "Hoje" era `agora − 24h`, então
 * uma venda feita 21/08 às 21:12 caía dentro da janela às 12:39 do dia 22 e
 * aparecia como venda de hoje. O Seller Central conta em horário de Brasília e
 * mostrava a mesma venda no dia 21 — os dois discordavam do dia.
 *
 * `N=1` (Hoje) vira de hoje 00:00 BRT até agora. `N` vira dos N dias-calendário
 * terminando hoje. O fim nunca passa de ~3 min atrás (limite da SP-API).
 */
export function periodFromDays(days: number): Period {
  const d = Math.max(1, Math.min(365, Math.round(days) || 30));
  const hoje = hojeEmBrasilia();
  const inicioHoje = new Date(`${hoje}T00:00:00${TZ}`);
  const start = new Date(inicioHoje.getTime() - (d - 1) * 86_400_000);
  const maxEnd = new Date(Date.now() - SAFETY_MS);
  // Antes do primeiro instante de hoje (madrugada), o teto do dia ainda não
  // passou: `end` fica no próprio `maxEnd`, nunca antes de `start`.
  const end = maxEnd.getTime() > start.getTime() ? maxEnd : new Date(start.getTime() + 1000);
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
  // ⚠️ O DEFAULT DO SERVIDOR ACOMPANHA O DA TELA (31/08/2026).
  //
  // Era `|| "30"` enquanto o cliente passou a abrir em "Hoje" — dois defaults,
  // e a divergência já estava sangrando: a narração do dashboard da Amazon
  // dispara quando `days` está AUSENTE (`BriefingLead`), montava o payload com
  // os números da tela e rotulava como "nos últimos 30 dias". Na conta dela isso
  // produziu "o faturamento ficou em R$ 0,00" ao lado de um card de R$ 1.068,37.
  //
  // Dois defaults em lugares diferentes divergem — a questão é só quando.
  const days = sp.get("days") || "today";
  return periodFromDays(days === "today" ? 1 : Number(days));
}
