import { defaultMarketplaceId, spapiFetch } from "./spapi";
import { swr } from "./swr";
import type { Period } from "./period";
import { collectAllNextTokenPages, splitDateRange } from "./nextTokenPagination";
import { parseTransactionFinancials, type Breakdown, type CurrencyAmount } from "./transactionsBreakdown";
import { calcularSaldo, type SaldoAmazon, type TransacaoDeSaldo } from "./amazonBalance";

interface RelatedIdentifier {
  relatedIdentifierName?: string;
  relatedIdentifierValue?: string;
}

interface TransactionContext {
  contextType?: string;
  sku?: string;
  asin?: string;
  quantityShipped?: number;
  /** `DeferredContext`: quando a Amazon libera o valor retido. */
  maturityDate?: string;
  /** `DD7` = entrega + 7 dias, a reserva padrão da Amazon. */
  deferralReason?: string;
}

interface TransactionItem {
  totalAmount?: CurrencyAmount;
  breakdowns?: Breakdown[];
  contexts?: TransactionContext[];
}

interface ApiTransaction {
  transactionId?: string;
  transactionType?: string;
  transactionStatus?: string;
  description?: string;
  postedDate?: string;
  totalAmount?: CurrencyAmount;
  relatedIdentifiers?: RelatedIdentifier[];
  breakdowns?: Breakdown[];
  items?: TransactionItem[];
  /** No NÍVEL DA TRANSAÇÃO, não do item: é aqui que vem o `DeferredContext`. */
  contexts?: TransactionContext[];
}

interface ListTransactionsResponse {
  payload?: {
    transactions?: ApiTransaction[];
    nextToken?: string;
  };
}

export interface FinancialTransaction {
  id: string;
  type: string;
  status: string;
  description: string;
  postedDate: string;
  amount: number;
  currency: string;
  orderId?: string;
  sku?: string;
}

// A SP-API devolve tipo/descrição em inglês; traduzimos os termos conhecidos e
// mantemos o original como fallback (nunca esconde um tipo novo).
const TRANSACTION_LABELS: Record<string, string> = {
  "order payment": "Pagamento de pedido",
  "shipment": "Envio",
  "refund": "Reembolso",
  "adjustment": "Ajuste",
  "service fee": "Taxa de serviço",
  "servicefee": "Taxa de serviço",
  "fba inventory fee": "Taxa de estoque FBA",
  "storage fee": "Taxa de armazenagem",
  "subscription fee": "Taxa de assinatura",
  "chargeback": "Estorno",
  "reserved": "Valor reservado",
  "deferred": "Diferido",
};

function humanizeTransaction(value?: string): string | undefined {
  if (!value) return value;
  return TRANSACTION_LABELS[value.trim().toLowerCase()] ?? value;
}

export interface TransactionSummary {
  currency: string;
  releasedAmount: number;
  deferredAmount: number;
  releasedCount: number;
  deferredCount: number;
  transactionCount: number;
  recent: FinancialTransaction[];
  startDate: string;
  endDate: string;
  source: "finances-2024-06-19";
}

const round = (value: number) => +value.toFixed(2);

export function getTransactionSummary(period: Period): Promise<TransactionSummary> {
  return swr(`transactions:${period.key}`, 5 * 60_000, () => fetchTransactions(period), {
    awaitIfEmpty: true,
  });
}

// Janela segura para a Transactions API: máximo 180 dias por consulta e nada
// mais novo que ~3 min (a Amazon rejeita datas recentes demais).
function transactionWindow(period: Period) {
  const postedAfter = period.startISO;
  const safePostedBefore = new Date(Math.min(new Date(period.endISO).getTime(), Date.now() - 3 * 60_000));
  return { postedAfter, postedBefore: safePostedBefore.toISOString(), safePostedBefore };
}

async function fetchRawTransactions(period: Period): Promise<ApiTransaction[]> {
  const { postedAfter, safePostedBefore } = transactionWindow(period);
  const marketplaceId = defaultMarketplaceId();
  const ranges = splitDateRange(new Date(postedAfter), safePostedBefore);
  const out: ApiTransaction[] = [];
  for (const range of ranges) {
    const pages = await collectAllNextTokenPages(
      (nextToken) => spapiFetch<ListTransactionsResponse>(
        "/finances/2024-06-19/transactions",
        {
          query: nextToken
            ? { nextToken }
            : { postedAfter: range.from.toISOString(), postedBefore: range.to.toISOString(), marketplaceId },
        }
      ),
      (page) => page.payload?.nextToken
    );
    for (const page of pages) out.push(...(page.payload?.transactions ?? []));
  }
  return out;
}

