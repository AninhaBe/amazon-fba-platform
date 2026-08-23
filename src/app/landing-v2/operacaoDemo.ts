export const DEMO_PERIODS = [7, 15, 30] as const;

export type DemoPeriod = (typeof DEMO_PERIODS)[number];
export type DemoChannelId = "amazon" | "mercado_livre" | "shopee" | "tiktok_shop";

export interface DemoChannel {
  id: DemoChannelId;
  label: string;
  provider: DemoChannelId;
  accent: string;
}

export interface DemoProduct {
  id: string;
  channel: DemoChannelId;
  name: string;
  sku: string;
  stockUnits: number;
}

export interface DemoDailyLine {
  date: string;
  channel: DemoChannelId;
  productId: string;
  orders: number;
  units: number;
  revenueCents: number;
  productCostCents: number | null;
  feeCents: number;
  discountCents: number;
}

export interface DemoTotals {
  revenueCents: number;
  productCostCents: number | null;
  feeCents: number;
  discountCents: number;
  profitCents: number | null;
  orders: number;
  units: number;
  marginPct: number | null;
  discountRatePct: number;
}

export interface DemoProductTotal extends DemoTotals {
  product: DemoProduct;
}

export interface DemoPriority {
  id: "mercado-livre" | "amazon" | "shopee";
  severity: "critical" | "attention" | "observe";
  order: number;
  label: string;
  title: string;
  evidence: string;
  evidenceDetail: string;
  impact: string;
  impactDetail: string;
  nextStep: string;
  actionIntent: string;
}

export interface DemoOperation {
  generatedFor: string;
  series: DemoDailyLine[];
  products: DemoProduct[];
}

export const DEMO_CHANNELS: DemoChannel[] = [
  { id: "amazon", label: "Amazon", provider: "amazon", accent: "var(--amazon-dark)" },
  { id: "mercado_livre", label: "Mercado Livre", provider: "mercado_livre", accent: "var(--meli-dark)" },
  { id: "shopee", label: "Shopee", provider: "shopee", accent: "var(--shopee-dark)" },
  { id: "tiktok_shop", label: "TikTok Shop", provider: "tiktok_shop", accent: "var(--tiktok-dark)" },
];

export const DEMO_PRODUCTS: DemoProduct[] = [
  { id: "amz-organizador", channel: "amazon", name: "Organizador modular N-01", sku: "NEXO-AM-001", stockUnits: 98 },
  { id: "amz-suporte", channel: "amazon", name: "Suporte articulado N-02", sku: "NEXO-AM-002", stockUnits: 164 },
  { id: "amz-kit", channel: "amazon", name: "Kit protetor N-03", sku: "NEXO-AM-003", stockUnits: 211 },
  { id: "ml-luminaria", channel: "mercado_livre", name: "Luminária de apoio N-11", sku: "NEXO-ML-011", stockUnits: 72 },
  { id: "ml-estacao", channel: "mercado_livre", name: "Estação compacta N-12", sku: "NEXO-ML-012", stockUnits: 95 },
  { id: "ml-cabos", channel: "mercado_livre", name: "Organizador de cabos N-13", sku: "NEXO-ML-013", stockUnits: 138 },
  { id: "sh-kit", channel: "shopee", name: "Kit organizador N-21", sku: "NEXO-SH-021", stockUnits: 186 },
  { id: "sh-capa", channel: "shopee", name: "Capa protetora N-22", sku: "NEXO-SH-022", stockUnits: 240 },
  { id: "sh-base", channel: "shopee", name: "Base antiderrapante N-23", sku: "NEXO-SH-023", stockUnits: 155 },
  { id: "tt-suporte", channel: "tiktok_shop", name: "Suporte portátil N-31", sku: "NEXO-TT-031", stockUnits: 64 },
  { id: "tt-kit", channel: "tiktok_shop", name: "Kit de viagem N-32", sku: "NEXO-TT-032", stockUnits: 81 },
  { id: "tt-estojo", channel: "tiktok_shop", name: "Estojo compacto N-33", sku: "NEXO-TT-033", stockUnits: 103 },
];

const PRODUCT_SHARES: Record<DemoChannelId, number[]> = {
  amazon: [0.37, 0.34, 0.29],
  mercado_livre: [0.44, 0.31, 0.25],
  shopee: [0.42, 0.34, 0.24],
  tiktok_shop: [0.5, 0.3, 0.2],
};

