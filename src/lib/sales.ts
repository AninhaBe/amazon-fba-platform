import { spapiFetch, defaultMarketplaceId } from "./spapi";
import { cached } from "./cache";

// Sales API v1 — getOrderMetrics. Série diária de faturamento para o gráfico.

interface OrderMetric {
  interval: string;
  unitCount: number;
  orderCount: number;
  totalSales: { amount: number; currencyCode: string };
}

export interface DailyPoint {
  date: string; // YYYY-MM-DD
  revenue: number;
  orders: number;
  units: number;
}

export interface SalesSeries {
  currency: string;
  points: DailyPoint[];
  totalRevenue: number;
  totalOrders: number;
  totalUnits: number;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function getDailySales(
  days: number,
  marketplaceId = defaultMarketplaceId()
): Promise<SalesSeries> {
  return cached(`sales:${days}:${marketplaceId}`, 120_000, () =>
    fetchDailySales(days, marketplaceId)
  );
}

async function fetchDailySales(days: number, marketplaceId: string): Promise<SalesSeries> {
  const end = new Date();
  const start = new Date(Date.now() - days * 86_400_000);
  // Intervalo em fronteiras de dia no fuso do Brasil.
  const interval = `${isoDate(start)}T00:00:00-03:00--${isoDate(end)}T00:00:00-03:00`;

  const data = await spapiFetch<{ payload?: OrderMetric[] }>("/sales/v1/orderMetrics", {
    query: {
      marketplaceIds: marketplaceId,
      interval,
      granularity: "Day",
      granularityTimeZone: "America/Sao_Paulo",
    },
  });

  const list = data.payload ?? [];
  let currency = "BRL";
  let totalRevenue = 0;
  let totalOrders = 0;
  let totalUnits = 0;

  const points: DailyPoint[] = list.map((m) => {
    currency = m.totalSales.currencyCode || currency;
    totalRevenue += m.totalSales.amount;
    totalOrders += m.orderCount;
    totalUnits += m.unitCount;
    return {
      date: m.interval.slice(0, 10),
      revenue: +m.totalSales.amount.toFixed(2),
      orders: m.orderCount,
      units: m.unitCount,
    };
  });

  return {
    currency,
    points,
    totalRevenue: +totalRevenue.toFixed(2),
    totalOrders,
    totalUnits,
  };
}