async function fetchTransactions(period: Period): Promise<TransactionSummary> {
  const { postedAfter, postedBefore } = transactionWindow(period);
  const transactions: FinancialTransaction[] = [];
  const rawTransactions = await fetchRawTransactions(period);

  for (const transaction of rawTransactions) {
      const orderId = transaction.relatedIdentifiers?.find((identifier) =>
        identifier.relatedIdentifierName?.toUpperCase().includes("ORDER")
      )?.relatedIdentifierValue;
      const context = transaction.items?.flatMap((item) => item.contexts ?? [])[0];
      transactions.push({
        id: transaction.transactionId || `${transaction.postedDate}-${transactions.length}`,
        type: humanizeTransaction(transaction.transactionType) || "Outros",
        status: transaction.transactionStatus || "UNKNOWN",
        description: humanizeTransaction(transaction.description || transaction.transactionType) || "Transação",
        postedDate: transaction.postedDate || postedBefore,
        amount: round(transaction.totalAmount?.currencyAmount ?? 0),
        currency: transaction.totalAmount?.currencyCode || "BRL",
        orderId,
        sku: context?.sku,
      });
  }

  transactions.sort((a, b) => b.postedDate.localeCompare(a.postedDate));
  const released = transactions.filter((transaction) => transaction.status === "RELEASED");
  const deferred = transactions.filter((transaction) => transaction.status === "DEFERRED");

  return {
    currency: transactions[0]?.currency || "BRL",
    releasedAmount: round(released.reduce((sum, transaction) => sum + transaction.amount, 0)),
    deferredAmount: round(deferred.reduce((sum, transaction) => sum + transaction.amount, 0)),
    releasedCount: released.length,
    deferredCount: deferred.length,
    transactionCount: transactions.length,
    recent: transactions.slice(0, 12),
    startDate: postedAfter,
    endDate: postedBefore,
    source: "finances-2024-06-19",
  };
}

// ---------- Resumo financeiro a partir da Transactions API ----------
// A Finances v0 (listFinancialEvents) passou a devolver os eventos com valores
// zerados nesta conta — a Amazon migrou o detalhe financeiro para a Transactions
// API. Este resumo re-baseia receita/taxas/reembolsos/repasse nessa fonte.

export interface FinanceDailyPoint {
  date: string;
  revenue: number;
  orders: number;
  units: number;
}

export interface FinanceSaleLine {
  sku: string;
  units: number;
  purchasedAt: string;
}

export interface FinanceSummaryFromTransactions {
  currency: string;
  revenue: number;      // vendas brutas de produto (ProductCharges)
  fees: number;         // taxas da Amazon (comissão, FBA, armazenagem, ads…), positivo
  refunds: number;      // produto reembolsado ao comprador, positivo
  /** Cupom/promoção bancada pela vendedora, positivo. Já abatido de `revenue`. */
  promotions: number;
  /** Frete que o comprador pagou de fato, positivo. */
  buyerShipping: number;
  reimbursements: number; // ressarcimentos de estoque FBA, positivo
  netProceeds: number;  // resultado líquido do período (exclui transferências ao banco)
  orderCount: number;
  units: number;
  daily: FinanceDailyPoint[];      // série por data de postagem (fuso do Brasil)
  salesLines: FinanceSaleLine[];   // unidades vendidas por SKU, para o COGS
  feeBreakdown: { type: string; amount: number }[];
  source: "transactions-2024-06-19";
}

