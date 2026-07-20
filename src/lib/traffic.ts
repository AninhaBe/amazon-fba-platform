import { defaultMarketplaceId } from "./spapi";
import { getListings } from "./listings";
import { runReport } from "./reports";
import type { Period } from "./period";
import { currentAccount, currentAccountId, runWithAccount } from "./accountContext";
import { readCache, writeCache } from "./persistentCache";

interface Money {
  amount?: number;
  currencyCode?: string;
}

interface KioskRow {
  sku?: string;
  childAsin?: string;
  parentAsin?: string;
  salesByAsin?: {
    orderedProductSales?: Money;
    unitsOrdered?: number;
    totalOrderItems?: number;
  };
  trafficByAsin?: {
    pageViews?: number;
    sessions?: number;
    buyBoxPercentage?: number;
    orderItemSessionPercentage?: number;
    unitSessionPercentage?: number;
  };
}

export interface TrafficRow {
  sku: string;
  asin?: string;
  parentAsin?: string;
  title?: string;
  sessions: number;
  pageViews: number;
  orders: number;
  units: number;
  revenue: number;
  currency: string;
  conversion: number;
  buyBoxPercentage: number | null;
}

export interface TrafficSummary {
  rows: TrafficRow[];
  totals: Omit<TrafficRow, "sku" | "asin" | "parentAsin" | "title">;
  startDate: string;
  endDate: string;
  source: "sales-and-traffic-report";
}

const round = (value: number, digits = 2) => +value.toFixed(digits);

function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

function completedDate(period: Period): string {
  const requested = new Date(`${dateOnly(period.endISO)}T00:00:00Z`);
  const yesterday = new Date();
  yesterday.setUTCHours(0, 0, 0, 0);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return dateOnly(new Date(Math.min(requested.getTime(), yesterday.getTime())).toISOString());
}

export type TrafficSummaryState =
  | { status: "ready"; summary: TrafficSummary }
  | { status: "pending" };

const jobs = new Map<string, Promise<void>>();
const failures = new Map<string, { at: number; error: unknown }>();

export async function getTrafficSummary(period: Period): Promise<TrafficSummaryState> {
  const key = `traffic:${period.key}-${currentAccountId()}`;
  const cached = await readCache<TrafficSummary>(key);
  if (cached && Date.now() - cached.at < 6 * 60 * 60_000) {
    return { status: "ready", summary: cached.value };
  }

  const failure = failures.get(key);
  if (failure && Date.now() - failure.at < 60_000) throw failure.error;
  if (failure) failures.delete(key);

  if (!jobs.has(key)) {
    const account = currentAccount();
    const run = () => fetchTrafficSummary(period);
    const job = (account ? runWithAccount(account, run) : run())
      .then((summary) => writeCache(key, summary))
      .catch((error) => {
        failures.set(key, { at: Date.now(), error });
      })
      .finally(() => jobs.delete(key));
    jobs.set(key, job);
  }
  return { status: "pending" };
}

async function fetchTrafficSummary(period: Period): Promise<TrafficSummary> {
  const marketplaceId = defaultMarketplaceId();
  const startDate = dateOnly(period.startISO);
  const endDate = completedDate(period);
  const [reportText, listings] = await Promise.all([
    runReport("GET_SALES_AND_TRAFFIC_REPORT", marketplaceId, {
      dataStartTime: startDate,
      dataEndTime: endDate,
      reportOptions: { dateGranularity: "DAY", asinGranularity: "SKU" },
    }),
    getListings(),
  ]);
  const report = JSON.parse(reportText) as { salesAndTrafficByAsin?: KioskRow[] };
  const rawRows = report.salesAndTrafficByAsin ?? [];
  const titles = new Map(listings.map((listing) => [listing.sku, listing.title]));
  const grouped = new Map<string, TrafficRow & { buyBoxWeight: number }>();

  for (const raw of rawRows) {
    const sku = raw.sku || raw.childAsin || raw.parentAsin;
    if (!sku) continue;
    const sessions = raw.trafficByAsin?.sessions ?? 0;
    const buyBox = raw.trafficByAsin?.buyBoxPercentage;
    const current = grouped.get(sku) ?? {
      sku,
      asin: raw.childAsin,
      parentAsin: raw.parentAsin,
      title: titles.get(sku),
      sessions: 0,
      pageViews: 0,
      orders: 0,
      units: 0,
      revenue: 0,
      currency: raw.salesByAsin?.orderedProductSales?.currencyCode || "BRL",
      conversion: 0,
      buyBoxPercentage: null,
      buyBoxWeight: 0,
    };
    current.sessions += sessions;
    current.pageViews += raw.trafficByAsin?.pageViews ?? 0;
    current.orders += raw.salesByAsin?.totalOrderItems ?? 0;
    current.units += raw.salesByAsin?.unitsOrdered ?? 0;
    current.revenue += raw.salesByAsin?.orderedProductSales?.amount ?? 0;
    if (buyBox != null) {
      current.buyBoxWeight += buyBox * Math.max(sessions, 1);
      current.buyBoxPercentage = current.buyBoxWeight / Math.max(current.sessions, 1);
    }
    grouped.set(sku, current);
  }

  const rows = [...grouped.values()].map((groupedRow) => ({
    sku: groupedRow.sku,
    asin: groupedRow.asin,
    parentAsin: groupedRow.parentAsin,
    title: groupedRow.title,
    sessions: groupedRow.sessions,
    pageViews: groupedRow.pageViews,
    orders: groupedRow.orders,
    units: groupedRow.units,
    currency: groupedRow.currency,
    revenue: round(groupedRow.revenue),
    conversion: groupedRow.sessions > 0 ? round((groupedRow.units / groupedRow.sessions) * 100) : 0,
    buyBoxPercentage: groupedRow.buyBoxPercentage == null ? null : round(groupedRow.buyBoxPercentage),
  }));
  rows.sort((a, b) => b.sessions - a.sessions);

  const totals = rows.reduce(
    (acc, row) => {
      acc.sessions += row.sessions;
      acc.pageViews += row.pageViews;
      acc.orders += row.orders;
      acc.units += row.units;
      acc.revenue += row.revenue;
      return acc;
    },
    { sessions: 0, pageViews: 0, orders: 0, units: 0, revenue: 0, currency: rows[0]?.currency || "BRL", conversion: 0, buyBoxPercentage: null as number | null }
  );
  totals.revenue = round(totals.revenue);
  totals.conversion = totals.sessions > 0 ? round((totals.units / totals.sessions) * 100) : 0;
  const weightedBuyBox = rows.reduce((sum, row) => sum + (row.buyBoxPercentage ?? 0) * row.sessions, 0);
  const weightedSessions = rows.reduce((sum, row) => sum + (row.buyBoxPercentage == null ? 0 : row.sessions), 0);
  totals.buyBoxPercentage = weightedSessions ? round(weightedBuyBox / weightedSessions) : null;

  return { rows, totals, startDate, endDate, source: "sales-and-traffic-report" };
}
