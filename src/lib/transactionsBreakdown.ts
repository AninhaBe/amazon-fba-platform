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
  /** Desconto que saiu do bolso da vendedora (cupom/promoção), já abatido de `revenue`. */
  promotions: number;
  feeMap: Map<string, number>;
}

function amountOf(node: Breakdown): number {
  return node.breakdownAmount?.currencyAmount ?? 0;
}

// `PromoRebates` faz DOIS papéis diferentes, e tratá-los igual quebra a conta:
//
//   Frete grátis   Sales: ProductCharges 19,90 + Shipping 8,90 | Expenses: PromoRebates −8,90
//                  → o rebate ANULA o frete. Faturamento = 19,90.
//
//   Cupom          Sales: ProductCharges 22,11                 | Expenses: PromoRebates −2,21
//                  → o rebate é DESCONTO REAL. Faturamento = 19,90.
//
// Nos dois o `totalAmount` do pedido é 19,90. A regra que resolve os dois: o rebate
// primeiro cancela o `Shipping` (que de propósito não entra em `revenue`, porque a
// compradora não pagou frete), e **o que sobra é desconto sobre o produto**.
//
// Antes, `PromoRebates` era ignorado por completo: o cupom de R$ 2,21 sumia e a tela
// mostrava R$ 42,01 de receita onde o recebido foi R$ 39,80 (observado em 15/08/2026,
// pedido 702-6105524-7663427).
const REBATE = "PromoRebates";

export function parseTransactionFinancials(transaction: { breakdowns?: Breakdown[] }): ParsedTransaction {
  const parsed: ParsedTransaction = {
    revenue: 0, fees: 0, refunds: 0, reimbursements: 0, promotions: 0, feeMap: new Map(),
  };
  let frete = 0;
  let rebate = 0;

  for (const top of transaction.breakdowns ?? []) {
    const kind = top.breakdownType;
    if (kind === "Sales" || kind === "Refunded Sales") {
      for (const child of top.breakdowns ?? []) {
        const value = amountOf(child);
        if (child.breakdownType === "ProductCharges") {
          if (value >= 0) parsed.revenue += value;
          else parsed.refunds += -value; // "Refunded Sales" traz ProductCharges negativo
        } else if (child.breakdownType === "Shipping") {
          // Não entra em `revenue`: quando existe, veio acompanhado do rebate que o anula.
          frete += value;
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
          const magnitude = -amountOf(fee); // tarifas vêm negativas → positivo
          if (fee.breakdownType === REBATE) {
            rebate += magnitude;
            continue; // resolvido abaixo, contra o frete
          }
          parsed.fees += magnitude;
          parsed.feeMap.set(fee.breakdownType ?? "Outra", (parsed.feeMap.get(fee.breakdownType ?? "Outra") ?? 0) + magnitude);
        }
      }
    }
  }

  // O rebate cancela o frete primeiro; o excedente é desconto sobre o produto.
  const sobra = Math.max(0, rebate - frete);
  if (sobra > 0) {
    parsed.promotions += sobra;
    parsed.revenue -= sobra;
  }

  return parsed;
}
