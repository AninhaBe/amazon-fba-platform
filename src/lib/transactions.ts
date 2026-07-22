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

async function fetchTransactions(period: Period): Promise<TransactionSummary> {
  // listTransactions aceita no máximo 180 dias por consulta; filtros maiores
  // são divididos sem descartar a parte mais antiga do período.
  const postedAfter = period.startISO;
  const safePostedBefore = new Date(Math.min(new Date(period.endISO).getTime(), Date.now() - 3 * 60_000));
  const postedBefore = safePostedBefore.toISOString();
  const marketplaceId = defaultMarketplaceId();
  const transactions: FinancialTransaction[] = [];
  const ranges = splitDateRange(new Date(postedAfter), safePostedBefore);
  const pages: ListTransactionsResponse[] = [];
  for (const range of ranges) {
    pages.push(...await collectAllNextTokenPages(
      (nextToken) => spapiFetch<ListTransactionsResponse>(
        "/finances/2024-06-19/transactions",
        {
          query: nextToken
            ? { nextToken }
            : { postedAfter: range.from.toISOString(), postedBefore: range.to.toISOString(), marketplaceId },
        }
      ),
      (page) => page.payload?.nextToken
    ));
  }

  for (const data of pages) {

    for (const transaction of data.payload?.transactions ?? []) {
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
