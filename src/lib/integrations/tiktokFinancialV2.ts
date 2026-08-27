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
  items: Array<{
    quantity: number;
    unitCost: number | null;
    /**
     * Cupom por unidade **já abatido** de `revenue` (`promotion_discount` do
     * item canônico). `null`/ausente = o canal não provou o abatimento; ver
     * `descontoDaLinha` em `tiktokCanonical.ts`. NUNCA entra como dedução —
     * `revenue` já está líquido dele.
     */
    unitDiscount?: number | null;
  }>;
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
/**
 * Cascata do faturamento: **preço de tabela − cupons = faturamento**.
 *
 * O cupom sai do bolso da vendedora e merece aparecer, mas `revenue` já vem
 * líquido dele (item canônico usa `sale_price`, pós-desconto). Somá-lo às
 * deduções descontaria duas vezes. Por isso a cascata parte do preço de tabela
 * e FECHA, ao centavo, no mesmo número do card de faturamento — mesma solução
 * aplicada na Amazon em 15/08/2026 (`src/app/amazon/page.tsx`).
 *
 * `discounts: null` = desconhecido → a tela mostra só "Faturamento", sem cascata.
 */
export interface TiktokRevenueCascade {
  /** Faturamento + cupons. Derivado do faturamento exibido, para fechar nele. */
  listRevenue: number | null;
  /** Cupons e promoções concedidos. Exibido como dedução, JAMAIS subtraído de novo. */
  discounts: number | null;
  /** O mesmo número do card de faturamento. */
  revenue: number | null;
}

/**
 * Componentes que o extrato liquidado do TikTok **discrimina**. Só para estes a
 * ausência num período conciliado é prova de que não houve cobrança (= `0`).
 *
 * `ads`, `taxesWithheld` e `refunds` ficam de fora de propósito: o extrato não
 * separa essas categorias em campo nenhum, então a ausência delas não prova
 * nada e continuam `null` (`docs/tiktok-shop-integracao.md`).
 */
export type TiktokSettledComponent = "fees" | "sellerShipping";
export const TIKTOK_SETTLED_COMPONENTS: readonly TiktokSettledComponent[] = ["fees", "sellerShipping"];

export interface TiktokCoverageV2 {
  requestedPeriod: { revenue: ComponentCoverage; fees: ComponentCoverage; buyerShipping: ComponentCoverage;
    sellerShipping: ComponentCoverage; shipping: ComponentCoverage; ads: ComponentCoverage;
    taxesWithheld: ComponentCoverage; refunds: ComponentCoverage; tax: ComponentCoverage;
    cogs: ComponentCoverage; financials: ComponentCoverage };
  historicalBacklog: ComponentCoverage;
  /**
   * Evidência que explica o card de faturamento; nunca um valor a mais.
   * Viaja em `coverage` porque é o objeto que a rota entrega inteiro à tela.
   */
  revenueCascade: TiktokRevenueCascade;
  /**
   * Componentes cujo `0` veio de AUSÊNCIA num período conciliado — a tela diz
   * "a TikTok não cobrou X no período" em vez de repetir "total do período".
   */
  settledZeros: TiktokSettledComponent[];
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
  // Cupom concedido no período. Uma única unidade sem desconto provado deixa o
  // total desconhecido: somar só as unidades provadas afirmaria um cupom menor
  // do que o concedido, e "não extrapolar" vale aqui como em qualquer outro
  // componente. Não participa de `components` nem do lucro — é explicação do
  // faturamento, não dedução.
  const discountKnownUnits = units.reduce((total, item) => total + (item.unitDiscount != null && item.unitDiscount >= 0 ? item.quantity : 0), 0);
  const discounts = totalUnits > 0 && discountKnownUnits === totalUnits
    ? sum(units.map((item) => item.unitDiscount! * item.quantity))
    : null;
  // `tax` FORA de `components` desde 26/08/2026.
  //
  // Ele e o unico item da lista que nao vem da TikTok: e a aliquota que a
  // vendedora declara por loja. Sem ela o lucro sai SEM imposto (`tax ?? 0`) e a
  // tela rotula "(sem imposto)"; `taxCoverage` continua existindo e e por ele
  // que a tela sabe apontar "Cadastrar aliquota". Todos os outros continuam
  // aqui: sem tarifa, frete, ads, retencao, estorno ou custo, o lucro seria
  // otimista e ninguem saberia — esse e o `null != 0` de dado do canal.
  const components = [revenue, fees.value, sellerShipping.value, ads.value, taxesWithheld.value, refunds.value, cogs];
  const financialCoverage = coverage("period", components.length, components.filter((value) => value != null).length, components.filter((value) => value == null).length);
  const complete = input.periodCovered && components.every((value) => value != null);
  const profit = complete ? +(revenue! - fees.value! - sellerShipping.value! - ads.value! - taxesWithheld.value! - refunds.value! - (tax ?? 0) - cogs!).toFixed(2) : null;
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
      return { requestedPeriod, historicalBacklog,
        revenueCascade: tiktokRevenueCascade(revenue, { revenue, discounts }),
        settledZeros: [], ...requestedPeriod };
    })() };
}