const CURRENT_WEEK_REVENUE: Record<DemoChannelId, number[]> = {
  amazon: [3100, 3400, 3200, 3500, 3300, 3600, 3662],
  mercado_livre: [690, 735, 700, 760, 720, 800, 756],
  shopee: [1320, 1410, 1380, 1490, 1510, 1580, 1630],
  tiktok_shop: [540, 610, 625, 680, 715, 775, 855],
};

const PREVIOUS_WEEK_REVENUE: Record<DemoChannelId, number[]> = {
  amazon: [2850, 3100, 3000, 3250, 3050, 3300, 3250],
  mercado_livre: [1900, 2000, 1800, 2100, 1900, 2100, 1781],
  shopee: [1160, 1220, 1250, 1310, 1300, 1360, 1400],
  tiktok_shop: [330, 350, 365, 390, 420, 450, 495],
};

const BASE_REVENUE: Record<DemoChannelId, number> = {
  amazon: 3020,
  mercado_livre: 1940,
  shopee: 1260,
  tiktok_shop: 355,
};

const AVERAGE_TICKET: Record<DemoChannelId, number> = {
  amazon: 86,
  mercado_livre: 64,
  shopee: 45,
  tiktok_shop: 38,
};

const PRODUCT_COST_RATE: Record<DemoChannelId, number> = {
  amazon: 0.46,
  mercado_livre: 0.51,
  shopee: 0.5,
  tiktok_shop: 0.47,
};

const PRODUCT_COST_FACTORS: Record<DemoChannelId, number[]> = {
  amazon: [0.86, 1, 1.18],
  mercado_livre: [1.08, 0.94, 0.9],
  shopee: [0.92, 1.05, 1.1],
  tiktok_shop: [0.84, 1.06, 1.24],
};

const FEE_RATE: Record<DemoChannelId, number> = {
  amazon: 0.18,
  mercado_livre: 0.17,
  shopee: 0.16,
  tiktok_shop: 0.14,
};

function allocate(total: number, weights: number[]): number[] {
  if (total <= 0) return weights.map(() => 0);
  const raw = weights.map((weight) => total * weight);
  const values = raw.map(Math.floor);
  const remainder = total - values.reduce((sum, value) => sum + value, 0);
  const byRemainder = raw
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder);
  for (let index = 0; index < remainder; index += 1) {
    values[byRemainder[index % byRemainder.length].index] += 1;
  }
  return values;
}

