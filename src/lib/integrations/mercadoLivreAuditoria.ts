// Pedidos a revisar — divergência entre o frete que o Mercado Livre DIZ que
// custa e o que o Mercado Pago efetivamente DESCONTOU.
//
// ⚠️ CORRIGIDO em 16/08/2026, ANTES de qualquer contestação ser aberta.
//
// A primeira versão comparava `shp_fulfillment` (o que o MP debita) direto com
// `senders[].cost` (o que o envio diz que o VENDEDOR paga) — e acusou 8
// divergências na conta 648425194 que **não existiam**. Bruto contra líquido.
//
// A tela do Mercado Pago mostrou a conta inteira no pedido 2000017874507858:
//
//   Pagamento do Mercado Envios (por conta do comprador)   R$ 16,99
//   Tarifa por envios no Mercado Livre                    −R$ 23,64
//                                                          ────────
//   Envios (efeito para o vendedor)                       −R$  6,65
//
// O ML debita o frete CHEIO e credita de volta a parte do comprador. Conferido
// em 6 pedidos, bate ao centavo em todos:
//
//   senders[].cost + receiver.cost == shp_fulfillment
//    6,65 + 16,99 = 23,64      13,30 +  6,99 = 20,29
//    6,65 + 11,99 = 18,64      13,30 + 14,99 = 28,29
//    6,65 + 10,99 = 17,64       6,65 +  7,99 = 14,64
//
// Portanto o esperado é a SOMA das duas pontas. Divergência real é quando nem
// isso fecha.
//
// 📌 Lição: antes de acusar o marketplace de cobrar errado, conferir se os dois
// lados da comparação estão na mesma base. Um alerta financeiro falso custa mais
// caro que alerta nenhum — a pessoa abre reclamação, é negada, e para de confiar.
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
  /** `senders[].cost` do shipment: a parte do vendedor. */
  custoVendedor: number;
  /** `receiver.cost`: a parte do comprador, que o ML debita e credita de volta. */
  custoComprador: number;
  /** `gross_amount`: frete cheio antes de desconto. Só informativo. */
  freteCheio: number | null;
  shipmentId: string | null;
}

export interface PedidoARevisar {
  orderId: string;
  paymentId: string | null;
  /** Frete cheio esperado: parte do vendedor + parte do comprador. */
  esperado: number;
  esperadoVendedor: number;
  esperadoComprador: number;
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
    // O débito do MP é o frete CHEIO (vendedor + comprador); a parte do
    // comprador volta como crédito. Comparar só com a do vendedor acusaria
    // divergência em todo pedido com frete parcialmente pago pelo comprador.
    const esperadoTotal = round(esperado.custoVendedor + esperado.custoComprador);
    const diferenca = round(cobrado - esperadoTotal);
    if (Math.abs(diferenca) <= TOLERANCIA) continue;

    pedidos.push({
      orderId,
      paymentId: pagamento.id == null ? null : String(pagamento.id),
      esperado: esperadoTotal,
      esperadoVendedor: round(esperado.custoVendedor),
      esperadoComprador: round(esperado.custoComprador),
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
