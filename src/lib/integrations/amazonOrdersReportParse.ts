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

/**
 * Pedido cujo valor a origem zerou — mas cujo SKU e data sobreviveram.
 *
 * É o caso do cancelado: a Amazon apaga `item-price` e `quantity` e MANTÉM
 * `sku`, `asin`, `product-name` e `purchase-date`. Com SKU e data dá para
 * estimar pelo preço praticado naquele dia (migrations/0011).
 */
export interface PedidoSemValor {
  externalOrderId: string;
  skus: string[];
  /** ISO da compra, como o relatório informa. */
  purchaseDate: string | null;
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

/**
 * Pedidos sem valor no relatório, com o SKU que sobreviveu.
 *
 * Só devolve quem tem SKU: sem ele não há como estimar nada, e inventar valor
 * sem base é exatamente o que a coluna de procedência existe para impedir.
 */
export function pedidosSemValor(tsv: string): PedidoSemValor[] {
  const linhas = tsv.trim().split("\n");
  if (linhas.length < 2) return [];
  const cabecalho = linhas[0].split("\t");
  const iPedido = cabecalho.indexOf("amazon-order-id");
  const iPreco = cabecalho.indexOf("item-price");
  const iSku = cabecalho.indexOf("sku");
  const iData = cabecalho.indexOf("purchase-date");
  if (iPedido < 0 || iPreco < 0 || iSku < 0) {
    throw new Error(`relatório sem as colunas esperadas: ${cabecalho.slice(0, 8).join(", ")}`);
  }
  const porPedido = new Map<string, PedidoSemValor>();
  const comValor = new Set<string>();
  for (const linha of linhas.slice(1)) {
    const campos = linha.split("\t");
    const pedido = campos[iPedido]?.trim();
    if (!pedido) continue;
    const preco = Number(campos[iPreco]?.trim());
    if (Number.isFinite(preco) && preco > 0) {
      comValor.add(pedido);
      continue;
    }
    const sku = campos[iSku]?.trim();
    if (!sku) continue;
    const atual = porPedido.get(pedido) ?? {
      externalOrderId: pedido,
      skus: [],
      purchaseDate: iData >= 0 ? (campos[iData]?.trim() || null) : null,
    };
    if (!atual.skus.includes(sku)) atual.skus.push(sku);
    porPedido.set(pedido, atual);
  }
  // Pedido com uma linha paga e outra zerada tem valor: não é caso de estimativa.
  return [...porPedido.values()].filter((p) => !comValor.has(p.externalOrderId));
}
