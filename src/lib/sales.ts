import { spapiFetch, defaultMarketplaceId } from "./spapi";
import { cacheScope } from "./accountContext";
import { swr } from "./swr";
import type { Period } from "./period";

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

// Wall clock no fuso do Brasil (-03:00, sem horário de verão desde 2019).
// Desloca 3h e lê os campos UTC para obter a hora local de Brasília.
function brOffsetIso(d: Date): string {
  const br = new Date(d.getTime() - 3 * 3600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${br.getUTCFullYear()}-${p(br.getUTCMonth() + 1)}-${p(br.getUTCDate())}T${p(br.getUTCHours())}:${p(br.getUTCMinutes())}:${p(br.getUTCSeconds())}-03:00`;
}

export function getDailySales(
  period: Period,
  marketplaceId = defaultMarketplaceId()
): Promise<SalesSeries> {
  // Este é o número que precisa BATER com o Seller Central — inclusive a venda
  // que acabou de entrar. Enquanto a janela alcança hoje, o dado muda o tempo
  // todo, então cache longo (10 min) e entrega de valor velho enganam: medido em
  // 22/08/2026, uma venda das 17:32 não apareceu porque a tela recebeu o cache
  // das 17:00 e a atualização foi para segundo plano.
  //
  // Período fechado no passado não muda: mantém o cache longo e barato.
  const hoje = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
  const alcancaHoje = period.key.endsWith(hoje);
  return swr(
    `sales:${cacheScope()}:${period.key}:${marketplaceId}`,
    alcancaHoje ? 60_000 : 10 * 60_000,
    () => fetchDailySales(period, marketplaceId),
    {
      awaitIfEmpty: true,
      // Vencido e alcançando hoje: espera o número novo (teto de 1,8s para não
      // furar o orçamento de resposta do ADR-017 se a SP-API estiver lenta).
      awaitIfStaleMs: alcancaHoje ? 1800 : 0,
    }
  );
}

async function fetchDailySales(period: Period, marketplaceId: string): Promise<SalesSeries> {
  const start = new Date(period.startISO);
  const end = new Date(period.endISO);
  // Começa na fronteira do dia inicial e termina no horário ATUAL — assim o dia
  // de hoje (ainda parcial) entra na série. granularity=Day devolve o bucket de
  // hoje em aberto, refletindo as vendas até agora.
  const interval = `${isoDate(start)}T00:00:00-03:00--${brOffsetIso(end)}`;

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
