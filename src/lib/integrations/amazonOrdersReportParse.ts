/**
 * Parse do relatório ALL_ORDERS — sem dependência de banco nem de rede, de
 * propósito: é a única parte com regra de negócio e precisa ser testável direto.
 *
 * A regra que este arquivo guarda: linha sem valor **não vira zero**. Pedido
 * cancelado sai do relatório com `quantity 0` e `item-price` vazio, e tratar isso
 * como 0,00 faria a tela dizer "cancelaram e não custou nada" — a violação de
 * `null` != `0` que a migration 0008 corrigiu no `gross`.
 */

export interface OrderedGrossEntry {
  externalOrderId: string;
  /** Valor de tabela somado das linhas. Nunca zero: quem não tem valor não entra. */
  orderedGross: number;
}

/** Soma o item-price por pedido. Linha sem valor não vira zero: o pedido simplesmente não entra. */
export function somarValorPorPedido(tsv: string): OrderedGrossEntry[] {
  const linhas = tsv.trim().split("\n");
  if (linhas.length < 2) return [];
  const cabecalho = linhas[0].split("\t");
  const iPedido = cabecalho.indexOf("amazon-order-id");
  const iPreco = cabecalho.indexOf("item-price");
  if (iPedido < 0 || iPreco < 0) {
    throw new Error(`relatório sem as colunas esperadas: ${cabecalho.slice(0, 8).join(", ")}`);
  }
  const porPedido = new Map<string, number>();
  for (const linha of linhas.slice(1)) {
    const campos = linha.split("\t");
    const pedido = campos[iPedido]?.trim();
    const preco = campos[iPreco]?.trim();
    if (!pedido || !preco) continue;
    const valor = Number(preco);
    if (!Number.isFinite(valor) || valor <= 0) continue;
    porPedido.set(pedido, (porPedido.get(pedido) ?? 0) + valor);
  }
  return [...porPedido].map(([externalOrderId, orderedGross]) => ({
    externalOrderId,
    orderedGross: Math.round(orderedGross * 100) / 100,
  }));
}
