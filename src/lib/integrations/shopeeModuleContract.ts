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
