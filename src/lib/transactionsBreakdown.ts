// Leitura pura da árvore de breakdowns da Transactions API (2024-06-19).
//
// Vive num módulo sem dependências, pelo mesmo motivo de `profitability.ts`: é
// a regra que decide receita e tarifa de cada pedido, e precisa ser testável sem
// arrastar `spapi` junto — que usa parameter properties e não passa no
// strip-only mode dos testes.

export interface CurrencyAmount {
  currencyAmount?: number;
  currencyCode?: string;
}

export interface Breakdown {
  breakdownType?: string;
  breakdownAmount?: CurrencyAmount;
  breakdowns?: Breakdown[];
}

export interface ParsedTransaction {
  revenue: number;
  fees: number;
  refunds: number;
  reimbursements: number;
  feeMap: Map<string, number>;
}

function amountOf(node: Breakdown): number {
  return node.breakdownAmount?.currencyAmount ?? 0;
}

// Frete grátis vira DOIS lançamentos que se anulam: `Sales → Shipping` (+8,90) e
// `Expenses → PromoRebates` (−8,90). O `totalAmount` do pedido já vem líquido, e
// `parsed.revenue` conta só `ProductCharges` — de propósito, porque é o que a
// compradora efetivamente pagou. Contar o rebate como despesa sem contar o frete
// como receita descontaria o valor duas vezes.
//
// Observado em 14/08/2026 no pedido 702-2192919-5915420: ShippingPrice 8,90 e
// ShippingDiscount 8,90, com OrderTotal de 19,90.
const CONTRAPARTIDAS_DE_RECEITA_IGNORADA = new Set(["PromoRebates"]);

function ehContrapartidaDeReceitaIgnorada(tipo?: string): boolean {
  return !!tipo && CONTRAPARTIDAS_DE_RECEITA_IGNORADA.has(tipo);
}

// Extrai receita/taxas/reembolsos de UMA transação a partir da árvore de
// breakdowns (Sales/Expenses → ProductCharges/AmazonFees). Compartilhado pelo
// resumo do período e pela conciliação por pedido.
export function parseTransactionFinancials(transaction: { breakdowns?: Breakdown[] }): ParsedTransaction {
  const parsed: ParsedTransaction = { revenue: 0, fees: 0, refunds: 0, reimbursements: 0, feeMap: new Map() };
  for (const top of transaction.breakdowns ?? []) {
    const kind = top.breakdownType;
    if (kind === "Sales" || kind === "Refunded Sales") {
      for (const child of top.breakdowns ?? []) {
        const value = amountOf(child);
        if (child.breakdownType === "ProductCharges") {
          if (value >= 0) parsed.revenue += value;
          else parsed.refunds += -value; // "Refunded Sales" traz ProductCharges negativo
        } else if (child.breakdownType?.includes("Reimbursement")) {
          parsed.reimbursements += value;
        }
        // FundTransfer não ocorre aqui (tipo Transfer é filtrado antes)
      }
    } else if (kind === "Expenses" || kind === "Refunded Expenses") {
      // Expenses → AmazonFees → cada tarifa nomeada (nível certo p/ detalhar).
      //
      // Mas nem todo filho de Expenses tem esse terceiro nível — há despesas que
      // vêm como FOLHA direta de Expenses, e o laço aninhado as descartava em
      // silêncio. Regra: descer quando houver nível abaixo, contar a própria
      // folha quando não houver. Nunca os dois, senão conta em dobro.
      for (const feesNode of top.breakdowns ?? []) {
        const filhos = feesNode.breakdowns ?? [];
        for (const fee of filhos.length > 0 ? filhos : [feesNode]) {
          if (ehContrapartidaDeReceitaIgnorada(fee.breakdownType)) continue;
          const magnitude = -amountOf(fee); // tarifas vêm negativas → positivo
          parsed.fees += magnitude;
          parsed.feeMap.set(fee.breakdownType ?? "Outra", (parsed.feeMap.get(fee.breakdownType ?? "Outra") ?? 0) + magnitude);
        }
      }
    }
  }
  return parsed;
}