function brazilDay(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

// Estrutura real da Transactions API 2024-06-19 (confirmada ao vivo):
//   Sales           → { ProductCharges | FBAInventoryReimbursement | FundTransfer }
//   Expenses        → AmazonFees → { Commission, FBAPerUnitFulfillmentFee, ... } → { Base, Tax }
//   Refunded Sales  → ProductCharges (negativo)
//   Refunded Expenses → AmazonFees (positivo, tarifa devolvida)
// Transações do tipo "Transfer" são repasses ao banco (dinheiro já contado
// saindo). "DEFERRED_RELEASED" é a liberação de vendas retidas em períodos
// anteriores — já contadas quando foram postadas (status DEFERRED). Ambas são
// ignoradas para não contar a mesma venda duas vezes: o resultado é por
// competência (RELEASED + DEFERRED = vendas postadas no período).
const TRANSFER_TYPE = "Transfer";
const RELEASED_FROM_PREVIOUS = "DEFERRED_RELEASED";

function isPeriodSale(transaction: ApiTransaction): boolean {
  return transaction.transactionType !== TRANSFER_TYPE
    && transaction.transactionStatus !== RELEASED_FROM_PREVIOUS;
}

function orderIdOf(transaction: ApiTransaction): string | undefined {
  return transaction.relatedIdentifiers?.find((identifier) =>
    identifier.relatedIdentifierName?.toUpperCase().includes("ORDER")
  )?.relatedIdentifierValue;
}


interface DailyBucket {
  revenue: number;
  units: number;
  orders: Set<string>;
}

function computeFinanceFromTransactions(rawTransactions: ApiTransaction[], period: Period): FinanceSummaryFromTransactions {
  let currency = "BRL";
  let revenue = 0;
  let fees = 0;
  let refunds = 0;
  let reimbursements = 0;
  let promotions = 0;
  let buyerShipping = 0;
  let netProceeds = 0;
  let units = 0;
  const orders = new Set<string>();
  const feeMap = new Map<string, number>();
  const dailyMap = new Map<string, DailyBucket>();
  const saleUnits = new Map<string, { sku: string; units: number; purchasedAt: string }>();

  for (const transaction of rawTransactions) {
    if (!isPeriodSale(transaction)) continue;
    const txCurrency = transaction.totalAmount?.currencyCode;
    if (txCurrency) currency = txCurrency;
    netProceeds += transaction.totalAmount?.currencyAmount ?? 0;
    const orderId = orderIdOf(transaction);
    if (orderId) orders.add(orderId);

    const parsed = parseTransactionFinancials(transaction);
    revenue += parsed.revenue;
    fees += parsed.fees;
    refunds += parsed.refunds;
    reimbursements += parsed.reimbursements;
    promotions += parsed.promotions;
    buyerShipping += parsed.buyerShipping;
    for (const [type, amount] of parsed.feeMap) feeMap.set(type, (feeMap.get(type) ?? 0) + amount);

    const day = transaction.postedDate ? brazilDay(transaction.postedDate) : null;
    const bucket = day ? (dailyMap.get(day) ?? { revenue: 0, units: 0, orders: new Set<string>() }) : null;
    if (bucket) {
      bucket.revenue += parsed.revenue;
      if (orderId) bucket.orders.add(orderId);
    }
    // Unidades e linhas por SKU (para o COGS) vêm do ProductContext dos itens.
    for (const item of transaction.items ?? []) {
      for (const ctx of item.contexts ?? []) {
        if (ctx.contextType !== "ProductContext" || !ctx.sku || !ctx.quantityShipped) continue;
        units += ctx.quantityShipped;
        if (bucket) bucket.units += ctx.quantityShipped;
        const key = ctx.sku;
        const line = saleUnits.get(key) ?? { sku: ctx.sku, units: 0, purchasedAt: transaction.postedDate ?? "" };
        line.units += ctx.quantityShipped;
        // guarda a data de venda mais antiga (para casar o custo vigente)
        if (transaction.postedDate && (!line.purchasedAt || transaction.postedDate < line.purchasedAt)) {
          line.purchasedAt = transaction.postedDate;
        }
        saleUnits.set(key, line);
      }
    }
    if (day && bucket) dailyMap.set(day, bucket);
  }

  // Série diária contínua no período (dias sem venda entram zerados).
  const daily: FinanceDailyPoint[] = [];
  const cursor = new Date(`${brazilDay(period.startISO)}T12:00:00Z`);
  const lastDay = brazilDay(period.endISO);
  while (cursor.toISOString().slice(0, 10) <= lastDay) {
    const date = cursor.toISOString().slice(0, 10);
    const bucket = dailyMap.get(date);
    daily.push({ date, revenue: round(bucket?.revenue ?? 0), orders: bucket?.orders.size ?? 0, units: bucket?.units ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return {
    currency,
    revenue: round(revenue),
    fees: round(fees),
    refunds: round(refunds),
    promotions: round(promotions),
    buyerShipping: round(buyerShipping),
    reimbursements: round(reimbursements),
    netProceeds: round(netProceeds),
    orderCount: orders.size,
    units,
    daily,
    salesLines: [...saleUnits.values()],
    feeBreakdown: [...feeMap.entries()]
      .map(([type, amount]) => ({ type, amount: round(amount) }))
      .filter((entry) => Math.abs(entry.amount) >= 0.01)
      .sort((a, b) => b.amount - a.amount),
    source: "transactions-2024-06-19",
  };
}

export function getFinanceSummaryFromTransactions(period: Period): Promise<FinanceSummaryFromTransactions> {
  return swr(
    `finance-tx:${period.key}`,
    5 * 60_000,
    async () => computeFinanceFromTransactions(await fetchRawTransactions(period), period),
    { awaitIfEmpty: true }
  );
}

// ---------- Taxas por pedido (para a tabela de rentabilidade) ----------

export interface OrderFinancials {
  fees: number;    // total de taxas da Amazon no pedido, positivo
  refunds: number; // produto reembolsado no pedido, positivo
  currency: string;
}

function computeOrderFinancials(rawTransactions: ApiTransaction[]): Record<string, OrderFinancials> {
  const byOrder: Record<string, OrderFinancials> = {};
  for (const transaction of rawTransactions) {
    if (!isPeriodSale(transaction)) continue;
    const orderId = orderIdOf(transaction);
    if (!orderId) continue;
    const parsed = parseTransactionFinancials(transaction);
    const entry = byOrder[orderId] ?? { fees: 0, refunds: 0, currency: transaction.totalAmount?.currencyCode ?? "BRL" };
    entry.fees += parsed.fees;
    entry.refunds += parsed.refunds;
    byOrder[orderId] = entry;
  }
  for (const orderId of Object.keys(byOrder)) {
    byOrder[orderId].fees = round(byOrder[orderId].fees);
    byOrder[orderId].refunds = round(byOrder[orderId].refunds);
  }
  return byOrder;
}

/** Taxas/reembolsos por pedido (orderId → totais), a partir da Transactions API. */
export function getOrderFinancialsFromTransactions(period: Period): Promise<Record<string, OrderFinancials>> {
  return swr(
    `order-fin-tx:${period.key}`,
    5 * 60_000,
    async () => computeOrderFinancials(await fetchRawTransactions(period)),
    { awaitIfEmpty: true }
  );
}

// ---------- Saldo e liberação ----------
// NÃO depende do período selecionado: "quanto tenho hoje" é um fato do agora, e
// filtrar por 7 dias esconderia uma venda retida de 10 dias atrás. A janela é
// fixa e generosa o bastante para cobrir a reserva padrão (entrega + 7 dias).

interface FinancialEventGroup {
  FinancialEventGroupId?: string;
  ProcessingStatus?: string;
  OriginalTotal?: { CurrencyCode?: string; CurrencyAmount?: number };
  FinancialEventGroupStart?: string;
}

interface ListEventGroupsResponse {
  payload?: {
    FinancialEventGroupList?: FinancialEventGroup[];
    NextToken?: string;
  };
}

const JANELA_DE_SALDO_DIAS = 60;

function janelaDeSaldo(): Period {
  const end = new Date(Date.now() - 3 * 60_000);
  const start = new Date(end.getTime() - JANELA_DE_SALDO_DIAS * 86_400_000);
  return { key: `saldo-${JANELA_DE_SALDO_DIAS}d`, startISO: start.toISOString(), endISO: end.toISOString() } as Period;
}

async function fetchEventGroups(): Promise<FinancialEventGroup[]> {
  const startedAfter = new Date(Date.now() - 180 * 86_400_000).toISOString();
  const pages = await collectAllNextTokenPages(
    (nextToken) => spapiFetch<ListEventGroupsResponse>(
      "/finances/v0/financialEventGroups",
      { query: nextToken ? { NextToken: nextToken } : { FinancialEventGroupStartedAfter: startedAfter, MaxResultsPerPage: "100" } }
    ),
    (page) => page.payload?.NextToken
  );
  return pages.flatMap((page) => page.payload?.FinancialEventGroupList ?? []);
}

/** Saldo disponível, valores retidos e quando cada um é liberado. */
export function getAmazonBalance(): Promise<SaldoAmazon> {
  return swr(
    "amazon-balance",
    10 * 60_000,
    async () => {
      // O extrato é a fonte do saldo; as transações trazem o cronograma. Se o
      // extrato falhar, ainda dá para mostrar o retido — meia informação certa
      // vale mais que nenhuma, desde que a outra metade diga "não sei".
      const [grupos, brutas] = await Promise.all([
        fetchEventGroups().catch(() => [] as FinancialEventGroup[]),
        fetchRawTransactions(janelaDeSaldo()),
      ]);

      const transacoes: TransacaoDeSaldo[] = brutas.map((transaction) => {
        const diferido = transaction.contexts?.find((c) => c.contextType === "DeferredContext");
        return {
          status: transaction.transactionStatus,
          amount: round(transaction.totalAmount?.currencyAmount ?? 0),
          currency: transaction.totalAmount?.currencyCode,
          orderId: orderIdOf(transaction),
          postedDate: transaction.postedDate,
          maturityDate: diferido?.maturityDate ?? null,
          deferralReason: diferido?.deferralReason ?? null,
        };
      });

      return calcularSaldo(
        grupos.map((g) => ({
          processingStatus: g.ProcessingStatus,
          originalTotal: { currencyAmount: g.OriginalTotal?.CurrencyAmount, currencyCode: g.OriginalTotal?.CurrencyCode },
          startDate: g.FinancialEventGroupStart ?? null,
        })),
        transacoes
      );
    },
    { awaitIfEmpty: true }
  );
}
