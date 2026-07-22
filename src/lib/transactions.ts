import { defaultMarketplaceId, spapiFetch } from "./spapi";
import { swr } from "./swr";
import type { Period } from "./period";
import { collectAllNextTokenPages, splitDateRange } from "./nextTokenPagination";

interface CurrencyAmount {
  currencyAmount?: number;
  currencyCode?: string;
}

interface RelatedIdentifier {
  relatedIdentifierName?: string;
  relatedIdentifierValue?: string;
}

interface Breakdown {
  breakdownType?: string;
  breakdownAmount?: CurrencyAmount;
  breakdowns?: Breakdown[];
}

interface TransactionContext {
  contextType?: string;
  sku?: string;
  asin?: string;
  quantityShipped?: number;
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

export interface FinanceItemLine {
  orderId: string;
  sku?: string;
  quantity: number;
  revenue: number;
  postedDate: string;
  currency: string;
}

export interface FinanceSummaryFromTransactions {
  currency: string;
  revenue: number;
  fees: number;
  promotions: number;
  refunds: number;
  netProceeds: number;
  orderCount: number;
  feeBreakdown: { type: string; amount: number }[];
  itemLines: FinanceItemLine[];
  source: "transactions-2024-06-19";
}

type FeeCategory = "revenue" | "fees" | "refund" | "tax" | "shipping" | "promotion" | "other";

// Classificação por palavra-chave: robusta a variações de texto da Amazon
// ("Amazon Fees", "FBA Fees", "MarketplaceFacilitatorTax", "Sales"...).
function categorizeBreakdown(type: string): FeeCategory {
  const t = type.toLowerCase();
  if (t.includes("refund")) return "refund";
  if (t.includes("fee")) return "fees";
  if (t.includes("tax")) return "tax";
  if (t.includes("promo")) return "promotion";
  if (t.includes("ship")) return "shipping";
  if (t.includes("sale") || t.includes("principal") || t.includes("product")) return "revenue";
  return "other";
}

// Soma apenas as folhas da árvore de breakdowns (nós sem filhos), evitando
// contar duas vezes um pai que já é a soma dos filhos.
function walkLeafBreakdowns(breakdowns: Breakdown[] | undefined, visit: (type: string, amount: number) => void) {
  for (const node of breakdowns ?? []) {
    if (node.breakdowns?.length) {
      walkLeafBreakdowns(node.breakdowns, visit);
    } else if (node.breakdownType) {
      visit(node.breakdownType, node.breakdownAmount?.currencyAmount ?? 0);
    }
  }
}

function computeFinanceFromTransactions(rawTransactions: ApiTransaction[]): FinanceSummaryFromTransactions {
  let currency = "BRL";
  let revenue = 0;
  let fees = 0;
  let promotions = 0;
  let refunds = 0;
  let netProceeds = 0;
  const orders = new Set<string>();
  const feeMap = new Map<string, number>();
  const itemLineMap = new Map<string, FinanceItemLine>();

  for (const transaction of rawTransactions) {
    const txCurrency = transaction.totalAmount?.currencyCode;
    if (txCurrency) currency = txCurrency;
    // Repasse líquido = soma dos totais das transações (cada total já vem
    // líquido de suas taxas). Campo confiável — é o mesmo que a tabela usa.
    netProceeds += transaction.totalAmount?.currencyAmount ?? 0;
    const orderId = transaction.relatedIdentifiers?.find((identifier) =>
      identifier.relatedIdentifierName?.toUpperCase().includes("ORDER")
    )?.relatedIdentifierValue;
    if (orderId) orders.add(orderId);

    const visit = (type: string, amount: number) => {
      switch (categorizeBreakdown(type)) {
        case "revenue": revenue += amount; break;
        case "fees": fees += -amount; feeMap.set(type, (feeMap.get(type) ?? 0) + -amount); break;
        case "refund": refunds += -amount; break;
        case "promotion": promotions += -amount; break;
        // frete do vendedor e impostos entram no líquido, mas não compõem a
        // receita bruta nem as taxas exibidas.
        default: break;
      }
    };
    walkLeafBreakdowns(transaction.breakdowns, visit);
    for (const item of transaction.items ?? []) {
      walkLeafBreakdowns(item.breakdowns, visit);
      const context = item.contexts?.find((c) => c.sku || c.quantityShipped != null);
      const sku = context?.sku;
      const quantity = context?.quantityShipped ?? 0;
      if (sku && quantity > 0) {
        const key = `${orderId ?? ""}:${sku}`;
        const line = itemLineMap.get(key) ?? {
          orderId: orderId ?? "",
          sku,
          quantity: 0,
          revenue: 0,
          postedDate: transaction.postedDate ?? "",
          currency,
        };
        line.quantity += quantity;
        line.revenue += item.totalAmount?.currencyAmount ?? 0;
        itemLineMap.set(key, line);
      }
    }
  }

  return {
    currency,
    revenue: round(revenue),
    fees: round(fees),
    promotions: round(promotions),
    refunds: round(refunds),
    netProceeds: round(netProceeds),
    orderCount: orders.size,
    feeBreakdown: [...feeMap.entries()]
      .map(([type, amount]) => ({ type, amount: round(amount) }))
      .sort((a, b) => b.amount - a.amount),
    itemLines: [...itemLineMap.values()],
    source: "transactions-2024-06-19",
  };
}

export function getFinanceSummaryFromTransactions(period: Period): Promise<FinanceSummaryFromTransactions> {
  return swr(
    `finance-tx:${period.key}`,
    5 * 60_000,
    async () => computeFinanceFromTransactions(await fetchRawTransactions(period)),
    { awaitIfEmpty: true }
  );
}
