export interface MercadoLivreOrderPage<T> {
  paging?: { total?: number };
  results?: T[];
}

interface CollectOrdersInput<T extends { id: number | string }> {
  from: Date;
  to: Date;
  fetchPage: (from: Date, to: Date, offset: number, limit: number) => Promise<MercadoLivreOrderPage<T>>;
  pageSize?: number;
  concurrency?: number;
  maxResultsPerRange?: number;
}

export interface CollectedMercadoLivreOrders<T> {
  orders: T[];
  total: number;
  complete: boolean;
}

async function fetchOffsets<T>(
  offsets: number[],
  concurrency: number,
  fetchPage: (offset: number) => Promise<MercadoLivreOrderPage<T>>
): Promise<MercadoLivreOrderPage<T>[]> {
  const pages: MercadoLivreOrderPage<T>[] = [];
  for (let index = 0; index < offsets.length; index += concurrency) {
    const batch = offsets.slice(index, index + concurrency);
    pages.push(...await Promise.all(batch.map(fetchPage)));
  }
  return pages;
}

/**
 * Collects every order in a fixed period. Mercado Livre limits deep offset
 * pagination, so dense periods are split into smaller date windows and the
 * overlapping boundary is deduplicated by order id.
 */
export async function collectMercadoLivreOrders<T extends { id: number | string }>({
  from,
  to,
  fetchPage,
  pageSize = 50,
  concurrency = 5,
  maxResultsPerRange = 10_000,
}: CollectOrdersInput<T>): Promise<CollectedMercadoLivreOrders<T>> {
  const collectRange = async (
    rangeFrom: Date,
    rangeTo: Date,
    firstPage?: MercadoLivreOrderPage<T>
  ): Promise<T[]> => {
    const first = firstPage ?? await fetchPage(rangeFrom, rangeTo, 0, pageSize);
    const total = first.paging?.total ?? first.results?.length ?? 0;

    if (total > maxResultsPerRange) {
      const midpoint = Math.floor((rangeFrom.getTime() + rangeTo.getTime()) / 2);
      if (midpoint <= rangeFrom.getTime() || midpoint >= rangeTo.getTime()) {
        throw new Error("O período possui pedidos demais para uma consulta completa. Reduza o intervalo e tente novamente.");
      }
      const left = await collectRange(rangeFrom, new Date(midpoint));
      const right = await collectRange(new Date(midpoint), rangeTo);
      return [...left, ...right];
    }

    const offsets = Array.from(
      { length: Math.max(0, Math.ceil(total / pageSize) - 1) },
      (_, index) => (index + 1) * pageSize
    );
    const additional = await fetchOffsets(offsets, concurrency, (offset) =>
      fetchPage(rangeFrom, rangeTo, offset, pageSize)
    );
    return [first, ...additional].flatMap((page) => page.results ?? []).slice(0, total);
  };

  const firstPage = await fetchPage(from, to, 0, pageSize);
  const total = firstPage.paging?.total ?? firstPage.results?.length ?? 0;
  const collected = await collectRange(from, to, firstPage);
  const unique = [...new Map(collected.map((order) => [String(order.id), order])).values()];

  if (unique.length < total) {
    throw new Error(`Não foi possível carregar todos os pedidos do período (${unique.length} de ${total}). Tente atualizar novamente.`);
  }

  return { orders: unique, total, complete: true };
}
