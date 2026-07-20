export async function collectAllNextTokenPages<T>(
  fetchPage: (nextToken?: string) => Promise<T>,
  getNextToken: (page: T) => string | undefined
): Promise<T[]> {
  const pages: T[] = [];
  const seenTokens = new Set<string>();
  let nextToken: string | undefined;

  do {
    const page = await fetchPage(nextToken);
    pages.push(page);
    const returnedToken = getNextToken(page);
    if (returnedToken) {
      if (seenTokens.has(returnedToken)) {
        throw new Error("A Amazon repetiu uma página durante a consulta. Atualize novamente para evitar dados parciais.");
      }
      seenTokens.add(returnedToken);
    }
    nextToken = returnedToken;
  } while (nextToken);

  return pages;
}

export function splitDateRange(from: Date, to: Date, maxDays = 179): Array<{ from: Date; to: Date }> {
  if (from >= to) return [];
  const maxSpan = maxDays * 86_400_000;
  const ranges: Array<{ from: Date; to: Date }> = [];
  let cursor = from.getTime();
  while (cursor < to.getTime()) {
    const rangeEnd = Math.min(cursor + maxSpan, to.getTime());
    ranges.push({ from: new Date(cursor), to: new Date(rangeEnd) });
    cursor = rangeEnd;
  }
  return ranges;
}
