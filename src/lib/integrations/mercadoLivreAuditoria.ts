// Pedidos a revisar — divergência entre o frete que o Mercado Livre DIZ que
// custa e o que o Mercado Pago efetivamente DESCONTOU.
//
// Descoberto em 16/08/2026 num pedido real da conta 1191100170:
//
//   total_amount   R$ 39,90   produto
//   paid_amount    R$ 48,89   o comprador pagou R$ 8,99 de frete
//   shipment       R$  6,65   o que o vendedor deveria pagar
//   cobrado (MP)   R$ 15,64   o que foi descontado
//                  ────────
//   diferença      R$  8,99   exatamente o frete do comprador
//
// O vendedor foi cobrado como se o frete do comprador também fosse dele. Cinco
// outros pedidos da mesma amostra bateram no centavo, então não é ruído de
// arredondamento nem erro de junção (pedido único, sem pack, um envio, um
// pagamento — verificado).
//
// ⚠️ REGRA DE PRODUTO: divergência **não é** cobrança indevida provada. O
// shipment é uma foto, e o ML pode reprecificar o frete depois da pesagem no
// centro de distribuição. Por isso a tela se chama "pedidos a revisar" e mostra
// os dois números lado a lado — quem decide contestar é a vendedora. Gritar
// "erro" em toda diferença geraria falso positivo e destruiria a confiança na
// feature em duas semanas.
//
// Módulo puro, sem dependências, para ser testável.

export interface CobrancaMP {
  /** `charges_details[].type`: "shipping", "fee"… */
  type?: string;
  name?: string;
  amounts?: { original?: number | null } | null;
}

export interface PagamentoAuditoria {
  id?: number | string;
  /** `external_reference` do MP = id do pedido no ML. */
  orderId?: string | null;
  status?: string;
  transactionAmount?: number | null;
  netReceived?: number | null;
  charges?: readonly CobrancaMP[];
  paidAt?: string | null;
}

/** O que o shipment do ML diz que o frete custa para o vendedor. */
export interface FreteEsperado {
  orderId: string;
  /** `senders[].cost` do shipment. */
  custoVendedor: number;
  /** `gross_amount`: frete cheio antes de desconto. Só informativo. */
  freteCheio: number | null;
  shipmentId: string | null;
}

export interface PedidoARevisar {
  orderId: string;
  paymentId: string | null;
  /** Frete que o shipment do ML declara para o vendedor. */
  esperado: number;
  /** Frete efetivamente descontado pelo Mercado Pago. */
  cobrado: number;
  /** `cobrado − esperado`. Positivo = cobrado a mais. */
  diferenca: number;
  freteCheio: number | null;
  shipmentId: string | null;
  transactionAmount: number | null;
  netReceived: number | null;
  paidAt: string | null;
}

export interface ResultadoAuditoria {
  currency: string;
  pedidos: PedidoARevisar[];
  /** Soma das diferenças positivas — o que vale a pena contestar. */
  totalACustestar: number;
  /** Quantos pedidos foram efetivamente comparados. */
  comparados: number;
  /** Pagamentos lidos que não tinham frete esperado conhecido. */
  semReferencia: number;
  /** `true` quando a leitura parou no orçamento de páginas. */
  parcial: boolean;
}

const round = (v: number) => +v.toFixed(2);

/**
 * Tolerância de 1 centavo. Abaixo disso é arredondamento entre as duas fontes,
 * não divergência — e listar centavos afogaria os casos que importam.
 */
export const TOLERANCIA = 0.01;

/** Soma as cobranças de frete do pagamento. */
export function freteCobrado(charges: readonly CobrancaMP[] | undefined): number {
  if (!charges) return 0;
  return round(
    charges
      .filter((c) => c.type === "shipping")
      .reduce((soma, c) => soma + (c.amounts?.original ?? 0), 0)
  );
}

export function auditarFrete(
  pagamentos: readonly PagamentoAuditoria[],
  esperados: readonly FreteEsperado[],
  input: { currency?: string; parcial?: boolean } = {}
): ResultadoAuditoria {
  const porPedido = new Map(esperados.map((e) => [e.orderId, e]));
  const pedidos: PedidoARevisar[] = [];
  let comparados = 0;
  let semReferencia = 0;

  for (const pagamento of pagamentos) {
    // Recusado nunca gerou cobrança; comparar seria inventar divergência.
    if (pagamento.status !== "approved") continue;
    const orderId = pagamento.orderId ?? null;
    if (!orderId) { semReferencia += 1; continue; }
    const esperado = porPedido.get(orderId);
    // Sem o shipment não há com o que comparar. NÃO assumir zero: "não sei o
    // frete" viraria "o ML cobrou tudo indevidamente".
    if (!esperado) { semReferencia += 1; continue; }

    comparados += 1;
    const cobrado = freteCobrado(pagamento.charges);
    const diferenca = round(cobrado - esperado.custoVendedor);
    if (Math.abs(diferenca) <= TOLERANCIA) continue;

    pedidos.push({
      orderId,
      paymentId: pagamento.id == null ? null : String(pagamento.id),
      esperado: round(esperado.custoVendedor),
      cobrado,
      diferenca,
      freteCheio: esperado.freteCheio,
      shipmentId: esperado.shipmentId,
      transactionAmount: pagamento.transactionAmount ?? null,
      netReceived: pagamento.netReceived ?? null,
      paidAt: pagamento.paidAt ?? null,
    });
  }

  // Maior diferença primeiro: é onde está o dinheiro e por onde se começa a
  // contestar.
  pedidos.sort((a, b) => b.diferenca - a.diferenca || a.orderId.localeCompare(b.orderId));

  return {
    currency: input.currency ?? "BRL",
    pedidos,
    // Só o que foi cobrado A MAIS entra no total a contestar. Cobrança a menor
    // existe e é a favor dela — aparece na lista, mas não vira pedido de dinheiro.
    totalACustestar: round(pedidos.filter((p) => p.diferenca > 0).reduce((s, p) => s + p.diferenca, 0)),
    comparados,
    semReferencia,
    parcial: input.parcial ?? false,
  };
}
