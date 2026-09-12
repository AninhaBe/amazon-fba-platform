/**
 * O VALOR DE UM PEDIDO RECENTE — e quando ele ainda NAO EXISTE.
 *
 * ⚠️ VISTO EM PRODUCAO EM 12/09/2026: o bloco "Pedidos recentes"
 * do dashboard da Amazon exibia `R$ 0,00` em SEIS pedidos seguidos, todos
 * `Pending` do mesmo dia. A tela afirmava que seis vendas nao renderam nada.
 *
 * ⚠️ E O GUARD JA EXISTIA — era `o.orderTotal ? money(...) : "—"`.
 * Ele defendia contra o campo AUSENTE, e a Amazon nao omite o campo: ela manda
 * `OrderTotal: { Amount: "0.00" }` enquanto o pedido nao envia. O zero vem da
 * FONTE, atravessa o teste de existencia e chega na tela como fato.
 *
 * Por isso a fronteira aqui e o STATUS, nao a presenca do campo: enquanto o
 * pedido esta `Pending`, zero significa "a Amazon ainda nao publicou". Depois
 * de enviado, zero seria um fato dela — e continua sendo exibido.
 */
export function valorDoPedidoRecente(pedido: {
  orderTotal?: { Amount?: string; CurrencyCode?: string } | null;
  orderStatus?: string | null;
}): { valor: number; moeda: string } | null {
  const bruto = pedido.orderTotal?.Amount;
  if (bruto == null) return null;
  const valor = Number(bruto);
  if (!Number.isFinite(valor)) return null;
  // Zero ANTES do envio e ausencia de dado; zero depois e um fato da Amazon.
  if (valor === 0 && pedido.orderStatus === "Pending") return null;
  return { valor, moeda: pedido.orderTotal?.CurrencyCode || "BRL" };
}