function isoDate(today: Date, daysAgo: number) {
  const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

function revenueForDay(channel: DemoChannelId, daysAgo: number) {
  if (daysAgo <= 6) return CURRENT_WEEK_REVENUE[channel][6 - daysAgo];
  if (daysAgo <= 13) return PREVIOUS_WEEK_REVENUE[channel][13 - daysAgo];
  const weeklyWave = ((daysAgo % 7) - 3) * 0.028;
  const shortWave = ((daysAgo % 5) - 2) * 0.017;
  return Math.round(BASE_REVENUE[channel] * (1 + weeklyWave + shortWave));
}

function discountRate(channel: DemoChannelId, daysAgo: number) {
  if (channel === "shopee") {
    if (daysAgo <= 6) return 0.15;
    if (daysAgo <= 13) return 0.08;
    return 0.09;
  }
  if (channel === "tiktok_shop") return daysAgo <= 6 ? 0.12 : 0.1;
  if (channel === "mercado_livre") return 0.06;
  return 0.04;
}

function buildDay(channel: DemoChannelId, date: string, daysAgo: number): DemoDailyLine[] {
  const revenueCents = revenueForDay(channel, daysAgo) * 100;
  const rate = discountRate(channel, daysAgo);
  const discountCents = Math.round((revenueCents * rate) / (1 - rate));
  const grossCents = revenueCents + discountCents;
  const productCostCents = Math.round(grossCents * PRODUCT_COST_RATE[channel]);
  const feeCents = Math.round(revenueCents * FEE_RATE[channel]);
  const orders = Math.max(1, Math.round(revenueCents / 100 / AVERAGE_TICKET[channel]));
  const units = Math.max(orders, Math.round(orders * 1.12));
  const products = DEMO_PRODUCTS.filter((product) => product.channel === channel);
  const shares = PRODUCT_SHARES[channel];
  const rawCostWeights = shares.map((share, index) => share * PRODUCT_COST_FACTORS[channel][index]);
  const costWeightTotal = rawCostWeights.reduce((sum, weight) => sum + weight, 0);
  const costWeights = rawCostWeights.map((weight) => weight / costWeightTotal);
  const revenues = allocate(revenueCents, shares);
  const discounts = allocate(discountCents, shares);
  const costs = allocate(productCostCents, costWeights);
  const fees = allocate(feeCents, shares);
  const orderCounts = allocate(orders, shares);
  const unitCounts = allocate(units, shares);

  return products.map((product, index) => ({
    date,
    channel,
    productId: product.id,
    orders: orderCounts[index],
    units: unitCounts[index],
    revenueCents: revenues[index],
    productCostCents: costs[index],
    feeCents: fees[index],
    discountCents: discounts[index],
  }));
}

export function buildDemoOperation(today = new Date()): DemoOperation {
  const series: DemoDailyLine[] = [];
  for (let daysAgo = 59; daysAgo >= 0; daysAgo -= 1) {
    const date = isoDate(today, daysAgo);
    for (const channel of DEMO_CHANNELS) {
      series.push(...buildDay(channel.id, date, daysAgo));
    }
  }
  return { generatedFor: isoDate(today, 0), series, products: DEMO_PRODUCTS };
}

export const demoOperation = buildDemoOperation();

function datesForPeriod(series: DemoDailyLine[], period: DemoPeriod, offset = 0) {
  const dates = [...new Set(series.map((line) => line.date))].sort();
  return new Set(dates.slice(Math.max(0, dates.length - period - offset), dates.length - offset));
}

function emptyTotals(): DemoTotals {
  return {
    revenueCents: 0,
    productCostCents: 0,
    feeCents: 0,
    discountCents: 0,
    profitCents: 0,
    orders: 0,
    units: 0,
    marginPct: null,
    discountRatePct: 0,
  };
}

export function aggregateChannel(
  operation: DemoOperation,
  channel: DemoChannelId,
  period: DemoPeriod,
  offset = 0,
): DemoTotals {
  const dates = datesForPeriod(operation.series, period, offset);
  const lines = operation.series.filter((line) => line.channel === channel && dates.has(line.date));
  const totals = lines.reduce((result, line) => {
    result.revenueCents += line.revenueCents;
    result.feeCents += line.feeCents;
    result.discountCents += line.discountCents;
    result.orders += line.orders;
    result.units += line.units;
    if (result.productCostCents !== null) {
      result.productCostCents = line.productCostCents === null
        ? null
        : result.productCostCents + line.productCostCents;
    }
    return result;
  }, emptyTotals());
  const grossCents = totals.revenueCents + totals.discountCents;
  totals.profitCents = totals.productCostCents === null
    ? null
    : totals.revenueCents - totals.productCostCents - totals.feeCents;
  totals.marginPct = totals.profitCents === null || totals.revenueCents === 0
    ? null
    : (totals.profitCents / totals.revenueCents) * 100;
  totals.discountRatePct = grossCents === 0 ? 0 : (totals.discountCents / grossCents) * 100;
  return totals;
}

export function aggregateProducts(
  operation: DemoOperation,
  channel: DemoChannelId,
  period: DemoPeriod,
): DemoProductTotal[] {
  const dates = datesForPeriod(operation.series, period);
  return operation.products
    .filter((product) => product.channel === channel)
    .map((product) => {
      const lines = operation.series.filter((line) => line.productId === product.id && dates.has(line.date));
      const totals = lines.reduce((result, line) => {
        result.revenueCents += line.revenueCents;
        result.feeCents += line.feeCents;
        result.discountCents += line.discountCents;
        result.orders += line.orders;
        result.units += line.units;
        if (result.productCostCents !== null) {
          result.productCostCents = line.productCostCents === null
            ? null
            : result.productCostCents + line.productCostCents;
        }
        return result;
      }, emptyTotals());
      const grossCents = totals.revenueCents + totals.discountCents;
      totals.profitCents = totals.productCostCents === null
        ? null
        : totals.revenueCents - totals.productCostCents - totals.feeCents;
      totals.marginPct = totals.profitCents === null || totals.revenueCents === 0
        ? null
        : (totals.profitCents / totals.revenueCents) * 100;
      totals.discountRatePct = grossCents === 0 ? 0 : (totals.discountCents / grossCents) * 100;
      return { product, ...totals };
    });
}

export function dailyChart(
  operation: DemoOperation,
  channel: DemoChannelId,
  period: DemoPeriod,
) {
  const dates = datesForPeriod(operation.series, period);
  const points = new Map<string, { date: string; revenue: number; orders: number; units: number }>();
  for (const line of operation.series) {
    if (line.channel !== channel || !dates.has(line.date)) continue;
    const current = points.get(line.date) ?? { date: line.date, revenue: 0, orders: 0, units: 0 };
    current.revenue += line.revenueCents / 100;
    current.orders += line.orders;
    current.units += line.units;
    points.set(line.date, current);
  }
  return [...points.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function percentageChange(current: number, previous: number) {
  return previous === 0 ? null : ((current - previous) / previous) * 100;
}

export function derivePriorities(operation: DemoOperation): DemoPriority[] {
  const mercadoLivre = aggregateChannel(operation, "mercado_livre", 7);
  const mercadoLivreAnterior = aggregateChannel(operation, "mercado_livre", 7, 7);
  const mlChange = percentageChange(mercadoLivre.revenueCents, mercadoLivreAnterior.revenueCents) ?? 0;
  const mlImpactCents = mercadoLivreAnterior.revenueCents - mercadoLivre.revenueCents;

  const amazon = aggregateChannel(operation, "amazon", 7);
  const amazonProducts = aggregateProducts(operation, "amazon", 7).sort((a, b) => b.revenueCents - a.revenueCents);
  const amazonLeader = amazonProducts[0];
  const leaderShare = amazon.revenueCents === 0 ? 0 : (amazonLeader.revenueCents / amazon.revenueCents) * 100;
  const leaderDailyUnits = amazonLeader.units / 7;
  const coverageDays = leaderDailyUnits === 0 ? 0 : amazonLeader.product.stockUnits / leaderDailyUnits;

  const shopee = aggregateChannel(operation, "shopee", 7);
  const shopeePrevious = aggregateChannel(operation, "shopee", 7, 7);
  const discountDelta = shopee.discountRatePct - shopeePrevious.discountRatePct;

  return [
    {
      id: "mercado-livre",
      severity: "critical",
      order: 1,
      label: "Crítico",
      title: `Mercado Livre caiu ${Math.abs(Math.round(mlChange))}%`,
      evidence: "11 de 14 anúncios inativos",
      evidenceDetail: "A queda de faturamento coincide com a redução dos anúncios disponíveis.",
      impact: `−${formatMoney(mlImpactCents)} no período`,
      impactDetail: "É a diferença exata entre esta semana e os sete dias anteriores.",
      nextStep: "Revisar anúncios",
      actionIntent: "revisar os seus anúncios",
    },
    {
      id: "amazon",
      severity: "attention",
      order: 2,
      label: "Atenção",
      title: "Ruptura na Amazon",
      evidence: `${Math.round(coverageDays)} dias de cobertura`,
      evidenceDetail: `${amazonLeader.product.name} concentra ${Math.round(leaderShare)}% da receita do canal.`,
      impact: `${Math.round(leaderShare)}% da receita do canal`,
      impactDetail: "A projeção usa somente as unidades vendidas nos últimos sete dias.",
      nextStep: "Enviar reposição",
      actionIntent: "organizar a reposição deste produto",
    },
    {
      id: "shopee",
      severity: "observe",
      order: 3,
      label: "Observar",
      title: "Margem caindo na Shopee",
      evidence: `desconto médio subiu ${Math.round(discountDelta)} p.p.`,
      evidenceDetail: "A quantidade vendida subiu, mas o valor líquido por venda recuou.",
      impact: "receita sobe, lucro não",
      impactDetail: "O desconto cresce sem reduzir na mesma proporção custo e tarifa.",
      nextStep: "Rever campanhas",
      actionIntent: "rever as suas campanhas",
    },
  ];
}

export function formatMoney(cents: number | null) {
  if (cents === null) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function formatPercent(value: number | null, digits = 1) {
  if (value === null) return "—";
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: digits, minimumFractionDigits: digits })}%`;
}