/**
 * Monta a cascata contra o faturamento que a tela realmente mostra.
 *
 * `base` é de onde o cupom foi somado (os pedidos do período). Se o faturamento
 * exibido vier de outra fonte — o ledger de extratos, que só conta transação
 * liquidada — as duas somas cobrem conjuntos diferentes de pedidos, e
 * `faturamento + cupom` deixaria de ser o preço de tabela de coisa nenhuma.
 * Bases diferentes ⇒ cascata suprimida, não "aproximada".
 */
export function tiktokRevenueCascade(
  displayedRevenue: number | null,
  base: { revenue: number | null; discounts: number | null }
): TiktokRevenueCascade {
  const mesmaBase = displayedRevenue != null && base.revenue != null && displayedRevenue === base.revenue;
  const discounts = mesmaBase ? base.discounts : null;
  return {
    listRevenue: displayedRevenue != null && discounts != null ? +(displayedRevenue + discounts).toFixed(2) : null,
    discounts,
    revenue: displayedRevenue,
  };
}

/** Aggregate do ledger financeiro, na forma que a autoridade de período consome. */
export interface TiktokLedgerAuthority {
  covered: boolean;
  aggregate: {
    revenue: number | null; fees: number | null; sellerShipping: number | null; buyerShipping: number | null;
    ads: number | null; taxesWithheld: number | null; refunds: number | null; finalTransactions: number;
  };
}

const LEDGER_KEYS = ["revenue", "fees", "sellerShipping", "buyerShipping", "ads", "taxesWithheld", "refunds"] as const;

/**
 * O ledger de extratos é a autoridade do período: os totais por pedido são
 * substituídos pelos dele e a cobertura passa a refletir o que ele fechou.
 *
 * Aqui mora a distinção que separa "não sei" de "não houve":
 *
 * - período **conciliado** (checkpoints terminais) **com transação liquidada**
 *   e o componente ausente ⇒ `0`, registrado em `settledZeros` para a tela
 *   dizer que a TikTok não cobrou aquilo — e não "—" para sempre;
 * - período **não conciliado** ⇒ ausente continua `null`, sempre;
 * - período conciliado **sem nenhuma transação liquidada** ⇒ também `null`:
 *   não há extrato afirmando coisa alguma, então zero seria invenção.
 *
 * Só vale para os componentes que o extrato discrimina
 * (`TIKTOK_SETTLED_COMPONENTS`); os demais permanecem desconhecidos.
 *
 * Muta `result` no lugar — é o mesmo objeto que a rota devolve.
 */
export function applyTiktokLedgerAuthority(
  result: { overview: TiktokFinancialOverviewV2; coverage: TiktokCoverageV2 },
  ledger: TiktokLedgerAuthority
): { overview: TiktokFinancialOverviewV2; coverage: TiktokCoverageV2 } {
  // Base do cupom: a soma dos pedidos, antes de o ledger assumir o faturamento.
  const operationalRevenue = result.overview.revenue;
  const settled = ledger.covered && ledger.aggregate.finalTransactions > 0;
  const settledZeros: TiktokSettledComponent[] = [];

  for (const key of LEDGER_KEYS) {
    const provesZero = settled && (TIKTOK_SETTLED_COMPONENTS as readonly string[]).includes(key);
    const reported = ledger.aggregate[key];
    const value = reported == null && provesZero ? 0 : reported;
    if (reported == null && provesZero) settledZeros.push(key as TiktokSettledComponent);
    result.overview[key] = value;
    const metric = result.coverage.requestedPeriod[key];
    metric.capturedValue = value;
    if (ledger.covered) {
      metric.known = value == null ? 0 : metric.applicable;
      metric.missing = value == null ? metric.applicable : 0;
      metric.pending = 0;
      metric.ratio = value == null ? 0 : 1;
      metric.status = value == null ? "partial" : "complete";
    } else if (metric.status === "complete") {
      // Componente completo pedido a pedido não prova período completo: enquanto
      // o extrato não fecha, o total exibido continua sendo só o capturado.
      metric.known = 0;
      metric.missing = metric.applicable;
      metric.pending = 0;
      metric.ratio = 0;
      metric.status = "partial";
    }
  }

  result.coverage.settledZeros = settledZeros;
  result.coverage.revenueCascade = tiktokRevenueCascade(result.overview.revenue, {
    revenue: operationalRevenue,
    discounts: result.coverage.revenueCascade.discounts,
  });
  // Lucro do período segue fora do ar enquanto ads, retenção e reembolso não
  // forem discriminados pelo extrato: exibi-lo aqui seria otimista sem aviso.
  result.overview.profit = null;
  result.overview.marginPct = null;
  result.overview.roiPct = null;
  result.coverage.financials.status = "partial";
  result.coverage.requestedPeriod.financials.status = "partial";
  return result;
}
