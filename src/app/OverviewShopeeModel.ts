export interface CentralShopeeConnection {
  id: string;
  status: string;
}

export interface CentralProviderReadIssue {
  status: "attention";
  code: "OWNERSHIP_CONFLICT" | "PROVIDER_READ_FAILED";
  message: string;
}

export function centralProviderReadState(provider?: {
  connections?: CentralShopeeConnection[];
  issue?: CentralProviderReadIssue;
}) {
  if (provider?.issue) {
    return {
      connected: false,
      attention: true,
      message: provider.issue.message || "Não foi possível carregar este canal agora.",
    } as const;
  }
  return {
    connected: (provider?.connections ?? []).some((connection) => connection.status === "connected"),
    attention: false,
    message: null,
  } as const;
}

export interface CentralShopeeDailyPoint {
  date: string;
  revenue: number;
  orders: number;
  units: number;
}

export interface CentralShopeeOverview {
  metrics: {
    revenue30d: number;
    orders30d: number;
    cancelledRevenue: number;
    currency: string;
    revenueCoverage: { complete: boolean; capturedOrders: number; totalOrders: number };
  };
  profit: {
    estimatedProfit: number | null;
    unitsWithoutCost: number;
    coverage: { processedOrders: number; paidOrders: number; complete: boolean };
  };
  dailySales?: CentralShopeeDailyPoint[];
}

export interface CentralShopeeResponse {
  pending?: boolean;
  overview?: CentralShopeeOverview;
}

export interface CentralShopeeStoreResult {
  connectionId: string;
  result: PromiseSettledResult<CentralShopeeResponse>;
}

export interface CentralShopeeAggregate {
  availableStores: number;
  totalStores: number;
  revenue: number | null;
  profit: number | null;
  orders: number | null;
  cancelled: number | null;
  currency: string;
  profitPartial: boolean;
  dailySales: CentralShopeeDailyPoint[];
  note: string;
  error?: string;
}

/** Apenas conexões efetivamente autorizadas; IDs repetidos nunca geram duas leituras. */
export function connectedShopeeConnectionIds(connections: CentralShopeeConnection[]): string[] {
  return [...new Set(connections
    .filter((connection) => connection.status === "connected" && connection.id)
    .map((connection) => connection.id))];
}

function mergeSeries(series: Array<CentralShopeeDailyPoint[] | undefined>): CentralShopeeDailyPoint[] {
  const byDate = new Map<string, CentralShopeeDailyPoint>();
  for (const points of series) {
    for (const point of points ?? []) {
      const current = byDate.get(point.date) ?? { date: point.date, revenue: 0, orders: 0, units: 0 };
      current.revenue += point.revenue;
      current.orders += point.orders;
      current.units += point.units;
      byDate.set(point.date, current);
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Soma somente grandezas compatíveis. Falha ou pendência de uma loja preserva
 * o subtotal conhecido, mas o identifica como parcial; moedas distintas nunca
 * são somadas.
 */
export function aggregateShopeeStores(entries: CentralShopeeStoreResult[]): CentralShopeeAggregate {
  const unique = new Map<string, PromiseSettledResult<CentralShopeeResponse>>();
  for (const entry of entries) if (entry.connectionId && !unique.has(entry.connectionId)) unique.set(entry.connectionId, entry.result);
  const results = [...unique.values()];
  const fulfilled = results.flatMap((result) => result.status === "fulfilled" && !result.value.pending && result.value.overview
    ? [result.value.overview]
    : []);
  const pending = results.filter((result) => result.status === "fulfilled"
    && (result.value.pending || !result.value.overview)).length;
  const failed = results.length - fulfilled.length - pending;
  const totalStores = results.length;

  if (!fulfilled.length) {
    const reason = results.find((result) => result.status === "rejected");
    return {
      availableStores: 0,
      totalStores,
      revenue: null,
      profit: null,
      orders: null,
      cancelled: null,
      currency: "BRL",
      profitPartial: true,
      dailySales: [],
      note: pending > 0
        ? `${pending} loja(s) aguardando a primeira sincronização`
        : "Nenhuma loja Shopee pôde ser lida",
      ...(failed > 0 ? {
        error: reason?.status === "rejected" && reason.reason instanceof Error
          ? reason.reason.message
          : "Dados indisponíveis",
      } : {}),
    };
  }

  const currencies = new Set(fulfilled.map((overview) => overview.metrics.currency || "BRL"));
  const compatibleCurrency = currencies.size === 1;
  const currency = compatibleCurrency ? [...currencies][0] : "BRL";
  const knownProfits = fulfilled
    .map((overview) => overview.profit.estimatedProfit)
    .filter((value): value is number => value != null);
  const incompleteStores = failed + pending;
  const revenuePartial = incompleteStores > 0
    || fulfilled.some((overview) => !overview.metrics.revenueCoverage.complete);
  const profitPartial = incompleteStores > 0 || knownProfits.length < fulfilled.length
    || fulfilled.some((overview) => !overview.profit.coverage.complete || overview.profit.unitsWithoutCost > 0);

  const note = !compatibleCurrency
    ? "Lojas Shopee usam moedas diferentes; valores monetários não foram somados"
    : incompleteStores > 0
      ? `${fulfilled.length} de ${totalStores} loja(s) com leitura; faturamento e pedidos conhecidos são parciais`
      : revenuePartial
        ? "Faturamento capturado; sincronização ainda não cobre todo o período em todas as lojas"
        : profitPartial
          ? `Lucro calculado em ${fulfilled.length - fulfilled.filter((o) => !o.profit.coverage.complete || o.profit.unitsWithoutCost > 0).length} de ${fulfilled.length} loja(s)`
          : "Faturamento, pedidos e lucro estimado de todas as lojas";

  return {
    availableStores: fulfilled.length,
    totalStores,
    revenue: compatibleCurrency ? fulfilled.reduce((sum, overview) => sum + overview.metrics.revenue30d, 0) : null,
    profit: compatibleCurrency && knownProfits.length
      ? knownProfits.reduce((sum, value) => sum + value, 0)
      : null,
    orders: fulfilled.reduce((sum, overview) => sum + overview.metrics.orders30d, 0),
    cancelled: compatibleCurrency
      ? fulfilled.reduce((sum, overview) => sum + overview.metrics.cancelledRevenue, 0)
      : null,
    currency,
    profitPartial,
    dailySales: compatibleCurrency ? mergeSeries(fulfilled.map((overview) => overview.dailySales)) : [],
    note,
  };
}
