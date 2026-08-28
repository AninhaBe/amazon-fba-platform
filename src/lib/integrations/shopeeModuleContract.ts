export class ShopeeModuleError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "ShopeeModuleError";
  }
}

export function shopeePageRequest(params: URLSearchParams) {
  const limit = Number(params.get("limit") ?? 50);
  const offset = Number(params.get("offset") ?? 0);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) {
    throw new ShopeeModuleError(400, "INVALID_PAGE", "Paginação inválida.");
  }
  return { limit, offset };
}

export function shopeePeriodRequest(params: URLSearchParams, now = new Date()) {
  // Período personalizado (E3, 28/08/2026): from/to em dia-calendário de São
  // Paulo. Antes o contrato só aceitava days e o custom era DESCARTADO em
  // silêncio — a tela deixava a pessoa escolher datas e mostrava outro período.
  const fromParam = params.get("from"), toParam = params.get("to");
  if (fromParam && toParam) {
    const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
    if (!DATE_ONLY.test(fromParam) || !DATE_ONLY.test(toParam)) {
      throw new ShopeeModuleError(400, "INVALID_PERIOD", "Datas do período personalizadas inválidas.");
    }
    const from = new Date(`${fromParam}T00:00:00-03:00`);
    const fimDoDia = new Date(`${toParam}T23:59:59.999-03:00`);
    const to = fimDoDia.getTime() > now.getTime() ? now : fimDoDia;
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from.getTime() > to.getTime()
      || to.getTime() - from.getTime() > 366 * 86_400_000) {
      throw new ShopeeModuleError(400, "INVALID_PERIOD", "Período personalizado inválido.");
    }
    const rotulo = (iso: string) => iso.slice(8, 10) + "/" + iso.slice(5, 7);
    return { from, to, label: `${rotulo(fromParam)} a ${rotulo(toParam)}` };
  }
  const value = params.get("days") ?? "30";
  const days = value === "today" ? 0 : Number(value);
  if (value !== "today" && ![7, 15, 30].includes(days)) {
    throw new ShopeeModuleError(400, "INVALID_PERIOD", "Selecione Hoje ou um período de 7, 15 ou 30 dias.");
  }
  const brazilDate = new Date(now.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
  const from = value === "today"
    ? new Date(`${brazilDate}T00:00:00-03:00`)
    : new Date(new Date(`${brazilDate}T00:00:00-03:00`).getTime() - days * 86_400_000);
  return { from, to: now, label: value === "today" ? "Hoje" : `Últimos ${days} dias` };
}

export function shopeeAbcClass(cumulativeShare: number): "A" | "B" | "C" {
  return cumulativeShare <= 0.8 ? "A" : cumulativeShare <= 0.95 ? "B" : "C";
}
