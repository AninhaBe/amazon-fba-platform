export type FinancialValueState = "missing" | "known" | "pending_statement";
export type CoverageStatus = "complete" | "partial" | "pending";
export type CoverageUnit = "orders" | "shipping_components" | "units" | "period";
export interface ComponentCoverage {
  status: CoverageStatus; unit: CoverageUnit; applicable: number; known: number; missing: number;
  pending: number; ratio: number; capturedValue: number | null;
}
export interface FinancialOrderInput {
  revenue: number;
  buyerShipping: number | null;
  statementSettled: boolean;
  fees: number | null;
  sellerShipping: number | null;
  ads?: number | null;
  taxesWithheld?: number | null;
  refunds?: number | null;
  items: Array<{ quantity: number; unitCost: number | null }>;
}
export interface TiktokFinancialInput {
  periodCovered: boolean; orders: FinancialOrderInput[]; taxRate: number | null;
  historicalBacklog?: { applicable: number; known: number; missing?: number; pending: number };
}
export interface TiktokFinancialOverviewV2 {
  currency: string; revenue: number | null; fees: number | null; sellerShipping: number | null;
  buyerShipping: number | null; ads: number | null; taxesWithheld: number | null; refunds: number | null;
  tax: number | null; taxRate: number | null; cogs: number | null; profit: number | null;
  marginPct: number | null; roiPct: number | null;
}
export interface TiktokCoverageV2 {
  requestedPeriod: { revenue: ComponentCoverage; fees: ComponentCoverage; buyerShipping: ComponentCoverage;
    sellerShipping: ComponentCoverage; shipping: ComponentCoverage; ads: ComponentCoverage;
    taxesWithheld: ComponentCoverage; refunds: ComponentCoverage; tax: ComponentCoverage;
    cogs: ComponentCoverage; financials: ComponentCoverage };
  historicalBacklog: ComponentCoverage;
  revenue: ComponentCoverage; fees: ComponentCoverage; buyerShipping: ComponentCoverage;
  sellerShipping: ComponentCoverage; shipping: ComponentCoverage; ads: ComponentCoverage;
  taxesWithheld: ComponentCoverage; refunds: ComponentCoverage; tax: ComponentCoverage;
  cogs: ComponentCoverage; financials: ComponentCoverage;
}

function coverage(unit: CoverageUnit, applicable: number, known: number, missing = 0, pending = 0, capturedValue: number | null = null): ComponentCoverage {
  if (applicable < 0 || known < 0 || missing < 0 || pending < 0 || known + missing + pending !== applicable) {
    throw new TypeError("Cobertura TikTok inconsistente.");
  }
  const ratio = applicable === 0 ? 1 : known / applicable;
  return { status: known === applicable ? "complete" : known === 0 && pending > 0 && missing === 0 ? "pending" : "partial",
    unit, applicable, known, missing, pending, ratio, capturedValue };
}
const sum = (values: number[]) => +values.reduce((total, value) => total + value, 0).toFixed(2);

function orderComponent(orders: FinancialOrderInput[], key: "fees" | "sellerShipping" | "ads" | "taxesWithheld" | "refunds") {
  const settled = orders.filter((order) => order.statementSettled);
  const known = settled.filter((order) => order[key] != null);
  const captured = sum(known.map((order) => order[key]!));
  const resultCoverage = coverage("orders", orders.length, known.length, settled.length - known.length, orders.length - settled.length, captured);
  return { coverage: resultCoverage, value: resultCoverage.status === "complete" ? captured : null };
}

