export const PRODUCT_PAGE_LIMIT = 100;
export const ORDER_PAGE_LIMIT = 100;

/** Status aceitos por get_item_list e documentados para o catálogo Shopee. */
export const SHOPEE_PRODUCT_STATUSES = ["NORMAL", "UNLIST", "BANNED", "DELETED"] as const;
export type ShopeeProductStatus = (typeof SHOPEE_PRODUCT_STATUSES)[number];

export interface ShopeeCatalogCheckpoint {
  kind: "shopee_catalog_v1";
  sweepStartedAt: string;
  statusIndex: number;
  offset: number;
}

export interface ShopeeCatalogBudgetResult {
  checkpoint: ShopeeCatalogCheckpoint | null;
  complete: boolean;
  pages: number;
  items: number;
}

export interface ShopeeProductListPage {
  item?: Array<{ item_id: number }>;
  has_next_page?: boolean;
  next_offset?: number;
}

export interface ShopeeOrderListPage {
  order_list?: Array<{ order_sn: string }>;
  more?: boolean;
  next_cursor?: string;
}

export function createShopeeCatalogCheckpoint(sweepStartedAt: string): ShopeeCatalogCheckpoint {
  if (!Number.isFinite(new Date(sweepStartedAt).getTime())) {
    throw new Error("Início do sweep Shopee inválido.");
  }
  return { kind: "shopee_catalog_v1", sweepStartedAt, statusIndex: 0, offset: 0 };
}

export function encodeShopeeCatalogCheckpoint(checkpoint: ShopeeCatalogCheckpoint): string {
  return JSON.stringify(checkpoint);
}

export function decodeShopeeCatalogCheckpoint(value: string): ShopeeCatalogCheckpoint {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Checkpoint do catálogo Shopee inválido; snapshot anterior preservado.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Checkpoint do catálogo Shopee inválido; snapshot anterior preservado.");
  }
  const candidate = parsed as Partial<ShopeeCatalogCheckpoint>;
  if (candidate.kind !== "shopee_catalog_v1"
    || typeof candidate.sweepStartedAt !== "string"
    || !Number.isFinite(new Date(candidate.sweepStartedAt).getTime())
    || !Number.isInteger(candidate.statusIndex)
    || candidate.statusIndex == null
    || candidate.statusIndex < 0
    || candidate.statusIndex >= SHOPEE_PRODUCT_STATUSES.length
    || !Number.isInteger(candidate.offset)
    || candidate.offset == null
    || candidate.offset < 0) {
    throw new Error("Checkpoint do catálogo Shopee inválido; snapshot anterior preservado.");
  }
  return candidate as ShopeeCatalogCheckpoint;
}

/**
 * Percorre somente o orçamento desta execução. `processPage` deve persistir o
 * lote e o próximo checkpoint atomicamente; se lançar, o cursor anterior segue
 * sendo a autoridade para uma retomada idempotente.
 */
export async function runShopeeCatalogPageBudget(input: {
  checkpoint: ShopeeCatalogCheckpoint;
  fetchPage: (status: ShopeeProductStatus, offset: number) => Promise<ShopeeProductListPage>;
  processPage: (page: {
    status: ShopeeProductStatus;
    ids: number[];
    currentCheckpoint: ShopeeCatalogCheckpoint;
    nextCheckpoint: ShopeeCatalogCheckpoint | null;
  }) => Promise<void>;
  maxPages?: number;
  budgetMs?: number;
  now?: () => number;
}): Promise<ShopeeCatalogBudgetResult> {
  const maxPages = input.maxPages ?? 8;
  const budgetMs = input.budgetMs ?? 12_000;
  if (!Number.isInteger(maxPages) || maxPages < 1 || !Number.isFinite(budgetMs) || budgetMs < 1) {
    throw new Error("Orçamento do catálogo Shopee inválido.");
  }
  const now = input.now ?? Date.now;
  const deadline = now() + budgetMs;
  let checkpoint = input.checkpoint;
  let pages = 0;
  let items = 0;

  while (pages < maxPages && (pages === 0 || now() < deadline)) {
    const status = SHOPEE_PRODUCT_STATUSES[checkpoint.statusIndex];
    const page = parseShopeeProductListPage(await input.fetchPage(status, checkpoint.offset));
    if (page.has_next_page && (page.next_offset == null || page.next_offset <= checkpoint.offset)) {
      throw new Error("A Shopee informou uma paginação de produtos sem avanço.");
    }
    const nextCheckpoint = page.has_next_page
      ? { ...checkpoint, offset: page.next_offset! }
      : checkpoint.statusIndex + 1 < SHOPEE_PRODUCT_STATUSES.length
        ? { ...checkpoint, statusIndex: checkpoint.statusIndex + 1, offset: 0 }
        : null;
    const ids = page.item.map((item) => item.item_id);
    await input.processPage({ status, ids, currentCheckpoint: checkpoint, nextCheckpoint });
    pages++;
    items += ids.length;
    if (!nextCheckpoint) return { checkpoint: null, complete: true, pages, items };
    checkpoint = nextCheckpoint;
  }

  return { checkpoint, complete: false, pages, items };
}

