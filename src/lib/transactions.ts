import { defaultMarketplaceId, spapiFetch } from "./spapi";
import { swr } from "./swr";
import type { Period } from "./period";

interface CurrencyAmount {
  currencyAmount?: number;
  currencyCode?: string;
}

interface RelatedIdentifier {
  relatedIdentifierName?: string;
  relatedIdentifierValue?: string;
}

interface TransactionItem {
  contexts?: Array<{ sku?: string; asin?: string }>;
}

interface ApiTransaction {
  transactionId?: string;
  transactionType?: string;
  transactionStatus?: string;
  description?: string;
  postedDate?: string;
  totalAmount?: CurrencyAmount;
  relatedIdentifiers?: RelatedIdentifier[];
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

async function fetchTransactions(period: Period): Promise<TransactionSummary> {
  // listTransactions aceita no máximo 180 dias por consulta.
  const earliest = Date.now() - 180 * 86_400_000;
  const postedAfter = new Date(Math.max(new Date(period.startISO).getTime(), earliest)).toISOString();
  const postedBefore = period.endISO;
  const marketplaceId = defaultMarketplaceId();
  const transactions: FinancialTransaction[] = [];
  let nextToken: string | undefined;
  let page = 0;

  do {
    const data = await spapiFetch<ListTransactionsResponse>(
      "/finances/2024-06-19/transactions",
      {
        query: nextToken
          ? { nextToken }
          : { postedAfter, postedBefore, marketplaceId },
      }
    );

    for (const transaction of data.payload?.transactions ?? []) {
      const orderId = transaction.relatedIdentifiers?.find((identifier) =>
        identifier.relatedIdentifierName?.toUpperCase().includes("ORDER")
      )?.relatedIdentifierValue;
      const context = transaction.items?.flatMap((item) => item.contexts ?? [])[0];
      transactions.push({
        id: transaction.transactionId || `${transaction.postedDate}-${transactions.length}`,
        type: transaction.transactionType || "OTHER",
        status: transaction.transactionStatus || "UNKNOWN",
        description: transaction.description || transaction.transactionType || "Transação",
        postedDate: transaction.postedDate || postedBefore,
        amount: round(transaction.totalAmount?.currencyAmount ?? 0),
        currency: transaction.totalAmount?.currencyCode || "BRL",
        orderId,
        sku: context?.sku,
      });
    }

    nextToken = data.payload?.nextToken;
    page += 1;
  } while (nextToken && page < 50);

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