export function calculateTiktokFinancialV2(input: TiktokFinancialInput, currency = "BRL"): { overview: TiktokFinancialOverviewV2; coverage: TiktokCoverageV2 } {
  const revenue = sum(input.orders.map((order) => order.revenue));
  const revenueCoverage = coverage("period", 1, input.periodCovered ? 1 : 0, input.periodCovered ? 0 : 1, 0, revenue);
  // Receita bruta vem do pedido e não depende do extrato financeiro. Durante
  // backfill parcial mostramos apenas o total capturado, sinalizando a cobertura
  // parcial; não extrapolamos pedidos que ainda não foram importados.
  const fees = orderComponent(input.orders, "fees");
  const sellerShipping = orderComponent(input.orders, "sellerShipping");
  const ads = orderComponent(input.orders, "ads");
  const taxesWithheld = orderComponent(input.orders, "taxesWithheld");
  const refunds = orderComponent(input.orders, "refunds");
  const buyerKnown = input.orders.filter((order) => order.buyerShipping != null);
  const buyerShipping = buyerKnown.length === input.orders.length ? sum(buyerKnown.map((order) => order.buyerShipping!)) : null;
  const buyerCaptured = sum(buyerKnown.map((order) => order.buyerShipping!));
  const buyerCoverage = coverage("orders", input.orders.length, buyerKnown.length, input.orders.length - buyerKnown.length, 0, buyerCaptured);
  const shippingCoverage = coverage("shipping_components", input.orders.length * 2, sellerShipping.coverage.known + buyerKnown.length,
    sellerShipping.coverage.missing + input.orders.length - buyerKnown.length, sellerShipping.coverage.pending, null);
  const taxKnown = input.taxRate != null && revenue != null;
  const taxCoverage = coverage("period", 1, taxKnown ? 1 : 0, taxKnown ? 0 : 1, 0, taxKnown ? +(revenue! * input.taxRate! / 100).toFixed(2) : null);
  const tax = taxKnown ? +(revenue! * input.taxRate! / 100).toFixed(2) : null;
  const units = input.orders.flatMap((order) => order.items);
  const totalUnits = units.reduce((total, item) => total + item.quantity, 0);
  const knownCostUnits = units.reduce((total, item) => total + (item.unitCost != null && item.unitCost >= 0 ? item.quantity : 0), 0);
  const capturedCogs = sum(units.filter((item) => item.unitCost != null && item.unitCost >= 0).map((item) => item.unitCost! * item.quantity));
  const cogsCoverage = coverage("units", totalUnits, knownCostUnits, totalUnits - knownCostUnits, 0, capturedCogs);
  const cogs = cogsCoverage.status === "complete" ? sum(units.map((item) => item.unitCost! * item.quantity)) : null;
  const components = [revenue, fees.value, sellerShipping.value, ads.value, taxesWithheld.value, refunds.value, tax, cogs];
  const financialCoverage = coverage("period", components.length, components.filter((value) => value != null).length, components.filter((value) => value == null).length);
  const complete = input.periodCovered && components.every((value) => value != null);
  const profit = complete ? +(revenue! - fees.value! - sellerShipping.value! - ads.value! - taxesWithheld.value! - refunds.value! - tax! - cogs!).toFixed(2) : null;
  return { overview: { currency, revenue, fees: fees.value, sellerShipping: sellerShipping.value, buyerShipping,
    ads: ads.value, taxesWithheld: taxesWithheld.value, refunds: refunds.value, tax, taxRate: input.taxRate, cogs, profit,
    marginPct: profit != null && revenue! > 0 ? +(profit / revenue! * 100).toFixed(2) : null,
    roiPct: profit != null && cogs! > 0 ? +(profit / cogs! * 100).toFixed(2) : null },
    coverage: (() => {
      const requestedPeriod = { revenue: revenueCoverage, fees: fees.coverage, buyerShipping: buyerCoverage,
        sellerShipping: sellerShipping.coverage, shipping: shippingCoverage, ads: ads.coverage,
        taxesWithheld: taxesWithheld.coverage, refunds: refunds.coverage, tax: taxCoverage,
        cogs: cogsCoverage, financials: financialCoverage };
      const backlog = input.historicalBacklog ?? { applicable: 0, known: 0, missing: 0, pending: 0 };
      const historicalBacklog = coverage("orders", backlog.applicable, backlog.known, backlog.missing ?? 0, backlog.pending);
      return { requestedPeriod, historicalBacklog, ...requestedPeriod };
    })() };
}