function responseRecord(value: unknown, invalid: () => Error): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}

/** Valida o contrato antes que uma página vazia possa avançar cobertura. */
export function parseShopeeOrderListPage(
  value: unknown,
  invalid: () => Error = () => new Error("Resposta inválida da lista de pedidos Shopee.")
): Required<Pick<ShopeeOrderListPage, "order_list" | "more">> & Pick<ShopeeOrderListPage, "next_cursor"> {
  const raw = responseRecord(value, invalid);
  if (!Array.isArray(raw.order_list) || typeof raw.more !== "boolean"
    || (raw.more && (typeof raw.next_cursor !== "string" || !raw.next_cursor))) throw invalid();
  for (const order of raw.order_list) {
    const item = responseRecord(order, invalid);
    if (typeof item.order_sn !== "string" || !item.order_sn) throw invalid();
  }
  return raw as unknown as Required<Pick<ShopeeOrderListPage, "order_list" | "more">>
    & Pick<ShopeeOrderListPage, "next_cursor">;
}

/** Valida o contrato antes que um catálogo vazio possa disparar tombstones. */
export function parseShopeeProductListPage(
  value: unknown,
  invalid: () => Error = () => new Error("Resposta inválida da lista de produtos Shopee.")
): Required<Pick<ShopeeProductListPage, "item" | "has_next_page">> & Pick<ShopeeProductListPage, "next_offset"> {
  const raw = responseRecord(value, invalid);
  if (!Array.isArray(raw.item) || typeof raw.has_next_page !== "boolean"
    || (raw.has_next_page && (typeof raw.next_offset !== "number" || !Number.isInteger(raw.next_offset) || raw.next_offset < 0))) {
    throw invalid();
  }
  for (const item of raw.item) {
    const product = responseRecord(item, invalid);
    if (typeof product.item_id !== "number" || !Number.isFinite(product.item_id)) throw invalid();
  }
  return raw as unknown as Required<Pick<ShopeeProductListPage, "item" | "has_next_page">>
    & Pick<ShopeeProductListPage, "next_offset">;
}

/** Percorre o catálogo inteiro; um teto defensivo atingido é erro, não cobertura. */
export async function collectShopeeProductIds(
  fetchPage: (offset: number) => Promise<ShopeeProductListPage>,
  pageLimit = PRODUCT_PAGE_LIMIT
): Promise<number[]> {
  const ids = new Set<number>();
  let offset = 0;
  for (let page = 0; page < pageLimit; page++) {
    const result = await fetchPage(offset);
    for (const item of result.item ?? []) ids.add(item.item_id);
    if (!result.has_next_page) return [...ids];
    const nextOffset = result.next_offset;
    if (nextOffset == null || nextOffset <= offset) {
      throw new Error("A Shopee informou uma paginação de produtos sem avanço.");
    }
    offset = nextOffset;
  }
  throw new Error(`Catálogo Shopee excedeu o limite defensivo de ${pageLimit} páginas; sincronização não foi marcada como completa.`);
}

/**
 * Um snapshot reconciliável precisa esgotar todos os status do catálogo. Se
 * qualquer sweep falhar, a promise rejeita e o chamador não pode tombstonear
 * nem marcar `products_complete`.
 */
export async function collectShopeeCatalogIds(
  fetchPage: (status: ShopeeProductStatus, offset: number) => Promise<ShopeeProductListPage>,
  pageLimit = PRODUCT_PAGE_LIMIT
): Promise<number[]> {
  const ids: number[] = [];
  for (const status of SHOPEE_PRODUCT_STATUSES) {
    ids.push(...await collectShopeeProductIds((offset) => fetchPage(status, offset), pageLimit));
  }
  return ids;
}

/** Percorre o cursor opaco inteiro e deduplica pedidos entre páginas. */
export async function collectShopeeOrderSns(
  fetchPage: (cursor?: string) => Promise<ShopeeOrderListPage>,
  pageLimit = ORDER_PAGE_LIMIT
): Promise<string[]> {
  const orderSns = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < pageLimit; page++) {
    const result = await fetchPage(cursor);
    for (const order of result.order_list ?? []) orderSns.add(order.order_sn);
    if (!result.more) return [...orderSns];
    if (!result.next_cursor || result.next_cursor === cursor) {
      throw new Error("A Shopee informou uma paginação de pedidos sem avanço.");
    }
    cursor = result.next_cursor;
  }
  throw new Error(`Pedidos Shopee excederam o limite defensivo de ${pageLimit} páginas; cobertura da janela não foi avançada.`);
}
